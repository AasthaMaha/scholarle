from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Callable

from config import settings
from persistence.agent_registry import agent_definition_by_name
from persistence.database import is_database_enabled, session_scope


class AgentRunService:
    @staticmethod
    def start_run(user_id: str, agent_name: str, input_json: dict[str, Any], agent_definition_id: str | None = None):
        if not is_database_enabled():
            return None
        from persistence.models import AgentDefinition, AgentRun

        definition_data = agent_definition_by_name(agent_name)
        with session_scope() as session:
            definition = session.query(AgentDefinition).filter_by(agent_name=agent_name).one_or_none()
            if definition is None:
                definition = AgentDefinition(**definition_data)
                session.add(definition)
                session.flush()
            run = AgentRun(
                user_id=user_id,
                agent_definition_id=agent_definition_id or definition.id,
                agent_name=agent_name,
                agent_version=definition.prompt_version,
                workflow_name=definition.agent_type,
                input_json=input_json,
                status="running",
                model_provider=settings.llm_provider,
                model_name=settings.model,
                prompt_version=definition.prompt_version,
            )
            session.add(run)
            session.flush()
            return run.id

    @staticmethod
    def complete_run(agent_run_id: str | None, output_json: dict[str, Any], metadata: dict[str, Any] | None = None):
        if not agent_run_id or not is_database_enabled():
            return
        from persistence.models import AgentRun

        metadata = metadata or {}
        with session_scope() as session:
            run = session.get(AgentRun, agent_run_id)
            if run:
                run.status = "success"
                run.output_json = output_json
                run.completed_at = datetime.utcnow()
                run.latency_ms = metadata.get("latency_ms")
                run.token_usage = metadata.get("token_usage")

    @staticmethod
    def fail_run(agent_run_id: str | None, error_message: str):
        if not agent_run_id or not is_database_enabled():
            return
        from persistence.models import AgentRun

        with session_scope() as session:
            run = session.get(AgentRun, agent_run_id)
            if run:
                run.status = "failed"
                run.error_message = error_message
                run.completed_at = datetime.utcnow()


def default_user_id(user_id: str | None = None) -> str:
    return str(user_id or settings.default_user_id or "demo-user")


def run_agent_with_persistence(
    user_id: str | None,
    agent_name: str,
    input_json: dict[str, Any],
    run_fn: Callable[[dict[str, Any]], dict[str, Any]],
):
    started = time.perf_counter()
    safe_user_id = default_user_id(user_id)
    agent_run_id = AgentRunService.start_run(
        user_id=safe_user_id,
        agent_name=agent_name,
        input_json=input_json,
    )
    try:
        output = run_fn(input_json)
    except Exception as exc:
        AgentRunService.fail_run(agent_run_id, str(exc))
        raise

    AgentRunService.complete_run(
        agent_run_id,
        output,
        {"latency_ms": int((time.perf_counter() - started) * 1000)},
    )
    return output, agent_run_id

