from templates.base import SectionTemplate


LEADERSHIP_IMPACT_TEMPLATE = SectionTemplate(
    name="Leadership & Community Impact",

    purpose="""
Coach the student to clearly demonstrate genuine leadership and measurable
impact on their school or community.
""",

    inputs=[
        "opportunity_analysis",
    ],

    subsections=[
        "Role and Initiative",
        "Actions Taken",
        "Measurable Impact",
        "What the Student Learned",
    ],

    instructions=[
        "Help the student show initiative, not just participation",
        "Encourage concrete, measurable outcomes (numbers, scope, results)",
        "Connect leadership experiences to the opportunity's evaluation themes",
        "Highlight collaboration and effect on others",
        "If impact metrics are missing, tell the student to add them",
    ],

    constraints=[
        "Do not invent titles, metrics, or outcomes",
        "Only use leadership facts found in the profile evidence",
        "Avoid exaggeration; keep claims credible and supported",
    ],

    tone="Confident, evidence-based",
    length_guidance="Medium feedback",

    evaluation_criteria=[
        "Demonstrated initiative",
        "Measurable impact",
        "Relevance to the opportunity",
    ],
)
