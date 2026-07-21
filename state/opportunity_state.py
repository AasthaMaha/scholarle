from typing import Any, Dict, List, TypedDict


class OpportunityExtractionState(TypedDict, total=False):
    scholarship_name: str
    scholarship_url: str
    additional_notes: str
    source_text: str
    source_urls: List[str]
    source_metadata: List[Dict[str, Any]]
    extraction_warnings: List[str]
    resolution_status: str
    primary_url: str
    userProvidedNotes: str
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
    essayPromptEntries: List[Dict[str, Any]]
    selectedEssayPromptIds: List[str]
    noEssayPromptSelected: bool
    noEssayPromptConflictConfirmed: bool
    eligibilityRequirements: List[str]
    requiredApplicationMaterials: List[str]
    benefits: List[str]
    selectionCriteria: List[str]
    applicationProcess: List[str]
    importantNotes: List[str]
    requirements: List[Dict[str, str]]
    requirementsPreview: str
    fullText: str
    sourceUrls: List[str]
    sourceMetadata: List[Dict[str, Any]]
    fieldEvidence: List[Dict[str, Any]]
    extractionWarnings: List[str]
    validationWarnings: List[str]
    criticalFieldsFound: List[str]
    criticalFieldsMissing: List[str]
    completenessScore: int
    resolutionStatus: str
    extractedAt: str
