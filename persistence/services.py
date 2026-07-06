from __future__ import annotations

import time
import json
from datetime import datetime
from typing import Any, Callable

from config import settings
from persistence.agent_registry import agent_definition_by_name
from persistence.database import is_database_enabled, session_scope


def _string(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value).strip()


def _list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if value in (None, ""):
        return []
    return [value]


def _jsonable(value: Any) -> Any:
    try:
        json.dumps(value)
        return value
    except TypeError:
        pass
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "page_content"):
        return {
            "page_content": str(getattr(value, "page_content", "")),
            "metadata": _jsonable(getattr(value, "metadata", {})),
        }
    if hasattr(value, "model_dump"):
        return _jsonable(value.model_dump())
    return str(value)


def ensure_user(user_id: str, email: str | None = None, full_name: str = "") -> None:
    if not is_database_enabled():
        return
    from persistence.models import User

    safe_user_id = default_user_id(user_id)
    safe_email = email or (
        safe_user_id[6:] if safe_user_id.startswith("email-") and "@" in safe_user_id else f"{safe_user_id}@local.scholar-e.invalid"
    )
    with session_scope() as session:
        user = session.get(User, safe_user_id)
        if user is None:
            session.add(User(id=safe_user_id, email=safe_email[:320], full_name=full_name[:255]))
        else:
            if full_name and not user.full_name:
                user.full_name = full_name[:255]
            if email and user.email != email:
                user.email = email[:320]


class AgentRunService:
    @staticmethod
    def start_run(user_id: str, agent_name: str, input_json: dict[str, Any], agent_definition_id: str | None = None):
        if not is_database_enabled():
            return None
        from persistence.models import AgentDefinition, AgentRun

        ensure_user(user_id)
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
                input_json=_jsonable(input_json),
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
                run.output_json = _jsonable(output_json)
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


class ProfileService:
    @staticmethod
    def save_current_profile(
        user_id: str,
        profile_json: dict[str, Any],
        raw_profile_text: str = "",
        agent_run_id: str | None = None,
    ) -> str | None:
        if not is_database_enabled():
            return None
        from persistence.models import ProfileVersion, StudentProfile

        safe_user_id = default_user_id(user_id)
        ensure_user(safe_user_id, email=profile_json.get("email"), full_name=profile_json.get("name", ""))
        undergrad = profile_json.get("undergrad") or {}
        graduate = profile_json.get("graduate") or {}
        optional = profile_json.get("optional") or {}
        with session_scope() as session:
            profile = session.query(StudentProfile).filter_by(user_id=safe_user_id).first()
            if profile is None:
                profile = StudentProfile(user_id=safe_user_id)
                session.add(profile)
                session.flush()

            profile.display_name = _string(profile_json.get("name"))[:255]
            profile.degree_level = _string(profile_json.get("educationLevel"))[:80]
            profile.year_of_study = _string(profile_json.get("yearOfStudy") or profile_json.get("academicYear"))[:80]
            profile.university = _string(graduate.get("institution") or undergrad.get("institution"))[:255]
            profile.major = _string(undergrad.get("major") or graduate.get("program"))[:255]
            profile.field_of_study = _string(graduate.get("researchArea") or graduate.get("program") or undergrad.get("major"))[:255]
            profile.citizenship = _string(profile_json.get("citizenshipStatus") or profile_json.get("nationality"))[:255]
            profile.residency = _string(profile_json.get("residency") or profile_json.get("location"))[:255]
            profile.current_country = _string(profile_json.get("currentCountry") or profile_json.get("location"))[:255]
            profile.gpa = _string(graduate.get("gpa") or undergrad.get("gpa"))[:80]
            profile.research_interests = {"items": _list(profile_json.get("researchInterests") or graduate.get("researchArea"))}
            profile.skills = {"items": _list(profile_json.get("skills"))}
            profile.leadership_experience = {"items": _list(optional.get("leadership"))}
            profile.work_experience = {"items": _list(profile_json.get("workExperience"))}
            profile.awards = {"items": _list(optional.get("awards"))}
            profile.publications = {"items": _list(optional.get("publications"))}
            profile.career_goals = {"items": _list(profile_json.get("careerGoal"))}
            profile.available_documents = {"items": _list(profile_json.get("availableDocuments"))}
            profile.raw_profile_text = raw_profile_text
            profile.profile_json = profile_json

            version_count = session.query(ProfileVersion).filter_by(user_id=safe_user_id, profile_id=profile.id).count()
            session.add(
                ProfileVersion(
                    user_id=safe_user_id,
                    profile_id=profile.id,
                    extracted_json=profile_json,
                    cleaned_json=profile_json,
                    version_number=version_count + 1,
                    created_by_agent_run_id=agent_run_id,
                )
            )
            session.flush()
            return profile.id


class ScholarshipService:
    @staticmethod
    def save_clean_record(
        user_id: str,
        clean_json: dict[str, Any],
        source_text: str = "",
        agent_run_id: str | None = None,
    ) -> tuple[str, str] | tuple[None, None]:
        if not is_database_enabled():
            return None, None
        from persistence.models import ScholarshipCleanRecord, ScholarshipOpportunity

        safe_user_id = default_user_id(user_id)
        ensure_user(safe_user_id)
        name = _string(clean_json.get("name") or clean_json.get("scholarship_name") or "Scholarship opportunity")
        with session_scope() as session:
            opportunity = session.query(ScholarshipOpportunity).filter_by(user_id=safe_user_id, scholarship_name=name).first()
            if opportunity is None:
                opportunity = ScholarshipOpportunity(user_id=safe_user_id, scholarship_name=name)
                session.add(opportunity)
                session.flush()

            opportunity.source_url = _string(clean_json.get("officialWebsite") or clean_json.get("url"))[:2000] or None
            opportunity.source_text = source_text or clean_json.get("fullText") or None
            opportunity.opportunity_type = _string(clean_json.get("type"))[:120]
            opportunity.organization = _string(clean_json.get("organization"))[:500] or None
            opportunity.country_or_region = _string(clean_json.get("country"))[:255] or None
            opportunity.award = _string(clean_json.get("awardAmount"))[:500] or None
            opportunity.application_status = _string(clean_json.get("currentStatus"))[:120] or None
            opportunity.application_deadline = _string(clean_json.get("applicationDeadline"))[:120] or None
            opportunity.description = _string(clean_json.get("description")) or None

            session.query(ScholarshipCleanRecord).filter_by(
                user_id=safe_user_id,
                opportunity_id=opportunity.id,
                is_current=True,
            ).update({"is_current": False})
            version_count = session.query(ScholarshipCleanRecord).filter_by(
                user_id=safe_user_id,
                opportunity_id=opportunity.id,
            ).count()
            clean_record = ScholarshipCleanRecord(
                user_id=safe_user_id,
                opportunity_id=opportunity.id,
                agent_run_id=agent_run_id,
                clean_json=clean_json,
                version_number=version_count + 1,
                is_current=True,
            )
            session.add(clean_record)
            session.flush()
            return opportunity.id, clean_record.id

    @staticmethod
    def save_fit_analysis(
        user_id: str,
        scholarship_name: str,
        output_json: dict[str, Any],
        profile_id: str | None = None,
        clean_record_id: str | None = None,
        agent_run_id: str | None = None,
    ) -> str | None:
        if not is_database_enabled():
            return None
        from persistence.models import ScholarshipFitAnalysis, ScholarshipOpportunity

        safe_user_id = default_user_id(user_id)
        ensure_user(safe_user_id)
        name = _string(scholarship_name or output_json.get("scholarship_name") or "Scholarship opportunity")
        with session_scope() as session:
            opportunity = session.query(ScholarshipOpportunity).filter_by(user_id=safe_user_id, scholarship_name=name).first()
            if opportunity is None:
                opportunity = ScholarshipOpportunity(user_id=safe_user_id, scholarship_name=name)
                session.add(opportunity)
                session.flush()

            session.query(ScholarshipFitAnalysis).filter_by(
                user_id=safe_user_id,
                opportunity_id=opportunity.id,
                is_current=True,
            ).update({"is_current": False})
            version_count = session.query(ScholarshipFitAnalysis).filter_by(
                user_id=safe_user_id,
                opportunity_id=opportunity.id,
            ).count()
            analysis = ScholarshipFitAnalysis(
                user_id=safe_user_id,
                opportunity_id=opportunity.id,
                clean_record_id=clean_record_id,
                profile_id=profile_id,
                agent_run_id=agent_run_id,
                fit_label=_string(output_json.get("fit_label"))[:120],
                fit_score=int(output_json.get("fit_score") or 0),
                likely_eligible=_string(output_json.get("likely_eligible"))[:120],
                summary=_string(output_json.get("summary")),
                eligibility_analysis=_list(output_json.get("eligibility_analysis")),
                strengths=_list(output_json.get("strengths")),
                gaps_or_risks=_list(output_json.get("gaps_or_risks")),
                missing_student_information=_list(output_json.get("missing_student_information")),
                application_materials_check=_list(output_json.get("application_materials_check")),
                selection_criteria_alignment=_list(output_json.get("selection_criteria_alignment")),
                recommended_next_steps=_list(output_json.get("recommended_next_steps")),
                version_number=version_count + 1,
                is_current=True,
            )
            session.add(analysis)
            session.flush()
            return analysis.id


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

