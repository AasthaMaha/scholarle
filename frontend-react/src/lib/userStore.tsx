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

export type EducationLevel = "high_school" | "undergrad" | "grad" | "phd";

export type HighSchoolProfile = {
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
  educationLevel?: string;
  institution?: string;
  degreeProgram?: string;
  majorField?: string;
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
  wordCount: number;
  score?: number;
  savedAt: string;
  // Per-version evaluation snapshots (progress tracking).
  coachScores?: Record<string, number>;
  coachOverall?: number;
  coachSummary?: string;
  readinessScores?: Record<string, number>;
  readinessOverall?: number;
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
  eligibilityRequirements?: string[];
  requiredApplicationMaterials?: string[];
  benefits?: string[];
  selectionCriteria?: string[];
  applicationProcess?: string[];
  missingInformation?: string[];
  importantNotes?: string[];
  requirements?: Array<{ category?: string; requirement?: string; source?: string }>;
  requirementsPreview?: string;
  additionalNotes?: string;
  fullText?: string;
  sourceUrls?: string[];
  extractionCompletedAt?: string;
};

export type AnalysisScore = {
  score?: number;
  level?: string;
  coaching?: string;
  delta?: number;
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

export type EssayAlignmentMatrix = {
  essay_id?: string;
  essay_version_id?: string;
  opportunity_id?: string;
  overall_alignment_status?: "Ready" | "Mostly ready" | "Needs revision" | "Major gaps" | "Insufficient information" | string;
  completion_percent?: number;
  word_count?: number;
  word_limit_status?: "Within limit" | "Over limit" | "Underdeveloped" | "No limit provided" | string;
  matrix?: Array<{
    requirement?: string;
    requirement_type?: string;
    essay_evidence?: string;
    essay_location?: string;
    status?: "Met" | "Partially met" | "Missing" | "Unclear" | "Not applicable" | string;
    risk_level?: "Low" | "Medium" | "High" | string;
    revision_needed?: string;
    notes?: string;
  }>;
  missing_or_weak_items?: string[];
  unsupported_claims?: string[];
  strengths?: string[];
  recommended_revision_tasks?: string[];
  final_submission_readiness?: string;
};

export type AnalysisResult = {
  coaching_brief?: {
    recommended_action?: string;
    current_strength_level?: string;
    biggest_opportunity?: string;
    expected_improvement?: string;
    coach_message?: string;
  };
  readiness_index?: Record<string, AnalysisScore>;
  growth_report?: {
    has_previous_draft?: boolean;
    improvements?: string[];
    growth_message?: string;
  };
  reviewer_comments?: Array<{ persona?: string; comment?: string }>;
  coaching_reports?: Record<string, Record<string, string>>;
  eligibility_matrix?: EligibilityMatrix;
  essay_alignment_matrix?: EssayAlignmentMatrix;
  feedback?: string;
  section_coaching?: Record<string, unknown>;
  opportunity_analysis?: Record<string, unknown>;
  critique?: {
    verdict?: string;
    confidence?: number;
    grounding_pass?: boolean;
    guardrail_pass?: boolean;
    issues?: string[];
    revision_guidance?: string;
    attempt?: number;
  };
  final_application_package?: string;
  revision_priorities?: string[];
  draft_number?: number;
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
    competitiveness?: string;
    search_tips?: string[];
    suggested_queries?: string[];
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
};

export type PersonalizedOutlineResult = {
  status?: "success" | "error" | string;
  message?: string;
  outline?: {
    outline_title?: string;
    thesis_or_core_message?: string;
    sections?: Array<{
      section_name?: string;
      purpose?: string;
      suggested_content?: string[];
      profile_evidence_to_use?: string[];
      scholarship_requirement_addressed?: string[];
      estimated_word_count?: string;
      coaching_notes?: string[];
    }>;
    recommended_opening?: string;
    recommended_conclusion?: string;
    questions_for_student?: string[];
  };
  strategy?: {
    recommended_strategy?: string;
    central_message?: string;
    tone_guidance?: string;
  };
  coverage_check?: Array<{
    requirement?: string;
    covered?: boolean;
    where_covered?: string;
    notes?: string;
  }>;
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
  researchExperience?: ResearchExperienceEntry[];
  workExperience?: WorkExperienceEntry[];
  // optional
  optional?: OptionalSections;
  // prompts
  prompts?: PromptAnswers;
  // essay (current working draft)
  essayTitle?: string;
  essayDraft?: string;
  // last journey step index, so the student resumes where they left off
  lastStep?: number;
  // scholarship currently being analyzed
  activeScholarship?: ActiveScholarship;
  // latest result returned by the Scholar-E AI coach
  lastAnalysis?: AnalysisResult;
  // latest dedicated scholarship fit analysis
  fitAnalysis?: FitAnalysisResult;
  // latest discovery wiki recommendations
  wikiDiscovery?: WikiDiscoveryResult;
  personalizedOutline?: PersonalizedOutlineResult;
  savedWikiSources?: SavedWikiSource[];
  // versioned drafts
  drafts?: EssayDraft[];
  // documents
  documents?: { name: string; kind: string }[];
};

type Ctx = {
  user: UserProfile | null;
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
  if (user.drafts && user.drafts.length > MAX_VERSIONS) {
    return { ...user, drafts: user.drafts.slice(-MAX_VERSIONS) };
  }
  return user;
}

const UserContext = createContext<Ctx | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const hydrated = useRef(false);

  // Hydrate once on the client from the saved account for the current email.
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {}
    const store = readStore();
    const saved = store.accounts[store.currentEmail] ?? store.accounts[""];
    if (saved) setUser(saved);
    hydrated.current = true;
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
        return { ...existing, email: key, name: existing.name || name };
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
    () => ({ user, updateProfile, resetProfile, signIn, signOut }),
    [user, updateProfile, resetProfile, signIn, signOut],
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
