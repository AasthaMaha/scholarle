from templates.base import SectionTemplate


EXPERIENCE_ACHIEVEMENTS_TEMPLATE = SectionTemplate(
    name="Experience & Achievements",

    purpose="""
Coach the student to present relevant experience, projects, and achievements
that show fit for the opportunity.
""",

    inputs=[
        "opportunity_analysis",
    ],

    subsections=[
        "Relevant Experience",
        "Key Achievements",
        "Skills Demonstrated",
        "Relevance to This Opportunity",
    ],

    instructions=[
        "Highlight experiences most relevant to the opportunity",
        "Encourage specific, verifiable achievements over generic claims",
        "Connect each item back to what the opportunity values",
        "Help the student show the skills these experiences demonstrate",
        "If a relevant experience or result is missing, tell the student to add it",
    ],

    constraints=[
        "ONLY use experiences and achievements found in the profile evidence",
        "Do not invent projects, awards, roles, or metrics",
        "Focus on relevance and credibility",
    ],

    tone="Confident, specific",
    length_guidance="Medium feedback",

    evaluation_criteria=[
        "Relevance",
        "Credibility",
        "Demonstrated skills and results",
    ],
)
