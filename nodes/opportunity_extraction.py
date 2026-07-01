import re

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


class CleanedOpportunity(BaseModel):
    scholarship_name: str = Field(description="Clean scholarship name, or empty string.")
    organization: str = Field(description="Sponsoring organization, or empty string.")
    type: str = Field(description="Short opportunity type, or empty string.")
    official_website: str = Field(description="Official website URL, or empty string.")
    country_or_region: str = Field(description="Country or region, or empty string.")
    award: str = Field(description="Funding amount or main award summary, or empty string.")
    application_status: str = Field(description="Open, closed, rolling, upcoming, or empty string.")
    application_opens: str = Field(description="Opening date/window, or empty string.")
    application_deadline: str = Field(description="Deadline, or empty string.")
    notification_date: str = Field(description="Notification date/window, or empty string.")
    program_start: str = Field(description="Program start date/window, or empty string.")
    program_end: str = Field(description="Program end date/window, or empty string.")
    description: str = Field(description="One concise factual description, or empty string.")
    eligibility_requirements: list[str] = Field(description="Applicant requirements only.")
    required_materials: list[str] = Field(description="Required submissions/materials only.")
    benefits: list[str] = Field(description="What the award provides.")
    selection_criteria: list[str] = Field(description="Evaluation criteria only when explicitly stated.")
    application_process: list[str] = Field(description="Clear application steps.")
    important_notes: list[str] = Field(description="Useful special details that do not fit elsewhere.")


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


def _is_emptyish(value):
    return str(value or "").strip().lower() in {
        "",
        "not stated",
        "unknown",
        "n/a",
        "not available",
        "none",
        "not clearly stated",
    }


def _blank_not_stated(value):
    return "" if _is_emptyish(value) else str(value).strip()


def _clean_optional_list(values):
    cleaned = []
    seen = set()
    for item in values or []:
        value = str(item or "").strip()
        if _is_emptyish(value):
            continue
        key = value.lower()
        if key not in seen:
            cleaned.append(value)
            seen.add(key)
    return cleaned


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
        "userProvidedNotes": str(state.get("additional_notes") or "").strip(),
        "sourceUrls": source_urls,
    }

    return cleaned


def _clean_record_preview(data):
    sections = []

    info_lines = []
    if data.get("name"):
        info_lines.append(f"Name: {data['name']}")
    if data.get("organization"):
        info_lines.append(f"Organization: {data['organization']}")
    if data.get("type"):
        info_lines.append(f"Type: {data['type']}")
    if data.get("country"):
        info_lines.append(f"Country/Region: {data['country']}")
    if data.get("officialWebsite") or data.get("url"):
        info_lines.append(f"Official Website: {data.get('officialWebsite') or data.get('url')}")
    if info_lines:
        sections.append("# Scholarship Information\n" + "\n".join(info_lines))

    timeline_lines = []
    if data.get("applicationOpens"):
        timeline_lines.append(f"Application Opens: {data['applicationOpens']}")
    if data.get("applicationDeadline"):
        timeline_lines.append(f"Application Deadline: {data['applicationDeadline']}")
    if data.get("notificationDate"):
        timeline_lines.append(f"Notification Date: {data['notificationDate']}")
    if data.get("programStart"):
        timeline_lines.append(f"Program Start: {data['programStart']}")
    if data.get("programEnd"):
        timeline_lines.append(f"Program End: {data['programEnd']}")
    if data.get("currentStatus"):
        timeline_lines.append(f"Status: {data['currentStatus']}")
    if timeline_lines:
        sections.append("# Timeline\n" + "\n".join(timeline_lines))

    if data.get("description"):
        sections.append("# Description\n" + data["description"])

    def add_list(title, values, numbered=False):
        items = _clean_optional_list(values)
        if not items:
            return
        if numbered:
            body = "\n".join(f"{index + 1}. {item}" for index, item in enumerate(items))
        else:
            body = "\n".join(f"- {item}" for item in items)
        sections.append(f"# {title}\n{body}")

    add_list("Eligibility Requirements", data.get("eligibilityRequirements"))
    add_list("Required Application Materials", data.get("requiredApplicationMaterials"))
    add_list("Benefits", data.get("benefits"))
    add_list("Selection Criteria", data.get("selectionCriteria"))
    add_list("Application Process", data.get("applicationProcess"), numbered=True)
    add_list("Important Notes", data.get("importantNotes"))

    return "\n\n".join(sections)


def _norm(value):
    return " ".join(str(value or "").lower().split())


def _is_material_like(value):
    text = _norm(value)
    material_words = {
        "essay",
        "transcript",
        "resume",
        "cv",
        "recommendation",
        "letter",
        "portfolio",
        "application form",
        "form",
        "passport",
        "identification",
        "id",
        "test scores",
        "proposal",
        "statement",
        "registration",
        "register",
    }
    action_words = {"submit", "submission", "upload", "provide", "attach", "complete", "register"}
    return any(word in text for word in material_words) or any(word in text for word in action_words)


def _is_selection_like(value):
    text = _norm(value)
    selection_words = {
        "selected based",
        "evaluated",
        "judged",
        "selection",
        "criteria",
        "academic merit",
        "academic excellence",
        "leadership",
        "community service",
        "research potential",
        "financial need",
        "innovation",
        "entrepreneurship",
        "essay quality",
    }
    return any(word in text for word in selection_words)


def _without_duplicates_or_materials(values, material_values):
    material_keys = {_norm(value) for value in material_values}
    cleaned = []
    seen = set()
    for value in values:
        key = _norm(value)
        if not key or key in seen or key in material_keys or _is_material_like(value):
            continue
        cleaned.append(value)
        seen.add(key)
    return cleaned


def _explicit_award_from_text(*texts):
    combined = "\n".join(str(text or "") for text in texts)
    matches = re.findall(r"\$\s?\d[\d,]*(?:\.\d{2})?(?:\s?(?:USD|usd|dollars?))?", combined)
    cleaned = []
    seen = set()
    for match in matches:
        value = re.sub(r"\s+", " ", match.replace("$ ", "$")).strip()
        key = value.lower().replace(",", "")
        if key not in seen:
            cleaned.append(value)
            seen.add(key)
    if len(cleaned) != 1:
        return ""
    award = cleaned[0]
    lower = combined.lower()
    context = ""
    if "each semester" in lower:
        context = " each semester"
    elif "per semester" in lower:
        context = " per semester"
    elif "annually" in lower or "per year" in lower:
        context = " annually"
    return f"{award}{context}".strip()


def _final_sanitize(mapped):
    materials = _clean_optional_list(mapped.get("requiredApplicationMaterials"))
    mapped["eligibilityRequirements"] = _without_duplicates_or_materials(
        mapped.get("eligibilityRequirements") or [],
        materials,
    )

    mapped["selectionCriteria"] = [
        item
        for item in _clean_optional_list(mapped.get("selectionCriteria"))
        if _is_selection_like(item) and not _is_material_like(item)
    ]

    notes = _clean_optional_list(mapped.get("importantNotes"))
    benefit_text = " ".join(mapped.get("benefits") or [])
    description_text = mapped.get("description") or ""
    timeline_text = " ".join([
        mapped.get("applicationOpens") or "",
        mapped.get("currentStatus") or "",
        description_text,
    ])

    if "spring" in _norm(benefit_text + " " + description_text) and "fall" in _norm(benefit_text + " " + description_text):
        notes.append("Awards are offered each semester in spring and fall.")
    if "year-round" in _norm(timeline_text) or "year round" in _norm(timeline_text):
        notes.append("Applications are accepted year-round.")
        if mapped.get("currentStatus") in {"Open", "Rolling"}:
            mapped["currentStatus"] = "Open year-round"

    mapped["importantNotes"] = _clean_optional_list(notes)
    mapped["missingInformation"] = []
    mapped["requirements"] = [
        {"category": "Eligibility", "requirement": item, "source": mapped["url"]}
        for item in mapped["eligibilityRequirements"]
    ]
    mapped["requirementsPreview"] = _clean_record_preview(mapped)
    return mapped


def clean_scholarship_output(state):
    snapshot = {
        "name": state.get("name", ""),
        "organization": state.get("organization", ""),
        "type": state.get("type", ""),
        "country": state.get("country", ""),
        "officialWebsite": state.get("officialWebsite", ""),
        "url": state.get("url", ""),
        "awardAmount": state.get("awardAmount", ""),
        "applicationOpens": state.get("applicationOpens", ""),
        "applicationDeadline": state.get("applicationDeadline", ""),
        "notificationDate": state.get("notificationDate", ""),
        "programStart": state.get("programStart", ""),
        "programEnd": state.get("programEnd", ""),
        "currentStatus": state.get("currentStatus", ""),
        "description": state.get("description", ""),
        "eligibilityRequirements": state.get("eligibilityRequirements", []),
        "requiredApplicationMaterials": state.get("requiredApplicationMaterials", []),
        "benefits": state.get("benefits", []),
        "selectionCriteria": state.get("selectionCriteria", []),
        "applicationProcess": state.get("applicationProcess", []),
        "requirementsPreview": state.get("requirementsPreview", ""),
    }

    model = llm._get_client().with_structured_output(CleanedOpportunity)
    result = model.invoke(
        [
            (
                "system",
                "You are a scholarship information cleaner. Take raw scholarship extraction "
                "output and make it clean for an editable UI. Do not search. Do not add facts. "
                "Do not evaluate applicant fit. Remove repeated facts, empty/unknown values, "
                "generic missing-information lists, markdown artifacts, and raw extractor labels. "
                "Keep eligibility limited to who can apply. Keep materials limited to what must "
                "be submitted. Keep selection criteria only when evaluation criteria are explicitly "
                "stated. Preserve factual meaning.",
            ),
            (
                "human",
                f"Clean this scholarship extraction JSON for UI display:\n{snapshot}",
            ),
        ]
    )
    cleaned = _model_dump(result)

    mapped = {
        "name": _blank_not_stated(cleaned.get("scholarship_name")) or _blank_not_stated(state.get("name")),
        "organization": _blank_not_stated(cleaned.get("organization")),
        "type": _blank_not_stated(cleaned.get("type")),
        "country": _blank_not_stated(cleaned.get("country_or_region")),
        "officialWebsite": _blank_not_stated(cleaned.get("official_website")),
        "url": _blank_not_stated(cleaned.get("official_website")) or _blank_not_stated(state.get("url")),
        "awardAmount": _blank_not_stated(cleaned.get("award")),
        "applicationOpens": _blank_not_stated(cleaned.get("application_opens")),
        "applicationDeadline": _blank_not_stated(cleaned.get("application_deadline")),
        "notificationDate": _blank_not_stated(cleaned.get("notification_date")),
        "programStart": _blank_not_stated(cleaned.get("program_start")),
        "programEnd": _blank_not_stated(cleaned.get("program_end")),
        "currentStatus": _blank_not_stated(cleaned.get("application_status")),
        "description": _blank_not_stated(cleaned.get("description")),
        "minimumGpa": _blank_not_stated(state.get("minimumGpa")),
        "enrollmentLevel": _blank_not_stated(state.get("enrollmentLevel")),
        "citizenshipRequirement": _blank_not_stated(state.get("citizenshipRequirement")),
        "financialNeedRequirement": _blank_not_stated(state.get("financialNeedRequirement")),
        "locationRequirement": _blank_not_stated(state.get("locationRequirement")),
        "eligibleMajors": _blank_not_stated(state.get("eligibleMajors")),
        "otherEligibilityRules": _blank_not_stated(state.get("otherEligibilityRules")),
        "requiredDocumentTypes": _clean_optional_list(cleaned.get("required_materials")),
        "otherRequiredMaterials": "",
        "essayPrompts": _blank_not_stated(state.get("essayPrompts")),
        "eligibilityRequirements": _clean_optional_list(cleaned.get("eligibility_requirements")),
        "requiredApplicationMaterials": _clean_optional_list(cleaned.get("required_materials")),
        "benefits": _clean_optional_list(cleaned.get("benefits")),
        "selectionCriteria": _clean_optional_list(cleaned.get("selection_criteria")),
        "applicationProcess": _clean_optional_list(cleaned.get("application_process")),
        "missingInformation": [],
        "importantNotes": _clean_optional_list(cleaned.get("important_notes")),
        "fullText": state.get("fullText", ""),
        "sourceUrls": state.get("sourceUrls", []),
    }
    mapped["requirements"] = [
        {"category": "Eligibility", "requirement": item, "source": mapped["url"]}
        for item in mapped["eligibilityRequirements"]
    ]
    mapped["requirementsPreview"] = _clean_record_preview(mapped)
    explicit_award = _explicit_award_from_text(state.get("userProvidedNotes", ""), state.get("additional_notes", ""))
    if not explicit_award:
        explicit_award = _explicit_award_from_text(state.get("source_text", ""), state.get("fullText", ""))
    if explicit_award:
        mapped["awardAmount"] = explicit_award
        benefits = _clean_optional_list(mapped.get("benefits"))
        if not any(explicit_award.lower().replace(",", "") in item.lower().replace(",", "") for item in benefits):
            benefits.insert(0, explicit_award)
        mapped["benefits"] = benefits
    return _final_sanitize(mapped)
