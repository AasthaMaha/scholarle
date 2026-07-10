from __future__ import annotations

import json
from pathlib import Path

from config import settings
from persistence.database import session_scope
from persistence.models import (
    AgentDefinition,
    ScholarshipCleanRecord,
    ScholarshipFitAnalysis,
    ScholarshipOpportunity,
    ScholarshipSource,
    ScholarshipTrackerItem,
    StudentProfile,
    User,
)
from persistence.agent_registry import CURRENT_AGENT_DEFINITIONS, agent_definition_by_name


def main() -> None:
    with session_scope() as session:
        user = session.query(User).filter_by(email="demo@scholar-e.local").one_or_none()
        if user is None:
            user = User(email="demo@scholar-e.local", full_name="Demo Scholar")
            session.add(user)
            session.flush()

        for item in CURRENT_AGENT_DEFINITIONS:
            if session.query(AgentDefinition).filter_by(agent_name=item["agent_name"]).one_or_none() is None:
                session.add(AgentDefinition(**agent_definition_by_name(item["agent_name"])))

        profile = session.query(StudentProfile).filter_by(user_id=user.id).one_or_none()
        if profile is None:
            profile = StudentProfile(
                user_id=user.id,
                display_name="Demo Scholar",
                degree_level="Undergraduate",
                university="Rice University",
                major="Computer Science",
                field_of_study="Computer Science",
                citizenship="Domestic",
                current_country="United States",
                gpa="3.8",
                skills={"items": ["Python", "machine learning", "data analysis"]},
                profile_json={"educationLevel": "undergrad", "opportunityPreferences": ["Scholarship", "Research funding"]},
            )
            session.add(profile)

        library_path = Path(__file__).resolve().parent.parent / "data" / "scholarship_source_library.json"
        for source in json.loads(library_path.read_text(encoding="utf-8")):
            if session.query(ScholarshipSource).filter_by(name=source["name"]).one_or_none() is None:
                session.add(
                    ScholarshipSource(
                        name=source["name"],
                        url=source.get("url", ""),
                        category=source.get("category", ""),
                        cost=source.get("cost", ""),
                        best_for=source.get("best_for", []),
                        degree_levels=source.get("degree_levels", []),
                        student_types=source.get("student_types", []),
                        regions=source.get("regions", []),
                        fields=source.get("fields", []),
                        opportunity_types=source.get("opportunity_types", []),
                        search_tips=source.get("search_tips", []),
                        notes=source.get("status_note", ""),
                    )
                )

        opportunity = session.query(ScholarshipOpportunity).filter_by(
            user_id=user.id,
            scholarship_name="SMART Scholarship-for-Service Program",
        ).one_or_none()
        if opportunity is None:
            opportunity = ScholarshipOpportunity(
                user_id=user.id,
                scholarship_name="SMART Scholarship-for-Service Program",
                source_url="https://www.smartscholarship.org/smart",
                opportunity_type="Scholarship",
                award="Tuition support, stipend, internships, and service pathway",
                description="Demo opportunity for persistence testing.",
            )
            session.add(opportunity)
            session.flush()

        clean_record = session.query(ScholarshipCleanRecord).filter_by(
            user_id=user.id,
            opportunity_id=opportunity.id,
            is_current=True,
        ).one_or_none()
        if clean_record is None:
            clean_record = ScholarshipCleanRecord(
                user_id=user.id,
                opportunity_id=opportunity.id,
                clean_json={"name": opportunity.scholarship_name, "awardAmount": opportunity.award},
                version_number=1,
                is_current=True,
            )
            session.add(clean_record)
            session.flush()

        if session.query(ScholarshipFitAnalysis).filter_by(user_id=user.id, opportunity_id=opportunity.id).one_or_none() is None:
            fit = ScholarshipFitAnalysis(
                user_id=user.id,
                opportunity_id=opportunity.id,
                clean_record_id=clean_record.id,
                profile_id=profile.id,
                fit_label="Demo Fit",
                fit_score=80,
                likely_eligible="Unclear",
                summary="Seeded demo fit analysis.",
                version_number=1,
                is_current=True,
            )
            session.add(fit)
            session.flush()
            session.add(
                ScholarshipTrackerItem(
                    user_id=user.id,
                    opportunity_id=opportunity.id,
                    fit_analysis_id=fit.id,
                    status="reviewing",
                    priority="high",
                    notes="Seeded tracker item.",
                    completion_percent=10,
                )
            )

    print("Seeded demo Scholar-E persistence data.")


if __name__ == "__main__":
    main()
