from templates.base import SectionTemplate


EXECUTIVE_SUMMARY_TEMPLATE = SectionTemplate(
    name="Executive Summary",

    purpose="""
Provide a compelling overview that highlights win themes,
customer understanding, and differentiators.
""",

    inputs=[
        "rfp_text",
        "themes",
        "evaluation_criteria"
    ],

    subsections=[
        "Customer Understanding",
        "Our Approach",
        "Key Differentiators",
        "Expected Outcomes"
    ],

    instructions=[
        "Clearly demonstrate understanding of the customer’s problem",
        "Highlight 2-3 strong win themes",
        "Use persuasive and confident language",
        "Tie benefits to customer outcomes",
        "If required information is not present in the context, explicitly state that it is not available"
    ],

    constraints=[
        "Avoid generic statements",
        "Do not repeat the RFP verbatim",
        "Be concise and impactful"
    ],

    tone="Persuasive, executive-level",
    length_guidance="Short to medium",

    evaluation_criteria=[
        "Clarity of value proposition",
        "Alignment to customer needs",
        "Strength of differentiators"
    ]
)