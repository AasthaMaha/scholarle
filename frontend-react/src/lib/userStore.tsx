import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AUTH_TOKEN_KEY,
  fetchCurrentUser,
  type AuthUser,
} from "@/lib/api/auth";

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
  type?: string;
  url?: string;
  awardAmount?: string;
  applicationDeadline?: string;
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
  additionalNotes?: string;
  fullText?: string;
};

export type AnalysisScore = {
  score?: number;
  level?: string;
  coaching?: string;
  delta?: number;
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
  feedback?: string;
  section_coaching?: Record<string, unknown>;
  opportunity_analysis?: Record<string, unknown>;
  final_application_package?: string;
  revision_priorities?: string[];
  draft_number?: number;
};

export type UserProfile = {
  // account
  id?: number;
  name: string;
  email: string;
  googleEmail?: string | null;
  // universal
  pronouns?: string;
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
  // optional
  optional?: OptionalSections;
  // prompts
  prompts?: PromptAnswers;
  // essay (current working draft)
  essayDraft?: string;
  // scholarship currently being analyzed
  activeScholarship?: ActiveScholarship;
  // latest result returned by the Python/FastAPI backend
  lastAnalysis?: AnalysisResult;
  // versioned drafts
  drafts?: EssayDraft[];
  // documents
  documents?: { name: string; kind: string }[];
};

type Ctx = {
  user: UserProfile | null;
  isAuthenticated: boolean;
  authToken: string | null;
  setAuthenticatedUser: (authUser: AuthUser, token: string) => void;
  refreshCurrentUser: () => Promise<void>;
  signIn: (email: string, name?: string) => void;
  signOut: () => void;
  updateProfile: (patch: Partial<UserProfile>) => void;
};

const STORAGE_KEY = "scholar-e:user";

const UserContext = createContext<Ctx | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      const token = typeof window !== "undefined" ? localStorage.getItem(AUTH_TOKEN_KEY) : null;
      if (raw) setUser(JSON.parse(raw));
      if (token) setAuthToken(token);
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !authToken) return;
    fetchCurrentUser(authToken)
      .then((authUser) => {
        setUser((prev) => ({
          ...(prev ?? {}),
          id: authUser.id,
          name: authUser.name,
          email: authUser.email,
          googleEmail: authUser.google_email ?? null,
        }));
      })
      .catch(() => {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        setAuthToken(null);
      });
  }, [hydrated, authToken]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [user, hydrated]);

  const setAuthenticatedUser = useCallback((authUser: AuthUser, token: string) => {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    setAuthToken(token);
    setUser((prev) => ({
      ...(prev ?? {}),
      id: authUser.id,
      email: authUser.email,
      name: authUser.name,
      googleEmail: authUser.google_email ?? null,
    }));
  }, []);

  const refreshCurrentUser = useCallback(async () => {
    const token = authToken ?? localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) return;
    const authUser = await fetchCurrentUser(token);
    setUser((prev) => ({
      ...(prev ?? {}),
      id: authUser.id,
      email: authUser.email,
      name: authUser.name,
      googleEmail: authUser.google_email ?? null,
    }));
  }, [authToken]);

  const signIn = useCallback((email: string, name?: string) => {
    setUser((prev) => ({
      ...(prev ?? {}),
      email,
      name: name ?? prev?.name ?? email.split("@")[0],
    }));
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setAuthToken(null);
    setUser(null);
  }, []);

  const updateProfile = useCallback((patch: Partial<UserProfile>) => {
    setUser((prev) => ({ ...(prev ?? { name: "", email: "" }), ...patch }));
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      user,
      isAuthenticated: !!authToken && !!user?.email,
      authToken,
      setAuthenticatedUser,
      refreshCurrentUser,
      signIn,
      signOut,
      updateProfile,
    }),
    [user, authToken, setAuthenticatedUser, refreshCurrentUser, signIn, signOut, updateProfile],
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
