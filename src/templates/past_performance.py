from templates.base import SectionTemplate


PAST_PERFORMANCE_TEMPLATE = SectionTemplate(
    name="Past Performance",

    purpose="""
Demonstrate relevant experience and success delivering similar work.
""",

    inputs=[
        "context_chunks"
    ],

    subsections=[
        "Relevant Projects",
        "Key Achievements",
        "Lessons Learned",
        "Applicability to This Effort"
    ],

    instructions=[
        "Highlight relevant past work",
        "Include measurable results if possible",
        "Connect past work to current requirements",
        "If required information is not present in the context, explicitly state that it is not available"
    ],

    constraints=[
        "Avoid generic descriptions",
        "Focus on relevance",
        "Be specific where possible",
        "ONLY use information explicitly found in the provided context",
        "DO NOT invent projects, clients, or metrics",
        "If no relevant past performance exists, explicitly say so",
        "Cite or paraphrase only from provided context_chunks"
    ],

    tone="Confident, evidence-based",
    length_guidance="Medium",

    evaluation_criteria=[
        "Relevance",
        "Credibility",
        "Demonstrated success"
    ]
)