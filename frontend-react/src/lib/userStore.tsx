import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { EssayFixCacheEntry } from "@/lib/fixCache";

export type EducationLevel = "high_school" | "undergrad" | "grad" | "phd";

export type DiscoveryIntent = {
  id: string;
  label: string;
  dimension: "opportunity_type" | "field" | "funding_outcome" | "student_context" | "career_direction";
  value: string;
  canonical_values?: string[];
  derived_from: string[];
};

export type HighSchoolProfile = {
  institution?: string;
  currentGrade?: string;
  gradMonth?: string;
  gradYear?: string;
  gpa?: string;
  gpaWeighting?: string;
  testStatus?: string;
  intendedStartYear?: string;
  intendedMajor?: string;
  apIb?: string;
  parentEducation?: string;
  activities?: string;
  volunteer?: string;
  extracurricular?: string;
  needsHelpWith?: string[];
};

export type UndergradProfile = {
  institution?: string;
  collegeType?: string;
  currentYear?: string;
  enrollment?: string;
  major?: string;
  minor?: string;
  gpa?: string;
  creditsCompleted?: string;
  transferHistory?: string;
  experience?: string;
  orgsLeadership?: string;
  scholarshipHistory?: string;
  needsHelpWith?: string[];
};

export type GradProfile = {
  graduateLevel?: string;
  program?: string;
  institution?: string;
  department?: string;
  researchArea?: string;
  assistantshipStatus?: string;
  researchOutput?: string;
  licenses?: string;
  travelNeeds?: string;
  needsHelpWith?: string[];
};

export type EducationHistoryEntry = {
  id: string;
  source?: "onboarding" | "resume" | "manual";
  isCurrent?: boolean;
  educationLevel?: string;
  institution?: string;
  institutionId?: string;
  institutionType?: "high_school" | "postsecondary" | "manual";
  institutionLocation?: string;
  degreeProgram?: string;
  majorField?: string;
  majorCipCode?: string;
  department?: string;
  gpa?: string;
  startDate?: string;
  endDate?: string;
};

export type ResearchExperienceEntry = {
  id: string;
  researchAreas?: string;
  researchProjects?: string;
  publications?: string;
  conferences?: string;
  thesisStatus?: string;
  assistantshipStatus?: string;
  advisorLabDepartment?: string;
};

export type WorkExperienceEntry = {
  id: string;
  roleTitle?: string;
  organization?: string;
  experienceType?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  skillsTechnologies?: string;
};

export type OptionalSections = {
  resumeFileName?: string;
  volunteering?: string;
  societyInvolvement?: string;
  leadership?: string;
  sports?: string;
  articlesPublished?: string;
  projects?: string;
};

export type PromptAnswers = {
  challenge?: string;
  leadership?: string;
  teamwork?: string;
};

export type EssayDraft = {
  id: string;
  version: number;
  content: string;
  contentHtml?: string;
  promptId?: string;
  wordCount: number;
  savedAt: string;
  scholarshipName?: string;
  // Per-version snapshots of the canonical Essay Review.
  reviewScores?: Record<string, number>;
  reviewOverall?: number;
  reviewLevels?: Record<string, string>;
  reviewOverallLevel?: string;
};

export type ApplicationStatus = "Drafting" | "Submitted" | "Awarded";

export type TrackedApplication = {
  id: string;
  name: string;
  type?: string;
  status: ApplicationStatus;
  scoreHistory?: number[];
  updatedAt?: string;
};

export type EssayPromptEntry = {
  id: string;
  promptNumber: number;
  promptText: string;
  minimumWords: number | null;
  maximumWords: number | null;
  minimumWordsReviewed?: boolean;
  maximumWordsReviewed?: boolean;
};

export type ActiveScholarship = {
  name?: string;
  organization?: string;
  type?: string;
  country?: string;
  officialWebsite?: string;
  url?: string;
  applicationOpens?: string;
  awardAmount?: string;
  applicationDeadline?: string;
  notificationDate?: string;
  programStart?: string;
  programEnd?: string;
  currentStatus?: string;
  description?: string;
  minimumGpa?: string;
  enrollmentLevel?: string;
  citizenshipRequirement?: string;
  financialNeedRequirement?: string;
  locationRequirement?: string;
  eligibleMajors?: string;
  otherEligibilityRules?: string;
  requiredDocumentTypes?: string[];
  otherRequiredMaterials?: string;
  essayPrompts?: string;
  essayPromptEntries?: EssayPromptEntry[];
  allEssayPromptEntries?: EssayPromptEntry[];
  selectedEssayPromptIds?: string[];
  selectedEssayPromptEntries?: EssayPromptEntry[];
  selectedEssayPrompts?: string;
  noEssayPromptSelected?: boolean;
  noEssayPromptConflictConfirmed?: boolean;
  eligibilityRequirements?: string[];
  requiredApplicationMaterials?: string[];
  benefits?: string[];
  selectionCriteria?: string[];
  applicationProcess?: string[];
  importantNotes?: string[];
  requirements?: Array<{ category?: string; requirement?: string; source?: string }>;
  requirementsPreview?: string;
  additionalNotes?: string;
  fullText?: string;
  sourceUrls?: string[];
  sourceMetadata?: Array<{
    url?: string;
    title?: string;
    content_type?: string;
    authority?: string;
    fetched?: boolean;
    error?: string;
    textChars?: number;
  }>;
  fieldEvidence?: Array<{
    field?: string;
    value?: string;
    sourceUrl?: string;
    evidence?: string;
    confidence?: number;
    authority?: string;
  }>;
  extractionWarnings?: string[];
  validationWarnings?: string[];
  criticalFieldsFound?: string[];
  criticalFieldsMissing?: string[];
  completenessScore?: number;
  resolutionStatus?: string;
  extractedAt?: string;
  discoverySource?: string;
  discoverySourceKind?: "scholarship" | "platform" | "user_entry" | string;
  extractionCompletedAt?: string;
};

export type AnalysisScore = {
  score?: number;
  level?: string;
  coaching?: string;
  justification?: string;
  feedback?: string;
  revision_actions?: Array<{
    priority?: string;
    why_it_matters?: string;
    how_to_fix?: string;
    impact?: string;
    estimated_effort?: string;
  }>;
  rubric?: {
    description?: string;
    excellent?: string;
    developing?: string;
    weak?: string;
  };
  delta?: number;
};

export type EssayCriterionReview = {
  criterion?: string;
  label?: string;
  short_label?: string;
  weight?: number;
  raw_score?: number | null;
  score?: number | null;
  level?: string;
  applied_safeguards?: string[];
  answers?: Array<{
    question_id?: string;
    question?: string;
    value?: 0 | 0.5 | 1;
    answer_label?: string;
    evidence?: Array<{ paragraph_id?: string; quote?: string }>;
    explanation?: string;
  }>;
  normalized_question_weights?: Record<string, number>;
  coach_feedback?: {
    grounded_praise?: string;
    main_gap?: string;
  };
  criterion_specific_gap?: {
    statement?: string;
    root_cause_tag?: string;
    severity?: "high" | "medium" | "low" | string;
    evidence?: Array<{ paragraph_id?: string; quote?: string }>;
  };
  candidate_actions?: Array<{
    action_type?: string;
    location?: string;
    instruction?: string;
    completion_condition?: string;
    estimated_effort?: string;
  }>;
  related_priority_ids?: string[];
  rubric?: {
    version?: string;
    description?: string;
    levels?: Array<{ label?: string; minimum?: number; maximum?: number }>;
    questions?: Array<{
      id?: string;
      question?: string;
      weight?: number;
      normalized_weight?: number;
      anchors?: Record<string, string>;
      applicable?: boolean;
      not_applicable?: {
        reason?: string;
        reason_code?: string;
        source_quote?: string;
      } | null;
    }>;
  };
  available?: boolean;
};

export type EssayManagerPlan = {
  rubric_version?: string;
  weight_policy_version?: string;
  manager_summary?: string;
  weight_source?: "published" | "deterministic_source_signals" | string;
  weight_total?: number;
  base_weights?: Record<string, number>;
  evidence_points?: Record<string, number>;
  source_signals?: Array<{
    criterion?: string;
    signal_type?: string;
    source_field?: string;
    source_quote?: string;
    construct?: string;
    points?: number;
  }>;
  published_weights?: Array<Record<string, unknown>>;
  context_hash?: string;
  criteria?: Record<string, {
    label?: string;
    short_label?: string;
    weight?: number;
    base_weight?: number;
    weight_adjustment?: number;
    evidence_points?: number;
    weight_rationale?: string;
    description?: string;
    reviewer_lens?: string;
    questions?: EssayCriterionReview["rubric"] extends infer R
      ? R extends { questions?: infer Q }
        ? Q
        : never
      : never;
  }>;
};

export type EssayRevisionPriority = {
  id?: string;
  title?: string;
  action?: string;
  location?: string;
  completion_condition?: string;
  primary_criterion?: string;
  also_improves?: string[];
  source_gap_criteria?: string[];
  impact?: "High" | "Medium" | "Low" | string;
  estimated_effort?: "Quick" | "Moderate" | "Deep" | string;
  evidence_safety?: string;
  requirement_source?: "prompt_requirement" | "scholarship_criterion" | "essay_quality" | string;
  requirement_quote?: string;
  priority_reason?: string;
  evidence_status?: "sufficient" | "partial" | "missing" | string;
  suggestion_readiness?: "complete_edit" | "advice_if_needed" | string;
  profile_opportunity?: {
    used?: boolean;
    fact?: string;
    included_in_score?: false;
  };
};

export type EssayReviewResult = {
  schema_version: 5;
  status:
    | "success"
    | "scoring_success_coaching_partial"
    | "partial"
    | "error"
    | "insufficient_to_assess"
    | "evaluation_unavailable";
  status_message?: string;
  reason_code?: string;
  overall_score?: number | null;
  overall_raw_score?: number | null;
  overall_level?: string;
  overall_safeguards?: string[];
  criteria: Record<string, EssayCriterionReview>;
  revision_priorities?: EssayRevisionPriority[];
  revision_plan?: {
    version?: string;
    priorities?: EssayRevisionPriority[];
    available?: boolean;
  };
  manager_plan: EssayManagerPlan;
  quality_review: {
    approved?: boolean;
    scoring_approved?: boolean;
    coaching_approved?: boolean;
    qa?: Record<string, unknown>;
    guardrail?: Record<string, unknown>;
    programmatic_failed_criteria?: string[];
    planner_available?: boolean;
  };
  diagnostics?: {
    failure_stage?: string;
    failed_components?: string[];
    error_codes?: string[];
    criterion_errors?: Array<{
      criterion?: string;
      error_code?: string;
      question_id?: string;
    }>;
    retry_attempts?: Record<string, number>;
    agent_status?: Record<string, string>;
    warnings?: string[];
  };
  draft_progress?: {
    has_previous_draft?: boolean;
    overall_change?: number;
    resolved_gap_count?: number;
    criterion_changes?: Array<{
      criterion?: string;
      label?: string;
      previous_score?: number;
      current_score?: number;
      score_change?: number;
      previous_level?: string;
      current_level?: string;
      level_changed?: boolean;
      previous_gap_changed?: boolean;
    }>;
  };
  metadata?: {
    rubric_version?: string;
    evaluator_version?: string;
    revision_planner_version?: string;
    scoring_fingerprint?: string;
    coaching_fingerprint?: string;
    scoring_reused?: boolean;
    cache_hit?: boolean;
  };
};

export type EligibilityStatus = "met" | "not_met" | "missing";

export type EligibilityRow = {
  requirement?: string;
  category?: string;
  student_value?: string;
  status?: EligibilityStatus;
  explanation?: string;
  action_needed?: string;
};

export type EligibilityMatrix = {
  rows?: EligibilityRow[];
  violations?: EligibilityRow[];
  missing_info?: EligibilityRow[];
  violation_count?: number;
  missing_count?: number;
  met_count?: number;
  overall?: "eligible" | "not_eligible" | "incomplete";
  summary?: string;
};

export type ApplicationReadinessMatrix = {
  overall_status?: string;
  completion_percent?: number;
  ready_count?: number;
  total_count?: number;
  matrix?: Array<{
    item?: string;
    item_type?: string;
    status?: "Ready" | "Missing" | "In progress" | "Need to confirm" | "Not applicable" | string;
    risk_level?: "Low" | "Medium" | "High" | string;
    student_evidence?: string;
    action_needed?: string;
    notes?: string;
  }>;
  blockers?: Array<Record<string, string>>;
  preparation_tasks?: string[];
  summary?: string;
};

export type FitAnalysisResult = {
  scholarship_name?: string;
  fit_label?: string;
  fit_score?: number;
  likely_eligible?: "Yes" | "No" | "Unclear" | string;
  summary?: string;
  eligibility_analysis?: Array<{
    requirement?: string;
    status?: "Met" | "Not met" | "Unclear" | "Not applicable" | string;
    student_evidence?: string;
    explanation?: string;
  }>;
  strengths?: string[];
  gaps_or_risks?: string[];
  missing_student_information?: string[];
  application_materials_check?: Array<{
    material?: string;
    status?: "Ready" | "Missing" | "Need to prepare" | "Need to confirm" | "Not applicable" | string;
    notes?: string;
  }>;
  selection_criteria_alignment?: Array<{
    criterion?: string;
    alignment?: "Strong" | "Moderate" | "Weak" | "Unclear" | string;
    student_evidence?: string;
    notes?: string;
  }>;
  recommended_next_steps?: string[];
  application_readiness_matrix?: ApplicationReadinessMatrix;
};

export type SavedWikiSource = {
  id: string;
  name: string;
  url?: string;
  category?: string;
  tags?: string[];
  notes?: string;
  saved_at: string;
};

export type WikiDiscoveryResult = {
  page_title?: string;
  profile_summary?: Record<string, unknown>;
  recommended_source_groups?: Array<{
    group_name?: string;
    match_reason?: string;
    priority?: "High" | "Medium" | "Low" | string;
    sources?: Array<{
      name?: string;
      url?: string;
      category?: string;
      cost?: string;
      best_for?: string[];
      why_recommended?: string;
      search_tips?: string[];
      suggested_queries?: string[];
    }>;
  }>;
  top_free_platforms?: Array<{
    name?: string;
    url?: string;
    category?: string;
    best_for?: string[];
    search_tips?: string[];
    why_recommended?: string;
    access_note?: string;
    source_authority?: string;
  }>;
  specific_opportunities?: Array<{
    name?: string;
    url?: string;
    category?: string;
    cost?: string;
    best_for?: string[];
    why_recommended?: string;
    status_note?: string;
    award_amount?: string;
    deadline_window?: string;
    deadline_status?: "open" | "upcoming" | "unknown" | "closed" | string;
    deadline_verified?: boolean;
    deadline_checked_at?: string;
    deadline_source_url?: string;
    competitiveness?: string;
    search_tips?: string[];
    suggested_queries?: string[];
    source_authority?: string;
  }>;
  funding_categories?: Array<{
    category_name?: string;
    description?: string;
    best_for?: string[];
    example_source_types?: string[];
    suggested_queries?: string[];
  }>;
  personalized_search_queries?: string[];
  next_steps?: string[];
  missing_profile_fields?: string[];
  discovery_focus?: string;
  selected_intents?: DiscoveryIntent[];
  free_text_intent?: string;
  generated_at?: string;
  result_note?: string;
};

export type PersonalizedOutlineResult = {
  status?: "success" | "error" | string;
  message?: string;
  outline?: {
    sections?: Array<{
      section_name?: string;
      purpose?: string;
      suggested_content?: string[];
      profile_evidence_to_use?: string[];
      scholarship_requirement_addressed?: string[];
      estimated_word_count?: string;
      coaching_notes?: string[];
    }>;
  };
  strategy?: {
    tone_guidance?: string;
  };
  warnings?: string[];
  missing_profile_info?: string[];
  generatedForKey?: string;
};

export type UserProfile = {
  // account
  id?: number;
  name: string;
  email: string;
  // universal
  pronouns?: string;
  gender?: string;
  location?: string;
  nationality?: string;
  citizenshipStatus?: string;
  raceEthnicity?: string;
  hispanicLatino?: string;
  identity?: string[];
  firstGen?: boolean;
  pellEligible?: boolean;
  // extended context checkboxes (key -> bool)
  extendedContext?: Record<string, boolean>;
  careerGoal?: string;
  opportunityPreferences?: string[];
  // branching
  educationLevel?: EducationLevel;
  highSchool?: HighSchoolProfile;
  undergrad?: UndergradProfile;
  graduate?: GradProfile;
  educationHistory?: EducationHistoryEntry[];
  academicOnboardingCompleted?: boolean;
  profileStartChoiceCompleted?: boolean;
  profileSetupCompleted?: boolean;
  journeyTutorialPending?: boolean;
  journeyTutorialCompleted?: boolean;
  journeyTutorialSkipped?: boolean;
  essayWorkspaceTutorialCompleted?: boolean;
  researchExperience?: ResearchExperienceEntry[];
  workExperience?: WorkExperienceEntry[];
  // optional
  optional?: OptionalSections;
  // prompts
  prompts?: PromptAnswers;
  // essay (current working draft)
  essayTitle?: string;
  essayDraft?: string;
  essayDraftHtml?: string;
  essayDraftsByPromptId?: Record<string, string>;
  essayDraftHtmlByPromptId?: Record<string, string>;
  // Student-approved words that sentence-level spelling checks must preserve.
  personalDictionary?: string[];
  // Prompt-scoped, locally persisted Fixes results and student ignore choices.
  essayFixesByPromptId?: Record<string, EssayFixCacheEntry>;
  ignoredEssayFixesByPromptId?: Record<string, string[]>;
  // last journey step index, so the student resumes where they left off
  lastStep?: number;
  // furthest journey step reached, so first-time navigation unlocks sequentially
  highestJourneyStep?: number;
  // scholarship currently being analyzed
  activeScholarship?: ActiveScholarship;
  // latest schema-v5 six-criterion Essay Review, persisted across remounts
  essayReviewResult?: EssayReviewResult;
  essayReviewUpdatedAt?: number;
  essayReviewDraftAtRun?: string;
  essayReviewPromptAtRun?: string;
  essayReviewProfileFingerprintAtRun?: string;
  // latest dedicated scholarship fit analysis
  fitAnalysis?: FitAnalysisResult;
  // latest discovery wiki recommendations
  wikiDiscovery?: WikiDiscoveryResult;
  discoveryFocus?: string;
  discoveryIntents?: DiscoveryIntent[];
  discoveryIntentOptions?: DiscoveryIntent[];
  discoveryPlatformDefaults?: NonNullable<WikiDiscoveryResult["top_free_platforms"]>;
  dismissedDiscoveryUrls?: string[];
  discoveryFeedback?: Array<{ url?: string; reason?: string; name?: string }>;
  personalizedOutline?: PersonalizedOutlineResult;
  savedWikiSources?: SavedWikiSource[];
  // versioned drafts
  drafts?: EssayDraft[];
  // documents
  documents?: { name: string; kind: string }[];
  // scholarship and internship applications shown in Journey Step 7
  applications?: TrackedApplication[];
};

type Ctx = {
  user: UserProfile | null;
  isHydrated: boolean;
  updateProfile: (patch: Partial<UserProfile>) => void;
  resetProfile: () => void;
  signIn: (email: string, name?: string) => void;
  signOut: () => void;
};

const LEGACY_STORAGE_KEY = "scholar-e:user";
// On-device persistence: one blob holding the signed-in email and a per-account
// map of the full profile (incl. draft, versions, scores). Lets the student log
// out / refresh and resume where they stopped on this device.
const STORAGE_KEY = "scholar-e:state:v2";
const MAX_VERSIONS = 20;

type PersistShape = { currentEmail: string; accounts: Record<string, UserProfile> };

/** Drop retired Page 4 review fields instead of carrying them forward forever. */
function withoutLegacyEssayReviewData(user: UserProfile): UserProfile {
  const legacyUser = user as UserProfile & {
    lastAnalysis?: unknown;
    essayCoachResult?: unknown;
    essayCoachSummary?: unknown;
    essayCoachUpdatedAt?: unknown;
  };
  const {
    lastAnalysis: _lastAnalysis,
    essayCoachResult: _essayCoachResult,
    essayCoachSummary: _essayCoachSummary,
    essayCoachUpdatedAt: _essayCoachUpdatedAt,
    ...current
  } = legacyUser;
  void _lastAnalysis;
  void _essayCoachResult;
  void _essayCoachSummary;
  void _essayCoachUpdatedAt;

  const drafts = current.drafts?.map((draft) => {
    const legacyDraft = draft as EssayDraft & {
      score?: unknown;
      coachScores?: unknown;
      coachOverall?: unknown;
      coachSummary?: unknown;
      readinessScores?: unknown;
      readinessOverall?: unknown;
    };
    const {
      score: _score,
      coachScores: _coachScores,
      coachOverall: _coachOverall,
      coachSummary: _coachSummary,
      readinessScores: _readinessScores,
      readinessOverall: _readinessOverall,
      ...currentDraft
    } = legacyDraft;
    void _score;
    void _coachScores;
    void _coachOverall;
    void _coachSummary;
    void _readinessScores;
    void _readinessOverall;
    return currentDraft;
  });

  const reviewSchema = (current.essayReviewResult as { schema_version?: number } | undefined)?.schema_version;
  const currentReview = reviewSchema === 5
    ? current
    : {
        ...current,
        essayReviewResult: undefined,
        essayReviewUpdatedAt: undefined,
        essayReviewDraftAtRun: undefined,
        essayReviewPromptAtRun: undefined,
        essayReviewProfileFingerprintAtRun: undefined,
      };

  return drafts ? { ...currentReview, drafts } : currentReview;
}

function readStore(): PersistShape {
  if (typeof window === "undefined") return { currentEmail: "", accounts: {} };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { currentEmail: "", accounts: {} };
    const parsed = JSON.parse(raw) as Partial<PersistShape>;
    return { currentEmail: parsed.currentEmail ?? "", accounts: parsed.accounts ?? {} };
  } catch {
    return { currentEmail: "", accounts: {} };
  }
}

function writeStore(shape: PersistShape) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shape));
  } catch {
    /* quota or serialization error — never break the app */
  }
}

// Bound stored size: keep only the most recent draft versions.
function forStorage(user: UserProfile): UserProfile {
  const current = withoutLegacyEssayReviewData(user);
  if (current.drafts && current.drafts.length > MAX_VERSIONS) {
    return { ...current, drafts: current.drafts.slice(-MAX_VERSIONS) };
  }
  return current;
}

const UserContext = createContext<Ctx | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const hydrated = useRef(false);

  // Hydrate once on the client from the saved account for the current email.
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Storage may be disabled; hydration can still continue in memory.
    }
    const store = readStore();
    const saved = store.accounts[store.currentEmail] ?? store.accounts[""];
    if (saved) setUser(withoutLegacyEssayReviewData(saved));
    hydrated.current = true;
    setIsHydrated(true);
  }, []);

  // Persist (debounced) whenever the profile changes, keyed by email.
  useEffect(() => {
    if (!hydrated.current) return;
    const id = window.setTimeout(() => {
      const store = readStore();
      const email = user?.email || "";
      if (user) {
        store.accounts[email] = forStorage(user);
        store.currentEmail = email;
      }
      writeStore(store);
    }, 500);
    return () => window.clearTimeout(id);
  }, [user]);

  const updateProfile = useCallback((patch: Partial<UserProfile>) => {
    setUser((prev) => ({ ...(prev ?? { name: "", email: "" }), ...patch }));
  }, []);

  const resetProfile = useCallback(() => {
    // "Clear all" wipes the current account's saved data too.
    const store = readStore();
    delete store.accounts[store.currentEmail || ""];
    store.currentEmail = "";
    writeStore(store);
    setUser(null);
  }, []);

  const signIn = useCallback((email: string, name = "") => {
    const key = email.trim();
    const store = readStore();
    setUser((prev) => {
      const existing = store.accounts[key];
      if (existing) {
        // Resume this account exactly where it left off.
        const current = withoutLegacyEssayReviewData(existing);
        return { ...current, email: key, name: current.name || name };
      }
      // New account: carry over any guest edits made before signing in.
      const guest = prev && !prev.email ? prev : null;
      return { ...(guest ?? {}), name: name || (guest?.name ?? ""), email: key } as UserProfile;
    });
    store.currentEmail = key;
    writeStore(store);
  }, []);

  const signOut = useCallback(() => {
    // Keep the saved account so re-login resumes; just leave the session.
    const store = readStore();
    store.currentEmail = "";
    writeStore(store);
    setUser(null);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ user, isHydrated, updateProfile, resetProfile, signIn, signOut }),
    [user, isHydrated, updateProfile, resetProfile, signIn, signOut],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used inside <UserProvider>");
  return ctx;
}

export function initials(name?: string) {
  if (!name) return "👤";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
