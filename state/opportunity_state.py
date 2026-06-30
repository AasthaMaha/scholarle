from typing import Any, Dict, List, TypedDict


class OpportunityExtractionState(TypedDict, total=False):
    scholarship_name: str
    scholarship_url: str
    additional_notes: str
    source_text: str
    source_urls: List[str]
    extraction: Dict[str, Any]

    name: str
    organization: str
    type: str
    country: str
    officialWebsite: str
    url: str
    applicationOpens: str
    applicationDeadline: str
    notificationDate: str
    programStart: str
    programEnd: str
    currentStatus: str
    awardAmount: str
    description: str
    minimumGpa: str
    enrollmentLevel: str
    citizenshipRequirement: str
    financialNeedRequirement: str
    locationRequirement: str
    eligibleMajors: str
    otherEligibilityRules: str
    requiredDocumentTypes: List[str]
    otherRequiredMaterials: str
    essayPrompts: str
    eligibilityRequirements: List[str]
    requiredApplicationMaterials: List[str]
    benefits: List[str]
    selectionCriteria: List[str]
    applicationProcess: List[str]
    missingInformation: List[str]
    importantNotes: List[str]
    requirements: List[Dict[str, str]]
    requirementsPreview: str
    fullText: str
    sourceUrls: List[str]
