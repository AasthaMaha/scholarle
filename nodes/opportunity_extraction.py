from pydantic import BaseModel, Field

from llm.client import llm


class ExtractedOpportunity(BaseModel):
    name: str = Field(description='Scholarship/opportunity name, or "Not stated".')
    organization: str = Field(description='Sponsoring organization, or "Not stated".')
    type: str = Field(description='Scholarship, Fellowship, Grant, Internship, Workshop, Exchange Program, Research Award, or "Not stated".')
    country: str = Field(description='Country/region where the opportunity applies, or "Not stated".')
    officialWebsite: str = Field(description='Official website URL, or "Not stated".')
    applicationOpens: str = Field(description='Application opening date/window, or "Not stated".')
    applicationDeadline: str = Field(description='Application deadline, or "Not stated".')
    notificationDate: str = Field(description='Notification date/window, or "Not stated".')
    programStart: str = Field(description='Program start date, or "Not stated".')
    programEnd: str = Field(description='Program end date, or "Not stated".')
    currentStatus: str = Field(description='Open, Closed, Upcoming, Rolling, Unknown, or "Not stated".')
    eligibilityRequirements: list[str] = Field(description='All explicitly stated eligibility requirements. Use exact language when possible.')
    requiredApplicationMaterials: list[str] = Field(description='All explicitly required documents or application materials.')
    benefits: list[str] = Field(description='All explicitly stated funding, stipend, travel, housing, mentorship, networking, or other benefits.')
    selectionCriteria: list[str] = Field(description='All explicitly stated evaluation or selection criteria.')
    applicationProcess: list[str] = Field(description='Application steps, submission platform, forms, interview stages, or other process steps.')
    missingInformation: list[str] = Field(description='Fields or sections not explicitly provided in the source text.')
    awardAmount: str = Field(description='Funding amount or award value, or "Not stated".')
    description: str = Field(description='Concise factual description, or "Not stated".')
    minimumGpa: str = Field(description='Minimum GPA requirement, or "Not stated".')
    enrollmentLevel: str = Field(description='Required degree/enrollment/academic level, or "Not stated".')
    citizenshipRequirement: str = Field(description='Citizenship requirement, or "Not stated".')
    financialNeedRequirement: str = Field(description='Financial need requirement, or "Not stated".')
    locationRequirement: str = Field(description='Residency/location/university requirement, or "Not stated".')
    eligibleMajors: str = Field(description='Eligible fields of study/majors, or "Not stated".')
    otherEligibilityRules: str = Field(description='Other eligibility rules, or "Not stated".')
    requiredDocumentTypes: list[str] = Field(description='Short names of required materials.')
    otherRequiredMaterials: str = Field(description='Required material details not captured in the short list, or "Not stated".')
    essayPrompts: str = Field(description='Essay prompts or short-answer questions, or "Not stated".')
    requirementsPreview: str = Field(description='Complete editable output in the requested sectioned format.')
    fullText: str = Field(description='Relevant source excerpt or condensed source text used for extraction.')


def _model_dump(value):
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return value.dict()


def extract_opportunity_fields(state):
    model = llm._get_client().with_structured_output(ExtractedOpportunity)
    result = model.invoke(
        [
            (
                "system",
                "You are a Scholarship Requirements Extraction Agent. Your only job is to "
                "extract scholarship information and application requirements from the provided "
                "scholarship name, URL, webpage/PDF text, or user description. Do not evaluate "
                "the applicant. Do not score fit. Do not recommend whether to apply. Do not infer "
                "missing facts. Extract only information explicitly stated in the provided sources. "
                'If a field is unavailable, write "Not stated". Prefer official scholarship sources. '
                "If sources conflict, use the official source. Preserve exact eligibility wording "
                "when possible. Be complete but concise.",
            ),
            (
                "human",
                "Extract this opportunity using these sections: Scholarship Information, Timeline, "
                "Eligibility Requirements, Required Application Materials, Benefits, Selection "
                "Criteria, Application Process, and Missing Information.\n\n"
                f"Scholarship name or query:\n{state.get('scholarship_name', '')}\n\n"
                f"Scholarship URL/source:\n{state.get('scholarship_url', '')}\n\n"
                f"Additional user notes:\n{state.get('additional_notes', '')}\n\n"
                f"Source URLs checked:\n{chr(10).join(state.get('source_urls', []) or [])}\n\n"
                f"Source text:\n{state.get('source_text', '')}",
            ),
        ]
    )
    return {"extraction": _model_dump(result)}


def _clean_text(value):
    text = str(value or "").strip()
    return text or "Not stated"


def _clean_list(values):
    cleaned = []
    seen = set()
    for item in values or []:
      value = str(item or "").strip()
      key = value.lower()
      if value and key not in seen:
          cleaned.append(value)
          seen.add(key)
    return cleaned or ["Not stated"]


def _preview(data):
    eligibility = _clean_list(data.get("eligibilityRequirements"))
    materials = _clean_list(data.get("requiredApplicationMaterials") or data.get("requiredDocumentTypes"))
    benefits = _clean_list(data.get("benefits"))
    criteria = _clean_list(data.get("selectionCriteria"))
    process = _clean_list(data.get("applicationProcess"))
    missing = _clean_list(data.get("missingInformation"))

    def bullets(items):
        return "\n".join(f"- {item}" for item in items)

    def numbered(items):
        return "\n".join(f"{index + 1}. {item}" for index, item in enumerate(items))

    return (
        "# Scholarship Information\n"
        f"Name: {_clean_text(data.get('name'))}\n"
        f"Organization: {_clean_text(data.get('organization'))}\n"
        f"Type: {_clean_text(data.get('type'))}\n"
        f"Country: {_clean_text(data.get('country'))}\n"
        f"Official Website: {_clean_text(data.get('officialWebsite') or data.get('url'))}\n\n"
        "# Timeline\n"
        f"Application Opens: {_clean_text(data.get('applicationOpens'))}\n"
        f"Application Deadline: {_clean_text(data.get('applicationDeadline'))}\n"
        f"Notification Date: {_clean_text(data.get('notificationDate'))}\n"
        f"Program Start: {_clean_text(data.get('programStart'))}\n"
        f"Program End: {_clean_text(data.get('programEnd'))}\n"
        f"Status: {_clean_text(data.get('currentStatus'))}\n\n"
        "# Eligibility Requirements\n"
        f"{bullets(eligibility)}\n\n"
        "# Required Application Materials\n"
        f"{bullets(materials)}\n\n"
        "# Benefits\n"
        f"{bullets(benefits)}\n\n"
        "# Selection Criteria\n"
        f"{bullets(criteria)}\n\n"
        "# Application Process\n"
        f"{numbered(process)}\n\n"
        "# Missing Information\n"
        f"{bullets(missing)}"
    )


def clean_opportunity_fields(state):
    data = state.get("extraction") or {}
    source_urls = state.get("source_urls") or []
    official_url = _clean_text(data.get("officialWebsite"))
    if official_url == "Not stated" and source_urls:
        official_url = source_urls[0]

    required_docs = _clean_list(data.get("requiredDocumentTypes"))
    if required_docs == ["Not stated"]:
        required_docs = [item for item in _clean_list(data.get("requiredApplicationMaterials")) if item != "Not stated"]

    eligibility = _clean_list(data.get("eligibilityRequirements"))
    requirements = [
        {"category": "Eligibility", "requirement": item, "source": official_url if official_url != "Not stated" else ""}
        for item in eligibility
        if item != "Not stated"
    ]

    preview_text = str(data.get("requirementsPreview") or "").strip()
    if not preview_text or preview_text.lower() == "not stated":
        preview_text = _preview(data)

    cleaned = {
        "name": _clean_text(data.get("name") or state.get("scholarship_name")),
        "organization": _clean_text(data.get("organization")),
        "type": _clean_text(data.get("type")),
        "country": _clean_text(data.get("country")),
        "officialWebsite": official_url,
        "url": official_url if official_url != "Not stated" else _clean_text(state.get("scholarship_url")),
        "applicationOpens": _clean_text(data.get("applicationOpens")),
        "applicationDeadline": _clean_text(data.get("applicationDeadline")),
        "notificationDate": _clean_text(data.get("notificationDate")),
        "programStart": _clean_text(data.get("programStart")),
        "programEnd": _clean_text(data.get("programEnd")),
        "currentStatus": _clean_text(data.get("currentStatus")),
        "awardAmount": _clean_text(data.get("awardAmount")),
        "description": _clean_text(data.get("description")),
        "minimumGpa": _clean_text(data.get("minimumGpa")),
        "enrollmentLevel": _clean_text(data.get("enrollmentLevel")),
        "citizenshipRequirement": _clean_text(data.get("citizenshipRequirement")),
        "financialNeedRequirement": _clean_text(data.get("financialNeedRequirement")),
        "locationRequirement": _clean_text(data.get("locationRequirement")),
        "eligibleMajors": _clean_text(data.get("eligibleMajors")),
        "otherEligibilityRules": _clean_text(data.get("otherEligibilityRules")),
        "requiredDocumentTypes": required_docs,
        "otherRequiredMaterials": _clean_text(data.get("otherRequiredMaterials")),
        "essayPrompts": _clean_text(data.get("essayPrompts")),
        "eligibilityRequirements": eligibility,
        "requiredApplicationMaterials": _clean_list(data.get("requiredApplicationMaterials")),
        "benefits": _clean_list(data.get("benefits")),
        "selectionCriteria": _clean_list(data.get("selectionCriteria")),
        "applicationProcess": _clean_list(data.get("applicationProcess")),
        "missingInformation": _clean_list(data.get("missingInformation")),
        "requirements": requirements,
        "requirementsPreview": preview_text,
        "fullText": str(data.get("fullText") or state.get("source_text") or "").strip()[:20000],
        "sourceUrls": source_urls,
    }

    return cleaned
