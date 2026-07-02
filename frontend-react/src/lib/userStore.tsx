import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
    status_note?: string;
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
  // scholarship currently being analyzed
  activeScholarship?: ActiveScholarship;
  // latest result returned by the Scholar-E AI coach
  lastAnalysis?: AnalysisResult;
  // latest dedicated scholarship fit analysis
  fitAnalysis?: FitAnalysisResult;
  // latest discovery wiki recommendations
  wikiDiscovery?: WikiDiscoveryResult;
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
};

// Legacy key — older builds persisted the profile here and re-hydrated it on
// load, which made fields appear pre-filled. We now keep the profile in memory
// only, so the app always starts empty and fields are filled solely via the
// "Load example" button (or by the user typing).
const LEGACY_STORAGE_KEY = "scholar-e:user";

const UserContext = createContext<Ctx | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);

  // One-time cleanup of any profile saved by older builds so reopening the app
  // never shows stale pre-filled data.
  useEffect(() => {
    try {
      if (typeof window !== "undefined") localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {}
  }, []);

  const updateProfile = useCallback((patch: Partial<UserProfile>) => {
    setUser((prev) => ({ ...(prev ?? { name: "", email: "" }), ...patch }));
  }, []);

  const resetProfile = useCallback(() => {
    setUser(null);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ user, updateProfile, resetProfile }),
    [user, updateProfile, resetProfile],
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
