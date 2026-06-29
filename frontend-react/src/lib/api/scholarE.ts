import type { ActiveScholarship, AnalysisResult, UserProfile } from "@/lib/userStore";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export type AnalyzePayload = {
  cv_text: string;
  essay_text: string;
  scholarship_name: string;
  scholarship_type: string;
  prompt: string;
  previous_readiness?: Record<string, number>;
  draft_number?: number;
};

export type ResumeAutofillResult = {
  name: string;
  email: string;
  location: string;
  careerGoal: string;
  educationLevel: "" | "high_school" | "undergrad" | "grad" | "phd";
  highSchool: Record<string, string>;
  undergrad: Record<string, string>;
  graduate: Record<string, string>;
  optional: Record<string, string>;
};

export type OpportunityExtractPayload = {
  scholarship_name: string;
  scholarship_url: string;
  additional_notes: string;
};

export type OpportunityExtractResult = ActiveScholarship & {
  requirements?: Array<{ category?: string; requirement?: string; source?: string }>;
  sourceUrls?: string[];
};

function compact(parts: Array<string | undefined | null | false>) {
  return parts.filter(Boolean).join("\n\n");
}

export function profileToText(user: UserProfile | null) {
  if (!user) return "";

  return compact([
    `Name: ${user.name}`,
    user.email && `Email: ${user.email}`,
    user.pronouns && `Pronouns: ${user.pronouns}`,
    user.location && `Location: ${user.location}`,
    user.citizenshipStatus && `Citizenship/Residency Status: ${user.citizenshipStatus}`,
    user.raceEthnicity && `Race/Ethnicity: ${user.raceEthnicity}`,
    user.hispanicLatino && `Hispanic/Latino descent: ${user.hispanicLatino}`,
    user.firstGen && "First-generation college student",
    user.pellEligible && "Pell Grant eligible",
    user.identity && user.identity.length > 0
      ? `Identity/context: ${user.identity.join(", ")}`
      : undefined,
    user.careerGoal && `Career goal: ${user.careerGoal}`,
    user.educationLevel && `Education level: ${user.educationLevel}`,
    user.highSchool && `High school profile:\n${JSON.stringify(user.highSchool, null, 2)}`,
    user.undergrad && `Undergraduate profile:\n${JSON.stringify(user.undergrad, null, 2)}`,
    user.graduate && `Graduate profile:\n${JSON.stringify(user.graduate, null, 2)}`,
    user.optional && `Optional context:\n${JSON.stringify(user.optional, null, 2)}`,
    user.prompts && `Story prompt answers:\n${JSON.stringify(user.prompts, null, 2)}`,
    user.documents && user.documents.length > 0
      ? `Uploaded/identified documents:\n${user.documents
          .map((doc) => `- ${doc.kind}: ${doc.name}`)
          .join("\n")}`
      : undefined,
  ]);
}

export function buildAnalyzePayload(user: UserProfile | null): AnalyzePayload {
  const scholarship = user?.activeScholarship;
  const previousReadiness: Record<string, number> = {};
  Object.entries(user?.lastAnalysis?.readiness_index ?? {}).forEach(([key, value]) => {
    if (typeof value?.score === "number") previousReadiness[key] = value.score;
  });

  return {
    cv_text: profileToText(user),
    essay_text: user?.essayDraft ?? "",
    scholarship_name: scholarship?.name ?? "",
    scholarship_type: scholarship?.type ?? "",
    prompt: compact([
      scholarship?.url && `Scholarship URL/source: ${scholarship.url}`,
      scholarship?.awardAmount && `Award amount: ${scholarship.awardAmount}`,
      scholarship?.applicationDeadline && `Application deadline: ${scholarship.applicationDeadline}`,
      scholarship?.description && `Scholarship description:\n${scholarship.description}`,
      scholarship?.minimumGpa && `Minimum GPA: ${scholarship.minimumGpa}`,
      scholarship?.enrollmentLevel && `Enrollment level: ${scholarship.enrollmentLevel}`,
      scholarship?.citizenshipRequirement && `Citizenship/residency requirement: ${scholarship.citizenshipRequirement}`,
      scholarship?.financialNeedRequirement && `Financial need requirement: ${scholarship.financialNeedRequirement}`,
      scholarship?.locationRequirement && `Location/residency requirement: ${scholarship.locationRequirement}`,
      scholarship?.eligibleMajors && `Eligible majors/fields of study:\n${scholarship.eligibleMajors}`,
      scholarship?.otherEligibilityRules && `Other eligibility rules:\n${scholarship.otherEligibilityRules}`,
      !!scholarship?.requiredDocumentTypes?.length && `Required documents/materials: ${scholarship.requiredDocumentTypes.join(", ")}`,
      scholarship?.otherRequiredMaterials && `Other required materials:\n${scholarship.otherRequiredMaterials}`,
      scholarship?.essayPrompts && `Essay prompt(s):\n${scholarship.essayPrompts}`,
      scholarship?.requirementsPreview && `Student-edited scholarship requirements preview:\n${scholarship.requirementsPreview}`,
      scholarship?.additionalNotes && `Additional notes:\n${scholarship.additionalNotes}`,
      scholarship?.fullText && `Full scholarship page text:\n${scholarship.fullText}`,
    ]),
    previous_readiness: previousReadiness,
    draft_number: (user?.drafts?.length ?? 0) + 1,
  };
}

export async function analyzeApplication(payload: AnalyzePayload): Promise<AnalysisResult> {
  const response = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Scholar-E analysis failed.");
  }

  return data as AnalysisResult;
}

export async function autofillProfileFromResume(file: File): Promise<ResumeAutofillResult> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE}/api/profile/autofill-resume`, {
    method: "POST",
    body: formData,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Resume extraction failed.");
  }

  return data as ResumeAutofillResult;
}

export async function extractScholarshipOpportunity(
  payload: OpportunityExtractPayload,
): Promise<OpportunityExtractResult> {
  const response = await fetch(`${API_BASE}/api/opportunity/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Scholarship extraction failed.");
  }

  return data as OpportunityExtractResult;
}
