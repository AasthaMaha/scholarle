import type { ActiveScholarship, DiscoveryIntent, EssayPromptEntry, EssayReviewResult, FitAnalysisResult, PersonalizedOutlineResult, UserProfile, WikiDiscoveryResult } from "@/lib/userStore";

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

function nonnegativeWordCount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

/** Extract only word limits explicitly present in text. A lone count is a maximum. */
export function extractPromptWordLimits(text: string): Pick<EssayPromptEntry, "minimumWords" | "maximumWords"> {
  const normalized = (text || "").replace(/,/g, " ").replace(/\s+/g, " ");
  const exact = normalized.match(/\bexactly\s+(\d{1,5})\s*words?\b/i);
  if (exact) {
    const count = Number(exact[1]);
    return { minimumWords: count, maximumWords: count };
  }
  const range = normalized.match(/\b(?:between\s+)?(\d{1,5})\s*(?:-|–|—|to|and)\s*(\d{1,5})\s*words?\b/i);
  if (range) {
    return { minimumWords: Number(range[1]), maximumWords: Number(range[2]) };
  }

  const minimum = normalized.match(/\b(?:minimum|min\.?|at least|no fewer than)\s*(?:of\s*)?(\d{1,5})\s*words?\b/i)?.[1];
  const maximum = normalized.match(/\b(?:maximum|max\.?|up to|no more than|not more than)\s*(?:of\s*)?(\d{1,5})\s*words?\b/i)?.[1]
    ?? normalized.match(/\b(\d{1,5})[- ]word\s+(?:maximum|limit)\b/i)?.[1]
    ?? normalized.match(/\b(\d{1,5})\s*words?\s*(?:or less|maximum|max\.?)\b/i)?.[1];
  if (minimum || maximum) {
    return {
      minimumWords: minimum ? Number(minimum) : null,
      maximumWords: maximum ? Number(maximum) : null,
    };
  }

  const loneCount = normalized.match(/\b(\d{1,5})\s*words?\b/i)?.[1];
  return { minimumWords: null, maximumWords: loneCount ? Number(loneCount) : null };
}

/** Normalize new structured prompts and migrate legacy single-string prompt data on read. */
export function normalizeEssayPromptEntries(scholarship?: ActiveScholarship | null): EssayPromptEntry[] {
  const structured = Array.isArray(scholarship?.essayPromptEntries) ? scholarship.essayPromptEntries : [];
  const source = structured.length > 0
    ? structured
    : splitEssayPrompts(scholarship?.essayPrompts ?? "").map((promptText, index) => ({
        id: `prompt-${index + 1}`,
        promptNumber: index + 1,
      promptText,
      minimumWords: null,
      maximumWords: null,
    }));

  return source.map((entry, index) => {
    const promptText = String(entry.promptText ?? "")
      .trim()
      .replace(/^(?:Prompt|Essay|Question)\s*\d+\s*[:.)]\s*/i, "");
    const inferred = extractPromptWordLimits(promptText);
    const hasExplicitLimit = /\b\d{1,5}\s*(?:-|–|—|to|and)?\s*\d{0,5}\s*words?\b/i.test(promptText);
    const rawMinimum = nonnegativeWordCount(entry.minimumWords);
    const rawMaximum = nonnegativeWordCount(entry.maximumWords);
    const minimumReviewedWasStored = typeof entry.minimumWordsReviewed === "boolean";
    const maximumReviewedWasStored = typeof entry.maximumWordsReviewed === "boolean";
    const minimumWords = entry.minimumWordsReviewed === true
      ? rawMinimum
      : hasExplicitLimit ? inferred.minimumWords : rawMinimum;
    const maximumWords = entry.maximumWordsReviewed === true
      ? rawMaximum
      : hasExplicitLimit ? inferred.maximumWords : rawMaximum;
    return {
      id: String(entry.id || `prompt-${index + 1}`),
      promptNumber: Number.isFinite(entry.promptNumber) && entry.promptNumber > 0 ? entry.promptNumber : index + 1,
      promptText,
      minimumWords,
      maximumWords,
      minimumWordsReviewed: minimumReviewedWasStored ? entry.minimumWordsReviewed : minimumWords !== null,
      maximumWordsReviewed: maximumReviewedWasStored ? entry.maximumWordsReviewed : maximumWords !== null,
    };
  });
}

/** Return only prompts chosen for this application; legacy records fall back to all prompts. */
export function normalizeSelectedEssayPromptEntries(scholarship?: ActiveScholarship | null): EssayPromptEntry[] {
  const entries = normalizeEssayPromptEntries(scholarship);
  if (scholarship?.noEssayPromptSelected) return [];
  if (!Array.isArray(scholarship?.selectedEssayPromptIds)) return entries;
  const selectedIds = new Set(scholarship.selectedEssayPromptIds);
  return entries.filter((entry) => selectedIds.has(entry.id));
}

export function serializeEssayPromptEntries(entries: EssayPromptEntry[]): string {
  return entries
    .filter((entry) => entry.promptText.trim())
    .map((entry, index) => `Prompt ${index + 1}: ${entry.promptText.trim()}`)
    .join("\n\n");
}

export function formatEssayPromptWordLimit(entry?: EssayPromptEntry): string {
  if (!entry) return "";
  if (entry.minimumWords !== null && entry.maximumWords !== null) return `${entry.minimumWords}-${entry.maximumWords} words`;
  if (entry.minimumWords !== null) return `At least ${entry.minimumWords} words`;
  if (entry.maximumWords !== null) return `Maximum ${entry.maximumWords} words`;
  return "";
}

function promptEntryFor(scholarship: ActiveScholarship, promptOverride?: string) {
  const entries = promptOverride ? normalizeEssayPromptEntries(scholarship) : normalizeSelectedEssayPromptEntries(scholarship);
  const selected = (promptOverride || "").trim().toLocaleLowerCase();
  return (selected ? entries.find((entry) => entry.promptText.trim().toLocaleLowerCase() === selected) : entries[0]) ?? undefined;
}

function scholarshipForEssayWorkflow(scholarship: ActiveScholarship): ActiveScholarship {
  const selectedEssayPromptEntries = normalizeSelectedEssayPromptEntries(scholarship);
  return {
    ...scholarship,
    essayPromptEntries: selectedEssayPromptEntries,
    essayPrompts: serializeEssayPromptEntries(selectedEssayPromptEntries),
    selectedEssayPromptEntries,
    selectedEssayPrompts: serializeEssayPromptEntries(selectedEssayPromptEntries),
  };
}

function hasEssayPromptDecision(scholarship?: ActiveScholarship | null) {
  return Array.isArray(scholarship?.selectedEssayPromptIds)
    || typeof scholarship?.noEssayPromptSelected === "boolean";
}

function buildOpportunityPrompt(user: UserProfile | null, essayPromptOverride?: string): string {
  const scholarship = user?.activeScholarship;
  const selectedEntry = scholarship ? promptEntryFor(scholarship, essayPromptOverride) : undefined;
  const selectedPrompt = (essayPromptOverride
    || selectedEntry?.promptText
    || (!hasEssayPromptDecision(scholarship) ? scholarship?.essayPrompts : "")
    || (!hasEssayPromptDecision(scholarship) ? scholarship?.otherRequiredMaterials : "")
    || (!hasEssayPromptDecision(scholarship) ? scholarship?.requirementsPreview : "")
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
  const scholarship = user?.activeScholarship ?? {};
  const allEssayPromptEntries = normalizeEssayPromptEntries(scholarship);
  const selectedEssayPromptEntries = normalizeSelectedEssayPromptEntries(scholarship);

  return {
    scholarship_record: {
      ...scholarship,
      allEssayPromptEntries,
      essayPromptEntries: selectedEssayPromptEntries,
      essayPrompts: serializeEssayPromptEntries(selectedEssayPromptEntries),
      selectedEssayPromptEntries,
      selectedEssayPrompts: serializeEssayPromptEntries(selectedEssayPromptEntries),
    },
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
  const limits = extractPromptWordLimits(text);
  return formatEssayPromptWordLimit({ id: "fallback", promptNumber: 1, promptText: text, ...limits });
}

export function buildOutlinePayload(user: UserProfile | null, essayPromptOverride?: string): OutlineGeneratePayload {
  const scholarship = user?.activeScholarship ?? {};
  const workflowScholarship = scholarshipForEssayWorkflow(scholarship);
  const selectedEntry = promptEntryFor(scholarship, essayPromptOverride);
  const essayPrompt = (essayPromptOverride
    || selectedEntry?.promptText
    || (!hasEssayPromptDecision(scholarship) ? scholarship.essayPrompts : "")
    || (!hasEssayPromptDecision(scholarship) ? scholarship.otherRequiredMaterials : "")
    || (!hasEssayPromptDecision(scholarship) ? scholarship.requirementsPreview : "")
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
    clean_scholarship_record: workflowScholarship,
    essay_prompt: essayPrompt,
    essay_type: scholarship.type || "Scholarship essay",
    word_limit: formatEssayPromptWordLimit(selectedEntry)
      || findWordLimit((hasEssayPromptDecision(scholarship)
        ? [essayPrompt]
        : [essayPrompt, scholarship.otherRequiredMaterials, scholarship.requirementsPreview]).filter(Boolean).join("\n")),
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
  source?: "language_tool" | "contextual_grammar" | string;
  confidence?: "low" | "medium" | "high" | string;
  replacement_available?: boolean;
  start_offset?: number | null;
  end_offset?: number | null;
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
  warnings?: string[];
  draft_revision?: string;
  language_tool_status?: "idle" | "warming" | "ready" | "error" | string;
  retry_after_ms?: number;
  replaces_language_tool?: boolean;
  fix_pipeline_version?: string;
};

export type EditorCheckPayload = {
  essay_draft: string;
  user_notes: string;
  protected_terms: string[];
  draft_revision: string;
};

function protectedTermsForFixes(user: UserProfile | null): string[] {
  const terms = new Set<string>(user?.personalDictionary ?? []);
  const addCapitalizedTerms = (value: unknown) => {
    if (typeof value !== "string") return;
    const matches = value.match(/\b(?:[A-Z]{2,}|[A-Z][A-Za-z'’-]{2,})\b/g) ?? [];
    matches.forEach((term) => terms.add(term));
  };
  const addTrustedFields = (value: unknown) => {
    if (typeof value === "string") {
      addCapitalizedTerms(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(addTrustedFields);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(addTrustedFields);
    }
  };
  addCapitalizedTerms(user?.name);
  addCapitalizedTerms(user?.location);
  addCapitalizedTerms(user?.nationality);
  addCapitalizedTerms(user?.activeScholarship?.name);
  addCapitalizedTerms(user?.activeScholarship?.organization);
  addCapitalizedTerms(user?.activeScholarship?.country);
  addCapitalizedTerms(user?.activeScholarship?.locationRequirement);
  addTrustedFields(user?.highSchool);
  addTrustedFields(user?.undergrad);
  addTrustedFields(user?.graduate);
  addTrustedFields(user?.educationHistory);
  addTrustedFields(user?.researchExperience);
  addTrustedFields(user?.workExperience);
  addTrustedFields(user?.optional);
  return [...terms].filter(Boolean).slice(0, 500);
}

export function buildEditorCheckPayload(
  user: UserProfile | null,
  essayDraft = user?.essayDraft ?? "",
  draftRevision = "",
): EditorCheckPayload {
  return {
    essay_draft: essayDraft,
    user_notes: user?.activeScholarship?.additionalNotes || "",
    protected_terms: protectedTermsForFixes(user),
    draft_revision: draftRevision,
  };
}

export async function runEditorCheck(payload: EditorCheckPayload, signal?: AbortSignal): Promise<EditorCheckResult> {
  const response = await fetch(`${API_BASE}/api/apply/editor-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Scholar-E editor check failed.");
  }

  return data as EditorCheckResult;
}

export async function warmEditorTools(signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${API_BASE}/api/apply/editor-warmup`, {
    method: "POST",
    signal,
  });
  if (!response.ok) {
    throw new Error("Scholar-E editor tools could not be warmed.");
  }
}

export async function runContextualGrammarCheck(payload: EditorCheckPayload, signal?: AbortSignal): Promise<EditorCheckResult> {
  const response = await fetch(`${API_BASE}/api/apply/contextual-grammar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Scholar-E contextual grammar check failed.");
  }

  return data as EditorCheckResult;
}

export type OutlineCoverageResult = {
  status: string;
  outline_coverage?: { covered_point_ids?: string[] };
  warnings?: string[];
};

export type OutlineCoveragePayload = {
  clean_scholarship_record: ActiveScholarship;
  essay_draft: string;
  outline_points: Array<{ id: string; label: string }>;
};

export function buildOutlineCoveragePayload(user: UserProfile | null, essayDraft = user?.essayDraft ?? ""): OutlineCoveragePayload {
  return {
    clean_scholarship_record: scholarshipForEssayWorkflow(user?.activeScholarship ?? {}),
    essay_draft: essayDraft,
    outline_points: buildOutlinePoints(user?.personalizedOutline).map((point) => ({ id: point.id, label: point.label })),
  };
}

export async function runOutlineCoverageCheck(payload: OutlineCoveragePayload): Promise<OutlineCoverageResult> {
  const response = await fetch(`${API_BASE}/api/apply/outline-coverage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Scholar-E outline coverage check failed.");
  }
  return data as OutlineCoverageResult;
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
  const workflowScholarship = scholarshipForEssayWorkflow(scholarship);
  const selectedEntry = promptEntryFor(scholarship, essayPromptOverride);
  const essayPrompt = (essayPromptOverride
    || selectedEntry?.promptText
    || (!hasEssayPromptDecision(scholarship) ? scholarship.essayPrompts : "")
    || (!hasEssayPromptDecision(scholarship) ? scholarship.otherRequiredMaterials : "")
    || (!hasEssayPromptDecision(scholarship) ? scholarship.requirementsPreview : "")
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
    clean_scholarship_record: workflowScholarship,
    essay_prompt: essayPrompt,
    word_limit: formatEssayPromptWordLimit(selectedEntry)
      || findWordLimit((hasEssayPromptDecision(scholarship)
        ? [essayPrompt]
        : [essayPrompt, scholarship.otherRequiredMaterials, scholarship.requirementsPreview]).filter(Boolean).join("\n")),
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

export type OutlinePoint = { id: string; label: string; detail?: string };

/**
 * Deterministic flat list of checkable essay-section points ({id,label}).
 * Single source of truth for point ids used by the coach payload and coverage
 * mapping. Global tone guidance is advice, not a checkable coverage point.
 */
export function buildOutlinePoints(outline?: PersonalizedOutlineResult): OutlinePoint[] {
  const data = outline?.outline;
  if (!data) return [];
  const sections = data.sections ?? [];
  return sections.map((section, index) => ({
    id: `p-sec-${index}`,
    label: section.section_name || `Section ${index + 1}`,
  }));
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
  essayPromptOverride?: string,
): SelectionRewritePayload {
  const scholarship = user?.activeScholarship ?? {};
  const workflowScholarship = scholarshipForEssayWorkflow(scholarship);
  const selectedEntry = promptEntryFor(scholarship, essayPromptOverride);
  const essayPrompt = essayPromptOverride
    || selectedEntry?.promptText
    || (!hasEssayPromptDecision(scholarship) ? scholarship.essayPrompts : "")
    || (!hasEssayPromptDecision(scholarship) ? scholarship.otherRequiredMaterials : "")
    || (!hasEssayPromptDecision(scholarship) ? scholarship.requirementsPreview : "")
    || "";
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
    clean_scholarship_record: workflowScholarship,
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
