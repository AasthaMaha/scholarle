import type { ActiveScholarship, AnalysisResult, DiscoveryIntent, EssayPromptEntry, FitAnalysisResult, PersonalizedOutlineResult, UserProfile, WikiDiscoveryResult } from "@/lib/userStore";

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

export function buildAnalyzePayload(user: UserProfile | null, essayPromptOverride?: string): AnalyzePayload {
  const scholarship = user?.activeScholarship;
  const selectedEntry = scholarship ? promptEntryFor(scholarship, essayPromptOverride) : undefined;
  const previousReadiness: Record<string, number> = {};
  Object.entries(user?.lastAnalysis?.readiness_index ?? {}).forEach(([key, value]) => {
    if (typeof value?.score === "number") previousReadiness[key] = value.score;
  });

  const selectedPrompt = (essayPromptOverride
    || selectedEntry?.promptText
    || (!hasEssayPromptDecision(scholarship) ? scholarship?.essayPrompts : "")
    || (!hasEssayPromptDecision(scholarship) ? scholarship?.otherRequiredMaterials : "")
    || (!hasEssayPromptDecision(scholarship) ? scholarship?.requirementsPreview : "")
    || "").trim();

  const prompt = compact([
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
    ]);

  return {
    cv_text: profileToText(user).slice(0, 50_000),
    essay_text: (user?.essayDraft ?? "").slice(0, 20_000),
    scholarship_name: (scholarship?.name ?? "").slice(0, 500),
    scholarship_type: (scholarship?.type ?? "").slice(0, 200),
    prompt: prompt.slice(0, 10_000),
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
    const validationMessage = Array.isArray(detail)
      ? detail.map((issue) => `${issue?.loc?.join(".") ?? "request"}: ${issue?.msg ?? "invalid value"}`).join("; ")
      : null;
    throw new Error(typeof detail === "string" ? detail : validationMessage || "Scholar-E analysis failed.");
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

export function buildFitPayload(user: UserProfile | null): FitAnalyzePayload {
  const { lastAnalysis, fitAnalysis, ...studentProfile } = user ?? { name: "", email: "" };
  void lastAnalysis;
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
    lastAnalysis,
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
  void lastAnalysis;
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
  const { lastAnalysis, fitAnalysis, wikiDiscovery, savedWikiSources, activeScholarship, personalizedOutline, ...studentProfile } =
    user ?? { name: "", email: "" };
  void lastAnalysis;
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

export type EssayCoachMode = "full" | "workspace_refresh" | "grammar_tone" | "prompt_alignment" | "structure" | "reviewer" | "auto_check";
export type WritingSupportLevel = "grammar_only" | "sentence_polish" | "rewrite_help";

export type EssayCoachSentenceSuggestion = {
  original_text: string;
  suggested_text: string;
  suggestion_type: string;
  reason: string;
  severity: "low" | "medium" | "high" | string;
  risk_tier?: "C0" | "C1" | "C2" | "C3" | string;
};

export type PromptAlignmentFeedback = {
  alignment_score?: number;
  covered_requirements?: string[];
  missing_requirements?: string[];
  weakly_covered_requirements?: string[];
  comments?: string[];
  revision_tasks?: string[];
};

export type AlignmentFeedback = {
  alignment_score?: number;
  covered_prompt_parts?: string[];
  weakly_covered_prompt_parts?: string[];
  missing_prompt_parts?: string[];
  stated_scholarship_values?: string[];
  actual_evaluation_focus?: string[];
  addressed_scholarship_values?: string[];
  weak_or_missing_scholarship_values?: string[];
  student_fit_connections?: string[];
  generic_or_unsupported_fit_claims?: string[];
  fit_summary?: string;
  comments?: string[];
  revision_tasks?: string[];
};

export type ProfileGroundingFeedback = {
  grounding_score?: number;
  supported_claims?: string[];
  unsupported_or_risky_claims?: string[];
  unused_relevant_profile_evidence?: string[];
  recommendations?: string[];
};

export type ParagraphFeedback = {
  paragraph_number?: number;
  main_issue?: string;
  strength?: string;
  suggestion?: string;
  priority?: string;
};

export type StructureFeedback = {
  structure_score?: number;
  paragraph_feedback?: ParagraphFeedback[];
  flow_issues?: string[];
  recommended_reordering?: string[];
  revision_tasks?: string[];
};

export type NarrativeStageFeedback = {
  stage?: string;
  status?: "present" | "weak" | "missing" | string;
  evidence?: string;
  issue?: string;
  suggestion?: string;
};

export type NarrativeStructureFeedback = {
  narrative_structure_score?: number;
  structure_flow_score?: number;
  coherence_score?: number;
  narrative_arc_score?: number;
  arc_progression?: NarrativeStageFeedback[];
  paragraph_feedback?: ParagraphFeedback[];
  transition_and_flow_issues?: string[];
  coherence_issues?: string[];
  contradictions_or_timeline_issues?: string[];
  missing_reasoning?: string[];
  logical_connections_to_preserve?: string[];
  recommended_reordering?: string[];
  overall_narrative_assessment?: string;
  biggest_narrative_gap?: string;
  revision_tasks?: string[];
};

export type InsightFeedback = {
  insight_score?: number;
  meaningful_reflections?: string[];
  surface_level_or_generic_reflections?: string[];
  lessons_realizations_or_questions?: string[];
  changes_in_mindset_or_behavior?: string[];
  changes_in_values_goals_or_responsibility?: string[];
  significance_to_self?: string[];
  significance_to_others_or_community?: string[];
  future_direction_connections?: string[];
  missing_meaning_or_reflection?: string[];
  recommended_reflection_questions?: string[];
  revision_tasks?: string[];
};

export type SpecificityFeedback = {
  specificity_score?: number;
  vague_statements?: string[];
  places_to_add_detail?: string[];
  impact_opportunities?: string[];
  recommended_questions?: string[];
};

export type EvidenceStrengthFeedback = {
  evidence_strength_score?: number;
  supported_claims?: string[];
  unsupported_or_risky_claims?: string[];
  invented_or_unverifiable_details?: string[];
  unused_relevant_profile_evidence?: string[];
  vague_statements?: string[];
  places_to_add_detail?: string[];
  impact_opportunities?: string[];
  recommended_experience_to_feature?: string;
  recommended_questions?: string[];
  recommendations?: string[];
};

export type ToneFeedback = {
  authenticity_score?: number;
  tone_score?: number;
  ai_like_phrases?: string[];
  generic_phrases?: string[];
  overly_polished_or_corporate_phrases?: string[];
  formulaic_or_performative_phrases?: string[];
  tone_quality_notes?: string[];
  voice_preservation_notes?: string[];
  tone_improvement_suggestions?: string[];
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

export type ClarityConcisionFeedback = {
  clarity_concision_score?: number;
  clear_and_direct_sentences?: string[];
  filler_or_repetition?: string[];
  wordiness?: string[];
  unclear_phrasing?: string[];
  tangled_sentence_structure?: string[];
  revision_tasks?: string[];
};

export type ReviewerSimulation = {
  reviewer_reaction?: string;
  competitiveness_score?: number;
  likely_strengths_seen_by_reviewer?: string[];
  likely_concerns_seen_by_reviewer?: string[];
  questions_reviewer_may_have?: string[];
  competitiveness_notes?: string[];
};

export type RevisionPriority = {
  priority?: string;
  why_it_matters?: string;
  how_to_fix?: string;
  estimated_effort?: string;
  impact?: string;
};

export type EssayCoachResult = {
  status: string;
  overall_scores?: Record<string, number>;
  sentence_suggestions?: EssayCoachSentenceSuggestion[];
  grammar_feedback?: GrammarFeedback;
  clarity_concision_feedback?: ClarityConcisionFeedback;
  paragraph_feedback?: ParagraphFeedback[];
  prompt_alignment?: PromptAlignmentFeedback;
  alignment?: AlignmentFeedback;
  profile_grounding?: ProfileGroundingFeedback;
  evidence_strength?: EvidenceStrengthFeedback;
  structure_feedback?: StructureFeedback;
  narrative_structure?: NarrativeStructureFeedback;
  insight?: InsightFeedback;
  specificity_feedback?: SpecificityFeedback;
  tone_feedback?: ToneFeedback;
  reviewer_simulation?: ReviewerSimulation;
  revision_priorities?: RevisionPriority[];
  quick_fixes?: string[];
  deeper_revision_tasks?: string[];
  outline_coverage?: { covered_point_ids?: string[] };
  guardrail?: GuardrailAudit;
  warnings?: string[];
  coach_summary?: string;
  message?: string;
};

export type EssayCoachPayload = {
  student_profile: Record<string, unknown>;
  clean_scholarship_record: ActiveScholarship;
  essay_prompt: string;
  essay_draft: string;
  personalized_outline: Record<string, unknown>;
  user_notes: string;
  word_limit: string;
  outline_points: Array<{ id: string; label: string }>;
  mode: EssayCoachMode;
  writing_support_level?: WritingSupportLevel;
};

export type GuardrailAudit = {
  approved?: boolean;
  issues_found?: string[];
  removed_or_revised_suggestions?: string[];
  final_notes?: string[];
};

export function buildEssayCoachPayload(
  user: UserProfile | null,
  mode: EssayCoachMode = "full",
  writingSupportLevel?: WritingSupportLevel,
  essayPromptOverride?: string,
): EssayCoachPayload {
  const scholarship = user?.activeScholarship ?? {};
  const workflowScholarship = scholarshipForEssayWorkflow(scholarship);
  const selectedEntry = promptEntryFor(scholarship, essayPromptOverride);
  const essayPrompt = (essayPromptOverride
    || selectedEntry?.promptText
    || (!hasEssayPromptDecision(scholarship) ? scholarship.essayPrompts : "")
    || (!hasEssayPromptDecision(scholarship) ? scholarship.otherRequiredMaterials : "")
    || (!hasEssayPromptDecision(scholarship) ? scholarship.requirementsPreview : "")
    || "").trim();
  const { lastAnalysis, fitAnalysis, wikiDiscovery, savedWikiSources, activeScholarship, personalizedOutline, drafts, ...studentProfile } =
    user ?? { name: "", email: "" };
  void lastAnalysis;
  void fitAnalysis;
  void wikiDiscovery;
  void savedWikiSources;
  void activeScholarship;
  void personalizedOutline;
  void drafts;

  return {
    student_profile: { ...studentProfile, profile_text: profileToText(user) },
    clean_scholarship_record: workflowScholarship,
    essay_prompt: essayPrompt,
    essay_draft: user?.essayDraft ?? "",
    personalized_outline: (user?.personalizedOutline as Record<string, unknown>) ?? {},
    user_notes: scholarship.additionalNotes || "",
    word_limit: formatEssayPromptWordLimit(selectedEntry)
      || findWordLimit((hasEssayPromptDecision(scholarship)
        ? [essayPrompt]
        : [essayPrompt, scholarship.otherRequiredMaterials, scholarship.requirementsPreview]).filter(Boolean).join("\n")),
    outline_points: buildOutlinePoints(user?.personalizedOutline).map((p) => ({ id: p.id, label: p.label })),
    mode,
    writing_support_level:
      writingSupportLevel
      ?? (mode === "workspace_refresh" || mode === "auto_check" || mode === "grammar_tone"
        ? "grammar_only"
        : "sentence_polish"),
  };
}

export async function runEssayCoach(payload: EssayCoachPayload): Promise<EssayCoachResult> {
  const response = await fetch(`${API_BASE}/api/apply/essay-coach`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Scholar-E essay coach failed.");
  }

  return data as EssayCoachResult;
}

export type CoachingSessionPayload = {
  user_id: string;
  cv_text: string;
  essay_text: string;
  scholarship_name: string;
  scholarship_type: string;
  prompt: string;
  previous_readiness?: Record<string, number>;
  draft_number: number;
  student_profile: Record<string, unknown>;
  clean_scholarship_record: ActiveScholarship;
  essay_prompt: string;
  personalized_outline: Record<string, unknown>;
  user_notes: string;
  word_limit: string;
  outline_points: Array<{ id: string; label: string }>;
  writing_support_level: WritingSupportLevel;
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
  evaluation?: AnalysisResult | null;
  coach_pack?: EssayCoachResult | null;
  components?: {
    mechanics?: "success" | "error";
    coach?: "success" | "error";
    evaluation?: "success" | "error";
  };
  agents?: Record<string, "success" | "error" | "fallback">;
  warnings?: string[];
  duration_ms?: number;
};

/** Build the single request used by the Essay Workspace's one-button session. */
export function buildCoachingSessionPayload(
  user: UserProfile | null,
  essayPromptOverride?: string,
): CoachingSessionPayload {
  const evaluation = buildAnalyzePayload(user, essayPromptOverride);
  const coach = buildEssayCoachPayload(user, "full", "sentence_polish", essayPromptOverride);

  return {
    user_id: user?.email ?? "",
    cv_text: evaluation.cv_text,
    essay_text: evaluation.essay_text,
    scholarship_name: evaluation.scholarship_name,
    scholarship_type: evaluation.scholarship_type,
    // The backend model requires a non-empty deep-evaluation focus. When a
    // scholarship has no formal prompt, make the intended fallback explicit.
    prompt: evaluation.prompt || "No formal essay prompt was provided; evaluate against the scholarship context.",
    previous_readiness: evaluation.previous_readiness,
    draft_number: evaluation.draft_number ?? 1,
    student_profile: coach.student_profile,
    clean_scholarship_record: coach.clean_scholarship_record,
    essay_prompt: coach.essay_prompt,
    personalized_outline: coach.personalized_outline,
    user_notes: coach.user_notes,
    word_limit: coach.word_limit,
    outline_points: coach.outline_points,
    writing_support_level: "sentence_polish",
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

export type OutlinePointGroup = "core" | "strategy" | "structure" | "keypoints";
export type OutlinePoint = { id: string; label: string; detail?: string; group: OutlinePointGroup };

/**
 * Deterministic flat list of checkable outline points ({id,label,group}). Single
 * source of truth for point ids — used by the outline panel (render + progress),
 * the coach payload (sent to the coverage agent), and coverage mapping.
 */
export function buildOutlinePoints(outline?: PersonalizedOutlineResult): OutlinePoint[] {
  const data = outline?.outline;
  if (!data) return [];
  const points: OutlinePoint[] = [
    { id: "p-core", label: data.outline_title || "Core message", detail: data.thesis_or_core_message, group: "core" },
  ];
  if (outline?.strategy?.recommended_strategy) points.push({ id: "p-strat", label: outline.strategy.recommended_strategy, group: "strategy" });
  if (outline?.strategy?.central_message) points.push({ id: "p-central", label: outline.strategy.central_message, group: "strategy" });
  if (outline?.strategy?.tone_guidance) points.push({ id: "p-tone", label: `Tone: ${outline.strategy.tone_guidance}`, group: "strategy" });
  const sections = data.sections ?? [];
  sections.forEach((s, i) => points.push({ id: `p-sec-${i}`, label: s.section_name || `Section ${i + 1}`, group: "structure" }));
  let keyPoints: OutlinePoint[] = (outline?.coverage_check ?? []).map((c, i) => ({
    id: `p-kp-${i}`,
    label: c.requirement || `Requirement ${i + 1}`,
    detail: c.where_covered || c.notes || undefined,
    group: "keypoints",
  }));
  if (!keyPoints.length) {
    keyPoints = (data.questions_for_student ?? []).map((q, i) => ({ id: `p-q-${i}`, label: q, group: "keypoints" }));
  }
  if (!keyPoints.length) {
    const reqs = Array.from(new Set(sections.flatMap((s) => s.scholarship_requirement_addressed ?? [])));
    keyPoints = reqs.map((r, i) => ({ id: `p-req-${i}`, label: r, group: "keypoints" }));
  }
  points.push(...keyPoints);
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
  const { lastAnalysis, fitAnalysis, wikiDiscovery, savedWikiSources, activeScholarship, personalizedOutline, drafts, ...studentProfile } =
    user ?? { name: "", email: "" };
  void lastAnalysis;
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
