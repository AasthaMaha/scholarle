import type { AnalysisResult, UserProfile } from "@/lib/userStore";

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
    user.nationality && `Nationality: ${user.nationality}`,
    user.raceEthnicity && `Race/Ethnicity: ${user.raceEthnicity}`,
    user.hispanicLatino && `Hispanic/Latino descent: ${user.hispanicLatino}`,
    user.firstGen && "First-generation college student",
    user.pellEligible && "Pell Grant eligible",
    user.identity?.length && `Identity/context: ${user.identity.join(", ")}`,
    user.careerGoal && `Career goal: ${user.careerGoal}`,
    user.educationLevel && `Education level: ${user.educationLevel}`,
    user.highSchool && `High school profile:\n${JSON.stringify(user.highSchool, null, 2)}`,
    user.undergrad && `Undergraduate profile:\n${JSON.stringify(user.undergrad, null, 2)}`,
    user.graduate && `Graduate profile:\n${JSON.stringify(user.graduate, null, 2)}`,
    user.optional && `Optional context:\n${JSON.stringify(user.optional, null, 2)}`,
    user.prompts && `Story prompt answers:\n${JSON.stringify(user.prompts, null, 2)}`,
    user.documents?.length &&
      `Uploaded/identified documents:\n${user.documents
        .map((doc) => `- ${doc.kind}: ${doc.name}`)
        .join("\n")}`,
  ]);
}

export function buildAnalyzePayload(user: UserProfile | null): AnalyzePayload {
  const scholarship = user?.activeScholarship;

  return {
    cv_text: profileToText(user),
    essay_text: user?.essayDraft ?? "",
    scholarship_name: scholarship?.name ?? "",
    scholarship_type: scholarship?.type ?? "",
    prompt: compact([
      scholarship?.url && `Scholarship URL/source: ${scholarship.url}`,
      scholarship?.description,
    ]),
    previous_readiness: user?.lastAnalysis?.readiness_index
      ? Object.fromEntries(
          Object.entries(user.lastAnalysis.readiness_index)
            .filter(([, value]) => typeof value?.score === "number")
            .map(([key, value]) => [key, value.score]),
        )
      : {},
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
