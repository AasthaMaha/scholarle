from typing import Any, Dict, TypedDict


class ProfileExtractionState(TypedDict, total=False):
    resume_text: str
    name: str
    email: str
    location: str
    careerGoal: str
    educationLevel: str
    highSchool: Dict[str, Any]
    undergrad: Dict[str, Any]
    graduate: Dict[str, Any]
    optional: Dict[str, str]
