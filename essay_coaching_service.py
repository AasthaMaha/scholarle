# essay_coaching_service.py
"""Essay Workspace coaching pipeline — a specialized, lighter path than the big
`/api/analyze` graph.

Phase 1 implements the Sentence Corrector. `run_essay_workspace_coach` always
returns the full coaching-package schema so the UI contract is stable; sections
that later phases will fill (prompt alignment, grounding, reviewer, scores, ...)
are returned empty for now.

Design notes:
- The LLM returns `original_text` verbatim; the FRONTEND anchors it to the draft
  (LLMs are unreliable at character offsets). We still validate here that each
  `original_text` is actually a substring of the draft and drop hallucinated or
  over-long ("full rewrite") suggestions — a lightweight guardrail ahead of the
  dedicated Guardrail Critic in a later phase.
"""

import json
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from pydantic import BaseModel, Field

from llm.client import llm
from templates.essay_coach import (
    REWRITE_ACTIONS,
    SENTENCE_SEVERITIES,
    SENTENCE_TYPES,
    build_combiner_prompt,
    build_final_check_prompt,
    build_guardrail_prompt,
    build_outline_coverage_prompt,
    build_profile_grounding_prompt,
    build_prompt_alignment_prompt,
    build_reviewer_prompt,
    build_rewrite_prompt,
    build_sentence_corrector_prompt,
    build_specificity_prompt,
    build_structure_flow_prompt,
    build_tone_authenticity_prompt,
)


def _clamp_score(value) -> int:
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        return 0


class SentenceSuggestion(BaseModel):
    original_text: str = ""
    suggested_text: str = ""
    suggestion_type: str = "clarity"
    reason: str = ""
    severity: str = "medium"


class SentenceCorrectorOutput(BaseModel):
    sentence_suggestions: list[SentenceSuggestion] = Field(default_factory=list)


class PromptAlignmentOutput(BaseModel):
    alignment_score: int = 0
    covered_requirements: list[str] = Field(default_factory=list)
    missing_requirements: list[str] = Field(default_factory=list)
    weakly_covered_requirements: list[str] = Field(default_factory=list)
    comments: list[str] = Field(default_factory=list)
    revision_tasks: list[str] = Field(default_factory=list)


class ProfileGroundingOutput(BaseModel):
    grounding_score: int = 0
    supported_claims: list[str] = Field(default_factory=list)
    unsupported_or_risky_claims: list[str] = Field(default_factory=list)
    unused_relevant_profile_evidence: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)


class ParagraphFeedback(BaseModel):
    paragraph_number: int = 0
    main_issue: str = ""
    strength: str = ""
    suggestion: str = ""
    priority: str = "medium"


class StructureFlowOutput(BaseModel):
    structure_score: int = 0
    paragraph_feedback: list[ParagraphFeedback] = Field(default_factory=list)
    flow_issues: list[str] = Field(default_factory=list)
    recommended_reordering: list[str] = Field(default_factory=list)
    revision_tasks: list[str] = Field(default_factory=list)


class SpecificityOutput(BaseModel):
    specificity_score: int = 0
    vague_statements: list[str] = Field(default_factory=list)
    places_to_add_detail: list[str] = Field(default_factory=list)
    impact_opportunities: list[str] = Field(default_factory=list)
    recommended_questions: list[str] = Field(default_factory=list)


class ToneAuthenticityOutput(BaseModel):
    authenticity_score: int = 0
    tone_score: int = 0
    ai_like_phrases: list[str] = Field(default_factory=list)
    generic_phrases: list[str] = Field(default_factory=list)
    voice_preservation_notes: list[str] = Field(default_factory=list)
    tone_improvement_suggestions: list[str] = Field(default_factory=list)


class ReviewerOutput(BaseModel):
    reviewer_reaction: str = ""
    competitiveness_score: int = 0
    likely_strengths_seen_by_reviewer: list[str] = Field(default_factory=list)
    likely_concerns_seen_by_reviewer: list[str] = Field(default_factory=list)
    questions_reviewer_may_have: list[str] = Field(default_factory=list)
    competitiveness_notes: list[str] = Field(default_factory=list)


class RevisionPriority(BaseModel):
    priority: str = ""
    why_it_matters: str = ""
    how_to_fix: str = ""
    estimated_effort: str = ""
    impact: str = ""


class CombinerOutput(BaseModel):
    coach_summary: str = ""
    top_revision_priorities: list[RevisionPriority] = Field(default_factory=list)
    quick_fixes: list[str] = Field(default_factory=list)
    deeper_revision_tasks: list[str] = Field(default_factory=list)
    ready_for_evaluation: bool = False


class GuardrailOutput(BaseModel):
    approved: bool = True
    unsafe_suggestion_indices: list[int] = Field(default_factory=list)
    issues_found: list[str] = Field(default_factory=list)
    final_notes: list[str] = Field(default_factory=list)


class FinalCheckOutput(BaseModel):
    ready_for_final_review: bool = False
    remaining_blockers: list[str] = Field(default_factory=list)
    final_polish_notes: list[str] = Field(default_factory=list)
    submission_warning: str = ""


class OutlineCoverageOutput(BaseModel):
    covered_point_ids: list[str] = Field(default_factory=list)


class RewriteOutput(BaseModel):
    rewritten_text: str = ""
    note: str = ""


def _empty_package(status: str = "success") -> dict:
    return {
        "status": status,
        "overall_scores": {},
        "sentence_suggestions": [],
        "paragraph_feedback": [],
        "tone_feedback": {},
        "structure_feedback": {},
        "specificity_feedback": {},
        "prompt_alignment": {},
        "profile_grounding": {},
        "reviewer_simulation": {},
        "outline_coverage": {},
        "guardrail": {},
        "final_check": {},
        "revision_priorities": [],
        "quick_fixes": [],
        "deeper_revision_tasks": [],
        "warnings": [],
        "coach_summary": "",
        "ready_for_final_review": False,
    }


def _scholarship_context(record: Optional[dict]) -> str:
    if not record:
        return ""
    keys = (
        "name",
        "type",
        "description",
        "selectionCriteria",
        "essayPrompts",
        "otherRequiredMaterials",
        "requirementsPreview",
    )
    parts = []
    for key in keys:
        value = record.get(key)
        if not value:
            continue
        if isinstance(value, list):
            value = "; ".join(str(item) for item in value)
        parts.append(f"{key}: {value}")
    return "\n".join(parts)[:4000]


def _clean_sentence_suggestions(
    draft: str,
    raw: list,
    max_suggestions: int = 40,
) -> list[dict]:
    """Drop hallucinated anchors, over-long rewrites, and duplicates."""
    draft_lower = draft.lower()
    seen: set = set()
    cleaned: list[dict] = []
    for item in raw:
        original = (item.original_text or "").strip()
        suggested = (item.suggested_text or "").strip()
        if not original or not suggested or original == suggested:
            continue
        # The anchor must exist verbatim in the draft.
        if original.lower() not in draft_lower:
            continue
        # Guard against over-rewrites / full-essay generation.
        if len(suggested) > max(len(original) * 3, len(original) + 160):
            continue
        stype = item.suggestion_type if item.suggestion_type in SENTENCE_TYPES else "clarity"
        severity = item.severity if item.severity in SENTENCE_SEVERITIES else "medium"
        key = (original.lower(), suggested.lower())
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(
            {
                "original_text": original,
                "suggested_text": suggested,
                "suggestion_type": stype,
                "reason": (item.reason or "").strip(),
                "severity": severity,
            }
        )
        if len(cleaned) >= max_suggestions:
            break
    return cleaned


def _run_sentence_corrector(
    essay_draft: str,
    essay_prompt: str,
    scholarship_context: str,
    user_notes: str,
    writing_support_level: str = "sentence_polish",
) -> list:
    system, human = build_sentence_corrector_prompt(
        essay_draft=essay_draft,
        essay_prompt=essay_prompt,
        scholarship_context=scholarship_context,
        user_notes=user_notes,
        writing_support_level=writing_support_level,
    )
    model = llm._get_client().with_structured_output(SentenceCorrectorOutput)
    result = model.invoke([("system", system), ("human", human)])
    return result.sentence_suggestions or []


def _profile_text(student_profile: Optional[dict]) -> str:
    if not student_profile:
        return ""
    text = student_profile.get("profile_text")
    if isinstance(text, str) and text.strip():
        return text[:8000]
    parts = []
    for key, value in student_profile.items():
        if isinstance(value, (str, int, float)) and str(value).strip():
            parts.append(f"{key}: {value}")
    return "\n".join(parts)[:8000]


def _run_prompt_alignment(essay_draft: str, essay_prompt: str, scholarship_context: str) -> dict:
    system, human = build_prompt_alignment_prompt(
        essay_draft=essay_draft,
        essay_prompt=essay_prompt,
        scholarship_context=scholarship_context,
    )
    model = llm._get_client().with_structured_output(PromptAlignmentOutput)
    result = model.invoke([("system", system), ("human", human)])
    data = result.model_dump()
    data["alignment_score"] = _clamp_score(data.get("alignment_score"))
    return data


def _run_profile_grounding(essay_draft: str, profile_text: str, scholarship_context: str) -> dict:
    system, human = build_profile_grounding_prompt(
        essay_draft=essay_draft,
        profile_text=profile_text,
        scholarship_context=scholarship_context,
    )
    model = llm._get_client().with_structured_output(ProfileGroundingOutput)
    result = model.invoke([("system", system), ("human", human)])
    data = result.model_dump()
    data["grounding_score"] = _clamp_score(data.get("grounding_score"))
    return data


def _outline_text(personalized_outline: Optional[dict]) -> str:
    outline = (personalized_outline or {}).get("outline") if isinstance(personalized_outline, dict) else None
    if not isinstance(outline, dict):
        return ""
    parts = []
    if outline.get("thesis_or_core_message"):
        parts.append(f"Core message: {outline['thesis_or_core_message']}")
    for i, section in enumerate(outline.get("sections") or [], start=1):
        if isinstance(section, dict) and section.get("section_name"):
            parts.append(f"{i}. {section['section_name']}: {section.get('purpose', '')}")
    return "\n".join(parts)[:3000]


def _run_structure_flow(essay_draft: str, essay_prompt: str, personalized_outline_text: str) -> dict:
    system, human = build_structure_flow_prompt(
        essay_draft=essay_draft,
        essay_prompt=essay_prompt,
        personalized_outline=personalized_outline_text,
    )
    model = llm._get_client().with_structured_output(StructureFlowOutput)
    data = model.invoke([("system", system), ("human", human)]).model_dump()
    data["structure_score"] = _clamp_score(data.get("structure_score"))
    return data


def _run_specificity(essay_draft: str, profile_text: str, scholarship_context: str) -> dict:
    system, human = build_specificity_prompt(
        essay_draft=essay_draft,
        profile_text=profile_text,
        scholarship_context=scholarship_context,
    )
    model = llm._get_client().with_structured_output(SpecificityOutput)
    data = model.invoke([("system", system), ("human", human)]).model_dump()
    data["specificity_score"] = _clamp_score(data.get("specificity_score"))
    return data


def _run_tone_authenticity(essay_draft: str, profile_text: str, scholarship_context: str) -> dict:
    system, human = build_tone_authenticity_prompt(
        essay_draft=essay_draft,
        profile_text=profile_text,
        scholarship_context=scholarship_context,
    )
    model = llm._get_client().with_structured_output(ToneAuthenticityOutput)
    data = model.invoke([("system", system), ("human", human)]).model_dump()
    data["authenticity_score"] = _clamp_score(data.get("authenticity_score"))
    data["tone_score"] = _clamp_score(data.get("tone_score"))
    return data


def _run_reviewer(essay_draft: str, essay_prompt: str, scholarship_context: str) -> dict:
    system, human = build_reviewer_prompt(
        essay_draft=essay_draft,
        essay_prompt=essay_prompt,
        scholarship_context=scholarship_context,
    )
    model = llm._get_client().with_structured_output(ReviewerOutput)
    data = model.invoke([("system", system), ("human", human)]).model_dump()
    data["competitiveness_score"] = _clamp_score(data.get("competitiveness_score"))
    return data


def _run_combiner(specialist_summary: str) -> dict:
    system, human = build_combiner_prompt(specialist_summary=specialist_summary)
    model = llm._get_client().with_structured_output(CombinerOutput)
    return model.invoke([("system", system), ("human", human)]).model_dump()


def _run_guardrail_critic(essay_draft: str, profile_text: str, sentence_suggestions: list) -> dict:
    suggestions_json = json.dumps(
        [
            {"index": i, "original": s.get("original_text", ""), "suggested": s.get("suggested_text", "")}
            for i, s in enumerate(sentence_suggestions)
        ],
        default=str,
    )[:8000]
    system, human = build_guardrail_prompt(
        essay_draft=essay_draft,
        profile_text=profile_text,
        suggestions_json=suggestions_json,
    )
    model = llm._get_client().with_structured_output(GuardrailOutput)
    return model.invoke([("system", system), ("human", human)]).model_dump()


def _run_final_check(
    essay_draft: str,
    essay_prompt: str,
    scholarship_context: str,
    profile_text: str,
    word_count: int,
    word_limit: str,
) -> dict:
    system, human = build_final_check_prompt(
        essay_draft=essay_draft,
        essay_prompt=essay_prompt,
        scholarship_context=scholarship_context,
        profile_text=profile_text,
        word_count=word_count,
        word_limit=word_limit,
    )
    model = llm._get_client().with_structured_output(FinalCheckOutput)
    return model.invoke([("system", system), ("human", human)]).model_dump()


def _word_limit_number(word_limit: str) -> Optional[int]:
    import re

    nums = re.findall(r"\d{2,5}", word_limit or "")
    return max(int(n) for n in nums) if nums else None


def _run_outline_coverage(essay_draft: str, outline_points: list, scholarship_context: str) -> dict:
    points = [{"id": p.get("id", ""), "label": p.get("label", "")} for p in (outline_points or []) if p.get("id")]
    if not points:
        return {"covered_point_ids": []}
    system, human = build_outline_coverage_prompt(
        essay_draft=essay_draft,
        outline_points_json=json.dumps(points, default=str)[:6000],
        scholarship_context=scholarship_context,
    )
    model = llm._get_client().with_structured_output(OutlineCoverageOutput)
    data = model.invoke([("system", system), ("human", human)]).model_dump()
    valid = {p["id"] for p in points}
    # Defense in depth: drop any id the model invented (the frontend also intersects).
    data["covered_point_ids"] = [i for i in (data.get("covered_point_ids") or []) if i in valid]
    return data


def run_selection_rewrite(
    action: str,
    selected_text: str,
    surrounding_text: str = "",
    essay_prompt: str = "",
    clean_scholarship_record: Optional[dict] = None,
    student_profile: Optional[dict] = None,
) -> dict:
    """Rewrite/shorten/expand/improve-tone a selected passage. Never fabricates facts."""
    selected_text = (selected_text or "").strip()
    if not selected_text:
        return {"status": "error", "rewritten_text": "", "note": "No text was selected."}
    action = action if action in REWRITE_ACTIONS else "rewrite"
    system, human = build_rewrite_prompt(
        action=action,
        selected_text=selected_text,
        surrounding_text=(surrounding_text or "")[:4000],
        essay_prompt=essay_prompt,
        scholarship_context=_scholarship_context(clean_scholarship_record),
        profile_text=_profile_text(student_profile),
    )
    try:
        model = llm._get_client().with_structured_output(RewriteOutput)
        data = model.invoke([("system", system), ("human", human)]).model_dump()
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "rewritten_text": "", "note": f"Rewrite failed: {exc}"}

    rewritten = (data.get("rewritten_text") or "").strip()
    note = (data.get("note") or "").strip()
    if not rewritten:
        return {"status": "success", "rewritten_text": selected_text, "note": note or "Kept your original text."}
    # Length guardrail — an implausibly large expansion is likely fabrication; keep the original.
    if len(rewritten) > max(len(selected_text) * 3, len(selected_text) + 300):
        return {
            "status": "success",
            "rewritten_text": selected_text,
            "note": note or "The rewrite added too much, so your original was kept — add the detail yourself to stay grounded.",
        }
    return {"status": "success", "rewritten_text": rewritten, "note": note}


def _derive_writing_scores(sentence_suggestions: list) -> tuple[int, int]:
    """Derive clarity and grammar/mechanics scores from the sentence suggestions."""
    weight = {"low": 3, "medium": 6, "high": 10}
    grammar_types = {"grammar"}
    clarity_types = {"clarity", "flow", "transition", "concision", "word_choice"}
    grammar_penalty = 0
    clarity_penalty = 0
    for item in sentence_suggestions:
        w = weight.get(item.get("severity"), 6)
        if item.get("suggestion_type") in grammar_types:
            grammar_penalty += w
        if item.get("suggestion_type") in clarity_types:
            clarity_penalty += w
    return _clamp_score(100 - clarity_penalty), _clamp_score(100 - grammar_penalty)


def _compose_summary(package: dict) -> str:
    parts = []
    align = package.get("prompt_alignment") or {}
    ground = package.get("profile_grounding") or {}
    count = len(package.get("sentence_suggestions") or [])

    if align:
        missing = align.get("missing_requirements") or []
        weak = align.get("weakly_covered_requirements") or []
        gap = (missing[:1] or weak[:1] or [""])[0]
        parts.append(
            f"Prompt alignment is {align.get('alignment_score', 0)}/100"
            + (f" — the biggest gap is: {gap}." if gap else ".")
        )
    if ground:
        risky = ground.get("unsupported_or_risky_claims") or []
        unused = ground.get("unused_relevant_profile_evidence") or []
        note = ""
        if risky:
            note = f" Double-check {len(risky)} claim(s) your profile doesn't yet support."
        elif unused:
            note = f" You could strengthen it with unused evidence like: {unused[0]}"
        parts.append(f"Profile grounding is {ground.get('grounding_score', 0)}/100.{note}")
    if count:
        parts.append(f"There {'is' if count == 1 else 'are'} {count} sentence-level fix{'' if count == 1 else 'es'} in Sentence Fixes.")

    if not parts:
        return "No major issues stood out. Keep drafting and run the coach again as your essay grows."
    return " ".join(parts)


def run_essay_workspace_coach(
    student_profile: Optional[dict] = None,
    clean_scholarship_record: Optional[dict] = None,
    essay_prompt: str = "",
    essay_draft: str = "",
    personalized_outline: Optional[dict] = None,
    user_notes: Optional[str] = None,
    word_limit: str = "",
    outline_points: Optional[list] = None,
    mode: str = "full",
    writing_support_level: str = "sentence_polish",
) -> dict:
    """Coordinate the Essay Workspace coaching specialists and return one package.

    Specialists run concurrently so even a "full" run stays close to one call's
    latency, then the Combiner synthesizes them into one action plan:
      - Sentence Corrector      (modes: full, grammar_tone)
      - Prompt Alignment Coach  (modes: full, prompt_alignment)
      - Profile Grounding Coach (modes: full, prompt_alignment)
      - Flow & Structure Coach  (modes: full, structure)
      - Specificity Coach       (modes: full, structure)
      - Tone & Authenticity     (modes: full)
      - Reviewer Simulation     (modes: full, reviewer)
      - Revision Combiner       (mode:  full)
    Each specialist fails independently into a warning rather than failing the run.
    """
    essay_draft = (essay_draft or "").strip()
    package = _empty_package()

    if not essay_draft:
        package["status"] = "error"
        package["coach_summary"] = "Add an essay draft, then run the coach."
        package["warnings"] = ["No essay draft provided."]
        return package

    warnings: list[str] = []
    if not clean_scholarship_record:
        warnings.append("No cleaned scholarship record found, so scholarship-specific coaching is limited.")
    if not essay_prompt:
        warnings.append("No essay prompt found, so prompt-alignment coaching is limited.")
    if not student_profile:
        warnings.append("No student profile found, so profile-grounding feedback is limited.")

    scholarship_context = _scholarship_context(clean_scholarship_record)
    profile_text = _profile_text(student_profile)
    outline_text = _outline_text(personalized_outline)
    word_count = len(essay_draft.split())

    # Final readiness check is a standalone, holistic pass (no specialist battery).
    if mode == "final_check":
        try:
            final = _run_final_check(essay_draft, essay_prompt, scholarship_context, profile_text, word_count, word_limit)
        except Exception as exc:  # noqa: BLE001
            package["status"] = "error"
            package["warnings"] = warnings + [f"final check failed: {exc}"]
            package["coach_summary"] = "Scholar-E could not run the final check this time. Please try again."
            return package

        limit = _word_limit_number(word_limit)
        if limit and word_count > limit and not final.get("submission_warning"):
            final["submission_warning"] = f"Your essay is {word_count} words, over the {limit}-word limit."
        blockers = final.get("remaining_blockers") or []
        package["final_check"] = final
        package["ready_for_final_review"] = bool(final.get("ready_for_final_review")) and not (limit and word_count > limit)
        package["warnings"] = warnings
        package["coach_summary"] = (
            "Your essay looks ready for a final review — no major blockers remain."
            if package["ready_for_final_review"]
            else f"Not ready for final review yet: {len(blockers)} blocker(s) to resolve first."
        )
        return package

    outline_points = outline_points or []
    enabled = {
        "sentence": mode in ("full", "workspace_refresh", "grammar_tone", "auto_check"),
        "alignment": mode in ("full", "prompt_alignment"),
        "grounding": mode in ("full", "prompt_alignment"),
        "structure": mode in ("full", "structure"),
        "specificity": mode in ("full", "structure"),
        "tone": mode in ("full",),
        "reviewer": mode in ("full", "workspace_refresh", "reviewer"),
        "coverage": mode in ("full", "auto_check") and bool(outline_points),
    }
    runners = {
        "sentence": lambda: _run_sentence_corrector(essay_draft, essay_prompt, scholarship_context, user_notes or "", writing_support_level),
        "alignment": lambda: _run_prompt_alignment(essay_draft, essay_prompt, scholarship_context),
        "grounding": lambda: _run_profile_grounding(essay_draft, profile_text, scholarship_context),
        "structure": lambda: _run_structure_flow(essay_draft, essay_prompt, outline_text),
        "specificity": lambda: _run_specificity(essay_draft, profile_text, scholarship_context),
        "tone": lambda: _run_tone_authenticity(essay_draft, profile_text, scholarship_context),
        "reviewer": lambda: _run_reviewer(essay_draft, essay_prompt, scholarship_context),
        "coverage": lambda: _run_outline_coverage(essay_draft, outline_points, scholarship_context),
    }

    jobs = {name: run for name, run in runners.items() if enabled[name]}
    results: dict = {}
    with ThreadPoolExecutor(max_workers=max(1, len(jobs))) as pool:
        futures = {name: pool.submit(run) for name, run in jobs.items()}
        for name, future in futures.items():
            try:
                results[name] = future.result()
            except Exception as exc:  # noqa: BLE001 — degrade one specialist, keep the rest
                results[name] = None
                warnings.append(f"{name} coaching failed: {exc}")

    scores: dict = {}
    if results.get("sentence") is not None:
        package["sentence_suggestions"] = _clean_sentence_suggestions(essay_draft, results["sentence"])
        clarity, grammar = _derive_writing_scores(package["sentence_suggestions"])
        scores["clarity"] = clarity
        scores["grammar_mechanics"] = grammar
    if results.get("alignment"):
        package["prompt_alignment"] = results["alignment"]
        scores["prompt_alignment"] = results["alignment"].get("alignment_score", 0)
    if results.get("grounding"):
        package["profile_grounding"] = results["grounding"]
        scores["profile_grounding"] = results["grounding"].get("grounding_score", 0)
    if results.get("structure"):
        package["structure_feedback"] = results["structure"]
        package["paragraph_feedback"] = results["structure"].get("paragraph_feedback", [])
        scores["structure_flow"] = results["structure"].get("structure_score", 0)
    if results.get("specificity"):
        package["specificity_feedback"] = results["specificity"]
        scores["specificity"] = results["specificity"].get("specificity_score", 0)
    if results.get("tone"):
        package["tone_feedback"] = results["tone"]
        scores["authenticity"] = results["tone"].get("authenticity_score", 0)
    if results.get("reviewer"):
        package["reviewer_simulation"] = results["reviewer"]
        scores["competitiveness"] = results["reviewer"].get("competitiveness_score", 0)
    if results.get("coverage"):
        package["outline_coverage"] = results["coverage"]

    package["overall_scores"] = scores
    package["warnings"] = warnings

    if jobs and all(results.get(name) is None for name in jobs):
        package["status"] = "error"
        package["coach_summary"] = "Scholar-E could not analyze the draft this time. Please try again."
        return package

    # Post-processing: the Guardrail Critic audits the sentence suggestions, and
    # (for a full run) the Combiner synthesizes an action plan — run concurrently.
    def _combiner_job():
        summary_input = json.dumps(
            {
                "overall_scores": scores,
                "sentence_suggestion_count": len(package["sentence_suggestions"]),
                "prompt_alignment": package["prompt_alignment"],
                "profile_grounding": package["profile_grounding"],
                "structure_feedback": package["structure_feedback"],
                "specificity_feedback": package["specificity_feedback"],
                "tone_feedback": package["tone_feedback"],
                "reviewer_simulation": package["reviewer_simulation"],
            },
            default=str,
        )[:12000]
        return _run_combiner(summary_input)

    post_jobs = {}
    if package["sentence_suggestions"] and mode in ("full", "workspace_refresh"):
        post_jobs["guardrail"] = lambda: _run_guardrail_critic(essay_draft, profile_text, package["sentence_suggestions"])
    if mode == "full" and any(results.get(name) is not None for name in results):
        post_jobs["combiner"] = _combiner_job

    post_results: dict = {}
    if post_jobs:
        with ThreadPoolExecutor(max_workers=len(post_jobs)) as pool:
            post_futures = {name: pool.submit(run) for name, run in post_jobs.items()}
            for name, future in post_futures.items():
                try:
                    post_results[name] = future.result()
                except Exception as exc:  # noqa: BLE001
                    post_results[name] = None
                    warnings.append(f"{name} failed: {exc}")

    # Apply the Guardrail Critic: drop any suggestion it flagged as unsafe.
    guardrail = post_results.get("guardrail")
    if guardrail:
        unsafe = {int(i) for i in guardrail.get("unsafe_suggestion_indices", []) if isinstance(i, int) or str(i).isdigit()}
        if unsafe:
            removed = [s.get("suggested_text", "") for i, s in enumerate(package["sentence_suggestions"]) if i in unsafe]
            package["sentence_suggestions"] = [s for i, s in enumerate(package["sentence_suggestions"]) if i not in unsafe]
            clarity, grammar = _derive_writing_scores(package["sentence_suggestions"])
            scores["clarity"] = clarity
            scores["grammar_mechanics"] = grammar
            package["overall_scores"] = scores
            guardrail["removed_or_revised_suggestions"] = removed
            if removed:
                warnings.append(f"Guardrail removed {len(removed)} suggestion(s) that risked adding unsupported claims.")
        package["guardrail"] = guardrail

    combined = post_results.get("combiner")
    if combined:
        package["revision_priorities"] = combined.get("top_revision_priorities", [])
        package["quick_fixes"] = combined.get("quick_fixes", [])
        package["deeper_revision_tasks"] = combined.get("deeper_revision_tasks", [])
        package["ready_for_final_review"] = bool(combined.get("ready_for_evaluation"))
        package["coach_summary"] = combined.get("coach_summary") or _compose_summary(package)
    else:
        package["coach_summary"] = _compose_summary(package)

    package["warnings"] = warnings
    return package
