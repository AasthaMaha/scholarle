from __future__ import annotations

from typing import Any


def _normalize_status(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in {"met", "ready"}:
        return "Ready"
    if text in {"not met", "not_met", "missing"}:
        return "Missing"
    if text in {"need to prepare", "in progress", "partially met", "partial"}:
        return "In progress"
    if text in {"not applicable", "n/a"}:
        return "Not applicable"
    return "Need to confirm"


def _risk_for_status(status: str) -> str:
    if status == "Ready" or status == "Not applicable":
        return "Low"
    if status == "In progress" or status == "Need to confirm":
        return "Medium"
    return "High"


def build_application_readiness_matrix(fit_data: dict[str, Any]) -> dict[str, Any]:
    rows: list[dict[str, str]] = []

    for item in fit_data.get("eligibility_analysis") or []:
        status = _normalize_status(item.get("status"))
        rows.append(
            {
                "item": str(item.get("requirement") or "").strip(),
                "item_type": "Eligibility",
                "status": status,
                "risk_level": _risk_for_status(status),
                "student_evidence": str(item.get("student_evidence") or "").strip(),
                "action_needed": str(item.get("action_needed") or item.get("explanation") or "").strip(),
                "notes": str(item.get("explanation") or "").strip(),
            }
        )

    for item in fit_data.get("application_materials_check") or []:
        status = _normalize_status(item.get("status"))
        rows.append(
            {
                "item": str(item.get("material") or "").strip(),
                "item_type": "Application material",
                "status": status,
                "risk_level": _risk_for_status(status),
                "student_evidence": "",
                "action_needed": str(item.get("notes") or "").strip(),
                "notes": str(item.get("notes") or "").strip(),
            }
        )

    active_rows = [row for row in rows if row["status"] != "Not applicable"]
    ready_count = sum(1 for row in active_rows if row["status"] == "Ready")
    completion = round((ready_count / len(active_rows)) * 100) if active_rows else 0
    blockers = [row for row in rows if row["risk_level"] == "High"]
    needs_work = [row for row in rows if row["status"] in {"Missing", "In progress", "Need to confirm"}]

    if not rows:
        overall = "Insufficient information"
    elif blockers:
        overall = "Blocked"
    elif needs_work:
        overall = "Needs preparation"
    else:
        overall = "Ready"

    return {
        "overall_status": overall,
        "completion_percent": completion,
        "ready_count": ready_count,
        "total_count": len(active_rows),
        "matrix": [row for row in rows if row["item"]],
        "blockers": blockers,
        "preparation_tasks": [
            row["action_needed"] or f"Confirm {row['item']}"
            for row in needs_work
            if row.get("item")
        ],
        "summary": (
            f"{ready_count} of {len(active_rows)} required eligibility/material items look ready."
            if active_rows
            else "No explicit readiness items were available to check."
        ),
    }

