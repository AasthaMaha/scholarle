from templates.base import SectionTemplate


PERSONAL_STATEMENT_TEMPLATE = SectionTemplate(
    name="Personal Statement / Essay",

    purpose="""
Coach the student to write a compelling, authentic personal statement that
answers the opportunity's essay prompt and reveals who they are.
""",

    inputs=[
        "opportunity_text",
        "opportunity_analysis",
    ],

    subsections=[
        "Hook / Opening",
        "Core Story or Motivation",
        "Reflection and Growth",
        "Connection to Goals",
    ],

    instructions=[
        "Make sure the draft directly answers the essay prompt",
        "Encourage a genuine, personal voice over generic statements",
        "Push for a specific story rather than a list of accomplishments",
        "Help the student show growth and self-reflection",
        "Tie the story to the student's future goals",
        "If a key detail is not in the profile, tell the student to add it",
    ],

    constraints=[
        "Do not write the essay for the student",
        "Do not invent experiences, feelings, or outcomes",
        "Base all factual claims on the profile evidence",
        "Avoid clichés and vague generalities",
    ],

    tone="Encouraging, authentic",
    length_guidance="Short to medium feedback",

    evaluation_criteria=[
        "Prompt alignment",
        "Authenticity of voice",
        "Clarity and focus",
        "Reflection and growth",
    ],
)
