import type { ActiveScholarship, DiscoveryIntent, EssayReviewResult, FitAnalysisResult, PersonalizedOutlineResult, UserProfile, WikiDiscoveryResult } from "@/lib/userStore";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export type ResumeAutofillResult = {
  name: string;
  email: string;
  location: string;
  careerGoal: string;
  educationLevel: "" | "high_school" | "undergrad" | "grad" | "phd";
  highSchool: Record<string, string>;
  undergrad: Record<string, string>;
  graduate: Record<string, string>;
  educationHistory?: UserProfile["educationHistory"];
  researchExperience?: UserProfile["researchExperience"];
  workExperience?: UserProfile["workExperience"];
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

export type FitAnalyzePayload = {
  scholarship_record: ActiveScholarship;
  student_profile: Record<string, unknown>;
};

export type WikiDiscoverPayload = {
  student_profile: Record<string, unknown>;
  discovery_focus?: string;
  selected_intents?: DiscoveryIntent[];
  free_text_intent?: string;
  excluded_urls?: string[];
  feedback?: Array<{ url?: string; reason?: string; name?: string }>;
};

export type WikiDiscoveryBootstrapResult = {
  intent_options: DiscoveryIntent[];
  platform_defaults: NonNullable<WikiDiscoveryResult["top_free_platforms"]>;
  profile_summary: {
    education_level?: string;
    field_of_study?: string;
    student_type?: string;
  };
};

export type OutlineGeneratePayload = {
  opportunity_id?: string;
  scholarship_name?: string;
  student_profile: Record<string, unknown>;
  clean_scholarship_record: ActiveScholarship;
  essay_prompt: string;
  essay_type?: string;
  word_limit?: string;
  user_notes?: string;
};

function compact(parts: Array<string | undefined | null | false>) {
  return parts.filter(Boolean).join("\n\n");
}

export function profileToText(user: UserProfile | null) {
  if (!user) return "";

  return compact([
    `Name: ${user.name}`,
    user.email && `Email: ${user.email}`,
    user.gender && `Gender: ${user.gender}`,
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
    user.educationHistory?.length
      ? `Education history:\n${JSON.stringify(user.educationHistory, null, 2)}`
      : undefined,
    user.researchExperience?.length
      ? `Academic/research experience:\n${JSON.stringify(user.researchExperience, null, 2)}`
      : undefined,
    user.workExperience?.length
      ? `Work and internship experience:\n${JSON.stringify(user.workExperience, null, 2)}`
      : undefined,
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

/** Split a scholarship prompt blob into choosable essay prompts. */
export function splitEssayPrompts(raw: string): string[] {
  const text = (raw || "").trim();
  if (!text) return [];

  const byLabel = text
    .split(/(?=(?:^|\n)\s*(?:Prompt|Essay|Question)\s*\d+\s*[:.)])/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (byLabel.length > 1) return byLabel;

  const byNumber = text
    .split(/(?=(?:^|\n)\s*\d+[.)]\s+\S)/)
    .map((part) => part.trim())
    .filter((part) => part.length > 20);
  if (byNumber.length > 1) return byNumber;

  const byBlank = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 40);
  if (byBlank.length > 1) return byBlank;

  return [text];
}

function buildOpportunityPrompt(user: UserProfile | null, essayPromptOverride?: string): string {
  const scholarship = user?.activeScholarship;
  const selectedPrompt = (essayPromptOverride
    || scholarship?.essayPrompts
    || scholarship?.otherRequiredMaterials
    || scholarship?.requirementsPreview
    || "").trim();

  return compact([
      selectedPrompt && `Selected essay prompt:\n${selectedPrompt}`,
      scholarship?.description && `Scholarship description:\n${scholarship.description}`,
      scholarship?.requirementsPreview && `Student-edited scholarship requirements preview:\n${scholarship.requirementsPreview}`,
      scholarship?.financialNeedRequirement && `Financial need requirement: ${scholarship.financialNeedRequirement}`,
      scholarship?.otherRequiredMaterials && `Other required materials:\n${scholarship.otherRequiredMaterials}`,
      scholarship?.url && `Scholarship URL/source: ${scholarship.url}`,
      scholarship?.awardAmount && `Award amount: ${scholarship.awardAmount}`,
      scholarship?.applicationDeadline && `Application deadline: ${scholarship.applicationDeadline}`,
      scholarship?.minimumGpa && `Minimum GPA: ${scholarship.minimumGpa}`,
      scholarship?.enrollmentLevel && `Enrollment level: ${scholarship.enrollmentLevel}`,
      scholarship?.citizenshipRequirement && `Citizenship/residency requirement: ${scholarship.citizenshipRequirement}`,
      scholarship?.locationRequirement && `Location/residency requirement: ${scholarship.locationRequirement}`,
      scholarship?.eligibleMajors && `Eligible majors/fields of study:\n${scholarship.eligibleMajors}`,
      scholarship?.otherEligibilityRules && `Other eligibility rules:\n${scholarship.otherEligibilityRules}`,
      !!scholarship?.requiredDocumentTypes?.length && `Required documents/materials: ${scholarship.requiredDocumentTypes.join(", ")}`,
      scholarship?.additionalNotes && `Additional notes:\n${scholarship.additionalNotes}`,
      scholarship?.fullText && `Full scholarship page text:\n${scholarship.fullText}`,
    ]).slice(0, 10_000);
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

export function buildFitPayload(user: UserProfile | null): FitAnalyzePayload {
  const { fitAnalysis, ...studentProfile } = user ?? { name: "", email: "" };
  void fitAnalysis;

  return {
    scholarship_record: user?.activeScholarship ?? {},
    student_profile: {
      ...studentProfile,
      profile_text: profileToText(user),
      available_documents: user?.documents ?? [],
      essay_draft_available: !!user?.essayDraft?.trim(),
      essay_word_count: user?.essayDraft?.trim()
        ? user.essayDraft.trim().split(/\s+/).length
        : 0,
    },
  };
}

export async function analyzeScholarshipFit(payload: FitAnalyzePayload): Promise<FitAnalysisResult> {
  const response = await fetch(`${API_BASE}/api/fit/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Scholarship fit analysis failed.");
  }

  return data as FitAnalysisResult;
}

export function buildWikiPayload(user: UserProfile | null): WikiDiscoverPayload {
  const {
    fitAnalysis,
    wikiDiscovery,
    savedWikiSources,
    activeScholarship,
    discoveryFocus,
    discoveryIntents,
    discoveryIntentOptions,
    discoveryPlatformDefaults,
    dismissedDiscoveryUrls,
    discoveryFeedback,
    ...studentProfile
  } = user ?? { name: "", email: "" };
  void fitAnalysis;
  void wikiDiscovery;
  void savedWikiSources;
  void activeScholarship;
  void discoveryFocus;
  void discoveryIntents;
  void discoveryIntentOptions;
  void discoveryPlatformDefaults;
  void dismissedDiscoveryUrls;
  void discoveryFeedback;

  return {
    student_profile: {
      ...studentProfile,
      profile_text: profileToText(user),
    },
    selected_intents: user?.discoveryIntents ?? [],
    free_text_intent: user?.discoveryFocus ?? "",
    excluded_urls: user?.dismissedDiscoveryUrls ?? [],
    feedback: user?.discoveryFeedback ?? [],
  };
}

export async function discoverScholarshipWiki(payload: WikiDiscoverPayload): Promise<WikiDiscoveryResult> {
  const response = await fetch(`${API_BASE}/api/wiki/discover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Scholarship wiki discovery failed.");
  }

  return data as WikiDiscoveryResult;
}

export async function getScholarshipDiscoveryBootstrap(
  studentProfile: Record<string, unknown>,
): Promise<WikiDiscoveryBootstrapResult> {
  const response = await fetch(`${API_BASE}/api/wiki/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_profile: studentProfile }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Discovery suggestions could not be prepared.");
  }
  return data as WikiDiscoveryBootstrapResult;
}

function findWordLimit(text: string) {
  const match = text.match(/(\d{2,5})\s*(?:-|to)?\s*(?:word|words)/i);
  return match?.[0] ?? "";
}

export function buildOutlinePayload(user: UserProfile | null, essayPromptOverride?: string): OutlineGeneratePayload {
  const scholarship = user?.activeScholarship ?? {};
  const essayPrompt = (essayPromptOverride
    || scholarship.essayPrompts
    || scholarship.otherRequiredMaterials
    || scholarship.requirementsPreview
    || "").trim();
  const { fitAnalysis, wikiDiscovery, savedWikiSources, activeScholarship, personalizedOutline, ...studentProfile } =
    user ?? { name: "", email: "" };
  void fitAnalysis;
  void wikiDiscovery;
  void savedWikiSources;
  void activeScholarship;
  void personalizedOutline;

  return {
    // This is an identifier, not a source URL. Tracking-heavy scholarship URLs
    // can exceed the backend's 200-character limit and cause a 422 response.
    opportunity_id: (scholarship.name || scholarship.url || "").slice(0, 200),
    scholarship_name: scholarship.name || "",
    clean_scholarship_record: scholarship,
    essay_prompt: essayPrompt,
    essay_type: scholarship.type || "Scholarship essay",
    word_limit: findWordLimit([essayPrompt, scholarship.otherRequiredMaterials, scholarship.requirementsPreview].filter(Boolean).join("\n")),
    student_profile: {
      ...studentProfile,
      profile_text: profileToText(user),
    },
    user_notes: scholarship.additionalNotes || "",
  };
}

export type EditorSentenceSuggestion = {
  original_text: string;
  suggested_text: string;
  suggestion_type: string;
  reason: string;
  severity: "low" | "medium" | "high" | string;
  risk_tier?: "C0" | "C1" | "C2" | "C3" | string;
};

export type GrammarFeedback = {
  grammar_score?: number;
  spelling_issues?: string[];
  punctuation_issues?: string[];
  capitalization_issues?: string[];
  verb_tense_issues?: string[];
  agreement_issues?: string[];
  other_grammar_issues?: string[];
  sentence_level_correctness_issues?: string[];
  revision_tasks?: string[];
};

export type EditorCheckResult = {
  status: string;
  sentence_suggestions?: EditorSentenceSuggestion[];
  grammar_feedback?: GrammarFeedback;
  outline_coverage?: { covered_point_ids?: string[] };
  warnings?: string[];
};

export type EditorCheckPayload = {
  clean_scholarship_record: ActiveScholarship;
  essay_draft: string;
  user_notes: string;
  outline_points: Array<{ id: string; label: string }>;
};

export function buildEditorCheckPayload(user: UserProfile | null): EditorCheckPayload {
  const scholarship = user?.activeScholarship ?? {};
  return {
    clean_scholarship_record: scholarship,
    essay_draft: user?.essayDraft ?? "",
    user_notes: scholarship.additionalNotes || "",
    outline_points: buildOutlinePoints(user?.personalizedOutline).map((p) => ({ id: p.id, label: p.label })),
  };
}

export async function runEditorCheck(payload: EditorCheckPayload): Promise<EditorCheckResult> {
  const response = await fetch(`${API_BASE}/api/apply/editor-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Scholar-E editor check failed.");
  }

  return data as EditorCheckResult;
}

export type CoachingSessionPayload = {
  user_id: string;
  cv_text: string;
  essay_text: string;
  scholarship_name: string;
  scholarship_type: string;
  prompt: string;
  previous_manager_plan?: EssayReviewResult["manager_plan"];
  student_profile: Record<string, unknown>;
  clean_scholarship_record: ActiveScholarship;
  essay_prompt: string;
  word_limit: string;
  outline_points: Array<{ id: string; label: string }>;
};

export type CoachingSessionResult = {
  session_id?: string;
  draft_hash?: string;
  status: "success" | "partial" | "error";
  mechanics: {
    draft: string;
    applied_count: number;
    applied_fixes?: Array<{ original: string; suggested: string; title: string }>;
  };
  cleaned_draft: string;
  review?: EssayReviewResult | null;
  outline_coverage?: { covered_point_ids?: string[] };
  agents?: Record<string, "success" | "error" | "fallback" | "reused">;
  warnings?: string[];
  duration_ms?: number;
};

/** Build the single request used by the Essay Workspace's one-button session. */
export function buildCoachingSessionPayload(
  user: UserProfile | null,
  essayPromptOverride?: string,
): CoachingSessionPayload {
  const scholarship = user?.activeScholarship ?? {};
  const essayPrompt = (essayPromptOverride
    || scholarship.essayPrompts
    || scholarship.otherRequiredMaterials
    || scholarship.requirementsPreview
    || "").trim();
  const {
    fitAnalysis,
    wikiDiscovery,
    savedWikiSources,
    activeScholarship,
    personalizedOutline,
    drafts,
    essayReviewResult,
    essayReviewUpdatedAt,
    essayReviewDraftAtRun,
    ...studentProfile
  } = user ?? { name: "", email: "" };
  void fitAnalysis;
  void wikiDiscovery;
  void savedWikiSources;
  void activeScholarship;
  void personalizedOutline;
  void drafts;
  void essayReviewResult;
  void essayReviewUpdatedAt;
  void essayReviewDraftAtRun;
  const prompt = buildOpportunityPrompt(user, essayPromptOverride)
    || "No formal essay prompt was provided; evaluate against the scholarship context.";

  return {
    user_id: user?.email ?? "",
    cv_text: profileToText(user).slice(0, 50_000),
    essay_text: (user?.essayDraft ?? "").slice(0, 20_000),
    scholarship_name: (scholarship.name ?? "").slice(0, 500),
    scholarship_type: (scholarship.type ?? "").slice(0, 200),
    prompt,
    previous_manager_plan: user?.essayReviewResult?.manager_plan,
    student_profile: { ...studentProfile, profile_text: profileToText(user) },
    clean_scholarship_record: scholarship,
    essay_prompt: essayPrompt,
    word_limit: findWordLimit([essayPrompt, scholarship.otherRequiredMaterials, scholarship.requirementsPreview].filter(Boolean).join("\n")),
    outline_points: buildOutlinePoints(user?.personalizedOutline).map((p) => ({ id: p.id, label: p.label })),
  };
}

export async function runWorkspaceCoachingSession(
  payload: CoachingSessionPayload,
): Promise<CoachingSessionResult> {
  const response = await fetch(`${API_BASE}/api/apply/coaching-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    const validationMessage = Array.isArray(detail)
      ? detail.map((issue) => `${issue?.loc?.join(".") ?? "request"}: ${issue?.msg ?? "invalid value"}`).join("; ")
      : null;
    throw new Error(typeof detail === "string" ? detail : validationMessage || "Scholar-E coaching session failed.");
  }

  return data as CoachingSessionResult;
}

export type OutlinePointGroup = "strategy" | "structure";
export type OutlinePoint = { id: string; label: string; detail?: string; group: OutlinePointGroup };

/**
 * Deterministic flat list of checkable outline points ({id,label,group}). Single
 * source of truth for point ids — used by the outline panel,
 * the coach payload (sent to the coverage agent), and coverage mapping.
 */
export function buildOutlinePoints(outline?: PersonalizedOutlineResult): OutlinePoint[] {
  const data = outline?.outline;
  if (!data) return [];
  const points: OutlinePoint[] = [];
  if (outline?.strategy?.recommended_strategy) points.push({ id: "p-strat", label: outline.strategy.recommended_strategy, group: "strategy" });
  if (outline?.strategy?.tone_guidance) points.push({ id: "p-tone", label: `Tone: ${outline.strategy.tone_guidance}`, group: "strategy" });
  const sections = data.sections ?? [];
  sections.forEach((s, i) => points.push({ id: `p-sec-${i}`, label: s.section_name || `Section ${i + 1}`, group: "structure" }));
  return points;
}

export type SelectionRewritePayload = {
  action: string;
  selected_text: string;
  surrounding_text: string;
  essay_prompt: string;
  clean_scholarship_record: ActiveScholarship;
  student_profile: Record<string, unknown>;
};

export type SelectionRewriteResult = { status?: string; rewritten_text?: string; note?: string };

export function buildRewritePayload(
  user: UserProfile | null,
  action: string,
  selectedText: string,
  surroundingText: string,
): SelectionRewritePayload {
  const scholarship = user?.activeScholarship ?? {};
  const essayPrompt = scholarship.essayPrompts || scholarship.otherRequiredMaterials || scholarship.requirementsPreview || "";
  const { fitAnalysis, wikiDiscovery, savedWikiSources, activeScholarship, personalizedOutline, drafts, ...studentProfile } =
    user ?? { name: "", email: "" };
  void fitAnalysis;
  void wikiDiscovery;
  void savedWikiSources;
  void activeScholarship;
  void personalizedOutline;
  void drafts;
  return {
    action,
    selected_text: selectedText,
    surrounding_text: surroundingText,
    essay_prompt: essayPrompt,
    clean_scholarship_record: scholarship,
    student_profile: { ...studentProfile, profile_text: profileToText(user) },
  };
}

export async function runSelectionRewrite(payload: SelectionRewritePayload): Promise<SelectionRewriteResult> {
  const response = await fetch(`${API_BASE}/api/apply/rewrite-selection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Rewrite failed.");
  }
  return data as SelectionRewriteResult;
}

export async function generatePersonalizedOutline(payload: OutlineGeneratePayload): Promise<PersonalizedOutlineResult> {
  const response = await fetch(`${API_BASE}/api/apply/generate-outline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Personalized outline generation failed.");
  }

  return data as PersonalizedOutlineResult;
}
