from typing import List, Literal

from pydantic import BaseModel, Field

from llm.client import llm


class HighSchoolAutofill(BaseModel):
    currentGrade: str = Field(description="Current grade if explicit: 9th, 10th, 11th, or 12th.")
    gradMonth: str = Field(description="Graduation month if explicit.")
    gradYear: str = Field(description="Graduation year if explicit.")
    gpa: str = Field(description="High school GPA if explicit.")
    gpaWeighting: str = Field(description="Weighted or Unweighted if explicit.")
    testStatus: str = Field(description="SAT / ACT status if explicit.")
    intendedStartYear: str = Field(description="Intended college start year if explicit.")
    intendedMajor: str = Field(description="Intended college major if explicit.")
    apIb: str = Field(description="AP, IB, dual-credit, honors, or advanced coursework from the resume.")
    extracurricular: str = Field(description="Extracurricular clubs, teams, or organizations.")
    activities: str = Field(description="Activities, work, family duties, athletics, awards, or responsibilities.")
    volunteer: str = Field(description="Volunteer service from the resume.")


class UndergradAutofill(BaseModel):
    institution: str = Field(description="College or university name if explicit.")
    collegeType: str = Field(description="2-year, 4-year, or Transfer student if explicit.")
    currentYear: str = Field(description="Freshman, Sophomore, Junior, Senior, or Super senior if explicit.")
    enrollment: str = Field(description="Full-time or Part-time if explicit.")
    major: str = Field(description="Major if explicit.")
    minor: str = Field(description="Minor if explicit.")
    gpa: str = Field(description="College GPA if explicit.")
    creditsCompleted: str = Field(description="Credits completed if explicit.")
    transferHistory: str = Field(description="Transfer history if explicit.")
    experience: str = Field(description="Internships, research, lab, work, or relevant experience.")
    orgsLeadership: str = Field(description="Student organizations and leadership roles.")
    scholarshipHistory: str = Field(description="Scholarships, grants, honors, or awards received.")


class GradAutofill(BaseModel):
    graduateLevel: str = Field(description="Master's, PhD, MBA, JD, MD, or Other if explicit.")
    program: str = Field(description="Graduate program name if explicit.")
    institution: str = Field(description="Graduate institution if explicit.")
    department: str = Field(description="Department if explicit.")
    researchArea: str = Field(description="Research area or concentration if explicit.")
    assistantshipStatus: str = Field(description="TA, RA, Fellowship, Self-funded, or Other if explicit.")
    licenses: str = Field(description="Professional licenses, exams, or certifications.")
    researchOutput: str = Field(description="Publications, presentations, posters, thesis, dissertation, or research output.")
    travelNeeds: str = Field(description="Conference travel or research expense needs only if explicit.")


class OptionalAutofill(BaseModel):
    societyInvolvement: str = Field(description="Clubs, societies, organizations, memberships, and roles.")
    leadership: str = Field(description="Leadership experience and leadership titles.")
    sports: str = Field(description="Sports, teams, varsity or club athletics.")
    articlesPublished: str = Field(description="Articles, publications, papers, outlets, links, or citations.")
    projects: str = Field(description="Personal, school, research, technical, or community projects.")


class EducationHistoryAutofill(BaseModel):
    id: str = Field(description="Stable short id for this entry, such as edu-1.")
    educationLevel: str = Field(description="High school, Undergraduate, Master's, PhD, Graduate, Professional degree, or Other.")
    institution: str = Field(description="School, college, university, or institution name if explicit.")
    degreeProgram: str = Field(description="Degree, diploma, certificate, or program name if explicit.")
    majorField: str = Field(description="Major, field of study, concentration, or intended field if explicit.")
    department: str = Field(description="Department or academic unit if explicit.")
    gpa: str = Field(description="GPA if explicit.")
    startDate: str = Field(description="Start date if explicit.")
    endDate: str = Field(description="End date, graduation date, or expected graduation if explicit.")


class ResearchExperienceAutofill(BaseModel):
    id: str = Field(description="Stable short id for this entry, such as research-1.")
    researchAreas: str = Field(description="Research areas, concentrations, or specialties if explicit.")
    researchProjects: str = Field(description="Research projects, lab work, capstones, or technical projects if explicit.")
    publications: str = Field(description="Publications, papers, articles, citations, or manuscripts if explicit.")
    conferences: str = Field(description="Conferences, presentations, posters, talks, or symposiums if explicit.")
    thesisStatus: str = Field(description="Thesis or dissertation status if explicit.")
    assistantshipStatus: str = Field(description="Teaching assistantship, research assistantship, fellowship, or funding status if explicit.")
    advisorLabDepartment: str = Field(description="Advisor, PI, lab, department, or research group if explicit.")


class WorkExperienceAutofill(BaseModel):
    id: str = Field(description="Stable short id for this entry, such as work-1.")
    roleTitle: str = Field(description="Role or title if explicit.")
    organization: str = Field(description="Organization, company, lab, school, or group if explicit.")
    experienceType: str = Field(description="Work, Internship, Research Assistant, Teaching Assistant, Volunteer, Leadership, or Other.")
    startDate: str = Field(description="Start date if explicit.")
    endDate: str = Field(description="End date or Present if explicit.")
    description: str = Field(description="Responsibilities, accomplishments, or role description.")
    skillsTechnologies: str = Field(description="Skills, tools, technologies, methods, or languages if explicit.")


class ExtractedProfile(BaseModel):
    name: str = Field(description="Applicant full name. Empty string if not found.")
    email: str = Field(description="Email address. Empty string if not found.")
    location: str = Field(description="City, state, or country from the resume. Empty string if not found.")
    careerGoal: str = Field(
        description="Career goal only when the resume explicitly states an objective, summary, or goal."
    )
    educationLevel: Literal["", "high_school", "undergrad", "grad", "phd"] = Field(
        description="Best match for the Scholar-E education level, or empty string if unclear."
    )
    highSchool: HighSchoolAutofill
    undergrad: UndergradAutofill
    graduate: GradAutofill
    educationHistory: List[EducationHistoryAutofill] = Field(
        description="All education entries found in the resume, including high school, undergraduate, graduate, PhD, certificates, and professional programs."
    )
    researchExperience: List[ResearchExperienceAutofill] = Field(
        description="Academic and research experience entries found in the resume."
    )
    workExperience: List[WorkExperienceAutofill] = Field(
        description="Work, internship, research assistant, teaching assistant, volunteer, and leadership roles found in the resume."
    )
    optional: OptionalAutofill


def _model_dump(value):
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return value.dict()


def extract_profile_fields(state):
    model = llm._get_client().with_structured_output(ExtractedProfile)
    result = model.invoke(
        [
            (
                "system",
                "You extract data for the Scholar-E scholarship profile UI. Fill only "
                "fields that match the profile UI labels. Do not infer race, ethnicity, "
                "citizenship, Pell eligibility, first-generation status, parent education, "
                "pronouns, or financial need. Use empty strings when a field is not explicit. "
                "Extract every visible education entry, research/academic experience, and "
                "work/internship/assistantship/volunteer/leadership role as separate editable list entries.",
            ),
            (
                "human",
                "Extract editable Scholar-E profile fields from this resume text:\n\n"
                f"{state.get('resume_text', '')}",
            ),
        ]
    )
    return _model_dump(result)


def _clean_text(value):
    return str(value or "").strip()


def _clean_dict(data):
    return {key: _clean_text(value) for key, value in (data or {}).items()}


def _clean_list(items):
    cleaned = []
    for idx, item in enumerate(items or [], start=1):
        entry = _clean_dict(item)
        if not any(value for key, value in entry.items() if key != "id"):
            continue
        entry["id"] = entry.get("id") or f"entry-{idx}"
        cleaned.append(entry)
    return cleaned


def clean_profile_fields(state):
    education_level = _clean_text(state.get("educationLevel"))
    if education_level not in {"high_school", "undergrad", "grad", "phd"}:
        education_level = ""

    return {
        "name": _clean_text(state.get("name")),
        "email": _clean_text(state.get("email")),
        "location": _clean_text(state.get("location")),
        "careerGoal": _clean_text(state.get("careerGoal")),
        "educationLevel": education_level,
        "highSchool": _clean_dict(state.get("highSchool")),
        "undergrad": _clean_dict(state.get("undergrad")),
        "graduate": _clean_dict(state.get("graduate")),
        "educationHistory": _clean_list(state.get("educationHistory")),
        "researchExperience": _clean_list(state.get("researchExperience")),
        "workExperience": _clean_list(state.get("workExperience")),
        "optional": _clean_dict(state.get("optional")),
    }








