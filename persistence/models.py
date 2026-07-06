from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.utcnow()


class Base(DeclarativeBase):
    pass


JSONB = JSON().with_variant(PG_JSONB, "postgresql")


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now, nullable=False)


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime)


class StudentProfile(Base, TimestampMixin):
    __tablename__ = "student_profiles"
    __table_args__ = (Index("ix_student_profiles_user_current", "user_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    degree_level: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    year_of_study: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    university: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    major: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    field_of_study: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    citizenship: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    residency: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    current_country: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    gpa: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    research_interests: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    skills: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    leadership_experience: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    work_experience: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    awards: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    publications: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    career_goals: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    available_documents: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    raw_profile_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    profile_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)


class ProfileVersion(Base):
    __tablename__ = "profile_versions"
    __table_args__ = (Index("ix_profile_versions_user_profile", "user_id", "profile_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    profile_id: Mapped[str] = mapped_column(String(36), ForeignKey("student_profiles.id"), index=True, nullable=False)
    source_document_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("user_documents.id"))
    extracted_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    cleaned_json: Mapped[dict | None] = mapped_column(JSONB)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by_agent_run_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("agent_runs.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)


class UserDocument(Base, TimestampMixin):
    __tablename__ = "user_documents"
    __table_args__ = (Index("ix_user_documents_user_type", "user_id", "document_type"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), default="", nullable=False)
    document_type: Mapped[str] = mapped_column(String(80), default="other", nullable=False)
    extracted_text: Mapped[str | None] = mapped_column(Text)
    text_hash: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime)


class ScholarshipSource(Base, TimestampMixin):
    __tablename__ = "scholarship_sources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[str] = mapped_column(String(2000), default="", nullable=False)
    category: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    cost: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    best_for: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    degree_levels: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    student_types: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    regions: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    fields: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    opportunity_types: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    search_tips: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    is_curated: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class SavedScholarshipSource(Base, TimestampMixin):
    __tablename__ = "saved_scholarship_sources"
    __table_args__ = (Index("ix_saved_sources_user", "user_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("scholarship_sources.id"))
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[str] = mapped_column(String(2000), default="", nullable=False)
    category: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    tags: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    saved_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)


class ScholarshipOpportunity(Base, TimestampMixin):
    __tablename__ = "scholarship_opportunities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    scholarship_name: Mapped[str] = mapped_column(String(500), nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(2000))
    source_text: Mapped[str | None] = mapped_column(Text)
    opportunity_type: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    organization: Mapped[str | None] = mapped_column(String(500))
    country_or_region: Mapped[str | None] = mapped_column(String(255))
    award: Mapped[str | None] = mapped_column(String(500))
    application_status: Mapped[str | None] = mapped_column(String(120))
    application_deadline: Mapped[str | None] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime)


class ScholarshipExtraction(Base):
    __tablename__ = "scholarship_extractions"
    __table_args__ = (Index("ix_scholarship_extractions_user_opportunity", "user_id", "opportunity_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    opportunity_id: Mapped[str] = mapped_column(String(36), ForeignKey("scholarship_opportunities.id"), index=True, nullable=False)
    agent_run_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("agent_runs.id"), index=True)
    raw_input: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    raw_output: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    extracted_markdown: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)


class ScholarshipCleanRecord(Base, TimestampMixin):
    __tablename__ = "scholarship_clean_records"
    __table_args__ = (Index("ix_clean_records_user_current", "user_id", "opportunity_id", "is_current"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    opportunity_id: Mapped[str] = mapped_column(String(36), ForeignKey("scholarship_opportunities.id"), index=True, nullable=False)
    agent_run_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("agent_runs.id"), index=True)
    clean_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ScholarshipFitAnalysis(Base):
    __tablename__ = "scholarship_fit_analyses"
    __table_args__ = (Index("ix_fit_user_opportunity_current", "user_id", "opportunity_id", "is_current"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    opportunity_id: Mapped[str] = mapped_column(String(36), ForeignKey("scholarship_opportunities.id"), index=True, nullable=False)
    clean_record_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("scholarship_clean_records.id"), index=True)
    profile_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("student_profiles.id"), index=True)
    agent_run_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("agent_runs.id"), index=True)
    fit_label: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    fit_score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    likely_eligible: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    eligibility_analysis: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    strengths: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    gaps_or_risks: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    missing_student_information: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    application_materials_check: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    selection_criteria_alignment: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    recommended_next_steps: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)


class ScholarshipTrackerItem(Base, TimestampMixin):
    __tablename__ = "scholarship_tracker_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    opportunity_id: Mapped[str] = mapped_column(String(36), ForeignKey("scholarship_opportunities.id"), index=True, nullable=False)
    fit_analysis_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("scholarship_fit_analyses.id"))
    status: Mapped[str] = mapped_column(String(80), default="discovered", nullable=False)
    priority: Mapped[str] = mapped_column(String(80), default="medium", nullable=False)
    deadline: Mapped[datetime | None] = mapped_column(DateTime)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    tasks: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    required_materials: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    completion_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class Essay(Base, TimestampMixin):
    __tablename__ = "essays"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    opportunity_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("scholarship_opportunities.id"), index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    prompt_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    current_version_id: Mapped[str | None] = mapped_column(String(36))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime)


class EssayVersion(Base):
    __tablename__ = "essay_versions"
    __table_args__ = (Index("ix_essay_versions_user_essay", "user_id", "essay_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    essay_id: Mapped[str] = mapped_column(String(36), ForeignKey("essays.id"), index=True, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    draft_text: Mapped[str] = mapped_column(Text, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[str] = mapped_column(String(80), default="user", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)


class EssayCoachingFeedback(Base):
    __tablename__ = "essay_coaching_feedback"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    essay_id: Mapped[str] = mapped_column(String(36), ForeignKey("essays.id"), index=True, nullable=False)
    essay_version_id: Mapped[str] = mapped_column(String(36), ForeignKey("essay_versions.id"), index=True, nullable=False)
    opportunity_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("scholarship_opportunities.id"), index=True)
    agent_run_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("agent_runs.id"), index=True)
    feedback_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    score_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)


class EssayAlignmentMatrix(Base, TimestampMixin):
    __tablename__ = "essay_alignment_matrices"
    __table_args__ = (Index("ix_essay_alignment_user_essay_current", "user_id", "essay_id", "is_current"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    opportunity_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("scholarship_opportunities.id"), index=True)
    essay_id: Mapped[str] = mapped_column(String(36), ForeignKey("essays.id"), index=True, nullable=False)
    essay_version_id: Mapped[str] = mapped_column(String(36), ForeignKey("essay_versions.id"), index=True, nullable=False)
    clean_record_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("scholarship_clean_records.id"), index=True)
    profile_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("student_profiles.id"), index=True)
    agent_run_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("agent_runs.id"), index=True)
    overall_alignment_status: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    completion_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    word_limit_status: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    matrix_json: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    missing_or_weak_items_json: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    unsupported_claims_json: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    strengths_json: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    recommended_revision_tasks_json: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    final_submission_readiness: Mapped[str] = mapped_column(Text, default="", nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class AgentDefinition(Base, TimestampMixin):
    __tablename__ = "agent_definitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    agent_name: Mapped[str] = mapped_column(String(160), unique=True, index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    agent_type: Mapped[str] = mapped_column(String(80), nullable=False)
    input_schema: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    output_schema: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(80), default="v1", nullable=False)
    model_provider: Mapped[str] = mapped_column(String(80), default="openai", nullable=False)
    model_name: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    uses_rag: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    rag_sources: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    agent_definition_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("agent_definitions.id"))
    agent_name: Mapped[str] = mapped_column(String(160), index=True, nullable=False)
    agent_version: Mapped[str | None] = mapped_column(String(80))
    workflow_name: Mapped[str | None] = mapped_column(String(160))
    input_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    output_json: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(80), default="running", nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    model_provider: Mapped[str | None] = mapped_column(String(80))
    model_name: Mapped[str | None] = mapped_column(String(120))
    prompt_version: Mapped[str | None] = mapped_column(String(80))
    token_usage: Mapped[dict | None] = mapped_column(JSONB)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class KnowledgeItem(Base, TimestampMixin):
    __tablename__ = "knowledge_items"
    __table_args__ = (Index("ix_knowledge_items_user_source", "user_id", "source_type", "source_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    source_type: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    source_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    canonical_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    structured_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    visibility: Mapped[str] = mapped_column(String(80), default="private", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class KnowledgeChunk(Base, TimestampMixin):
    __tablename__ = "knowledge_chunks"
    __table_args__ = (Index("ix_knowledge_chunks_user_item", "user_id", "knowledge_item_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    knowledge_item_id: Mapped[str] = mapped_column(String(36), ForeignKey("knowledge_items.id"), index=True, nullable=False)
    source_type: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    source_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    chroma_collection: Mapped[str] = mapped_column(String(160), nullable=False)
    chroma_id: Mapped[str] = mapped_column(String(255), nullable=False)
    embedding_model: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict, nullable=False)


class AgentContextChunk(Base):
    __tablename__ = "agent_context_chunks"
    __table_args__ = (Index("ix_agent_context_chunks_user_run", "user_id", "agent_run_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    agent_run_id: Mapped[str] = mapped_column(String(36), ForeignKey("agent_runs.id"), index=True, nullable=False)
    knowledge_chunk_id: Mapped[str] = mapped_column(String(36), ForeignKey("knowledge_chunks.id"), index=True, nullable=False)
    source_type: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    source_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    relevance_score: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)


class AppEvent(Base):
    __tablename__ = "app_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(String(36), index=True)
    event_type: Mapped[str] = mapped_column(String(160), index=True, nullable=False)
    entity_type: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), default="", nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
