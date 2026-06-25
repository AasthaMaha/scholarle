# nodes/routing.py
"""Strategic branching for the coaching graph.

These router functions let the graph skip agents that cannot add value for a
given submission instead of always running every agent in a fixed line:

  - Empty/placeholder submissions short-circuit to a zero-LLM node.
  - The discovery agent runs only when there is real profile evidence.
  - The narrative, section, and reviewer agents run only when there is a real
    draft to read.
"""

from utils.input_validation import word_count

# A draft below this many words is treated as "no real draft yet".
MIN_DRAFT_WORDS = 20
# Profile evidence below this many words is treated as "no real profile yet".
MIN_PROFILE_WORDS = 15

GENERATION_NODES = [
    "strategy_agent",
    "eligibility_agent",
    "discovery_agent",
    "narrative_agent",
    "coach_sections",
]


def _draft_words(state) -> int:
    return word_count(state.get("student_draft", ""))


def has_draft(state) -> bool:
    return _draft_words(state) >= MIN_DRAFT_WORDS


def has_profile(state) -> bool:
    profile_text = state.get("profile_text")
    if profile_text and profile_text != "(none retrieved)":
        return word_count(profile_text) >= MIN_PROFILE_WORDS

    docs = state.get("student_profile_docs") or []
    text = " ".join(
        getattr(doc, "page_content", None) or str(doc) for doc in docs
    )
    return word_count(text) >= MIN_PROFILE_WORDS


def route_entry(state) -> str:
    """Skip the whole pipeline when there is nothing substantive to coach."""
    if not has_draft(state) and not has_profile(state):
        return "insufficient_input"
    return "analyze_opportunity"


def route_generators(state) -> list:
    """Fan out only to the generation agents that have something to work on."""
    # Strategy + eligibility matrix are always useful: they read the opportunity
    # requirements and report what is met / violated / missing in the profile.
    targets = ["strategy_agent", "eligibility_agent"]
    if has_profile(state):
        targets.append("discovery_agent")
    if has_draft(state):
        targets.append("narrative_agent")
        targets.append("coach_sections")
    return targets


def route_after_generation(state) -> str:
    """Reviewer simulation only matters when reviewers have a draft to read."""
    if has_draft(state):
        return "reviewer_agent"
    return "combine_coaching"


def post_generation(state):
    """Join point for the parallel generation agents (pass-through)."""
    return {}
