from templates.base import SectionTemplate


TECHNICAL_TEMPLATE = SectionTemplate(
    name="Technical Approach",

    purpose="""
Describe how the solution meets requirements with clarity,
specificity, and credibility.
""",

    inputs=[
        "requirements",
        "context_chunks"
    ],

    subsections=[
        "Solution Overview",
        "Architecture",
        "Implementation Plan",
        "Risk Mitigation"
    ],

    instructions=[
        "Address requirements explicitly",
        "Use clear and structured explanations",
        "Reference relevant past approaches if available",
        "Explain how risks are mitigated",
        "If required information is not present in the context, explicitly state that it is not available"
    ],

    constraints=[
        "Avoid vague statements",
        "Do not overuse buzzwords",
        "Ensure logical flow",
        "Base all claims on provided context_chunks",
        "Do not invent capabilities not supported by context",
        "If information is missing, state assumptions clearly"
    ],

    tone="Technical, precise",
    length_guidance="Medium to long",

    evaluation_criteria=[
        "Completeness",
        "Technical feasibility",
        "Clarity"
    ]
)