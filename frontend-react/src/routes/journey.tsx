import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  FileUp,
  Heading1,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Menu,
  PencilLine,
  Power,
  Redo2,
  Underline,
  Undo2,
} from "lucide-react";
import { journeySteps } from "@/lib/persona";
import { loadExampleProfile } from "@/lib/loadExample";
import { CoachRunButton } from "@/components/CoachRunButton";
import {
  analyzeScholarshipFit,
  autofillProfileFromResume,
  buildFitPayload,
  buildWikiPayload,
  discoverScholarshipWiki,
  extractScholarshipOpportunity,
} from "@/lib/api/scholarE";
import {
  useUser,
  initials as toInitials,
  type EducationLevel,
  type EducationHistoryEntry,
  type ResearchExperienceEntry,
  type WorkExperienceEntry,
  type UserProfile,
  type EssayDraft,
  type ActiveScholarship,
  type SavedWikiSource,
  type WikiDiscoveryResult,
} from "@/lib/userStore";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/journey")({
  head: () => ({
    meta: [
      { title: "Your Journey · Scholar-E" },
      {
        name: "description",
        content:
          "Walk through Scholar-E as yourself — from discovery to submission, with AI coaching on your own essay.",
      },
    ],
  }),
  component: Journey,
});

function Journey() {
  const { user, updateProfile, resetProfile } = useUser();
  const [stepIdx, setStepIdx] = useState(0);
  const [profileError, setProfileError] = useState("");
  const [exampleStatus, setExampleStatus] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  function handleLoadExample() {
    updateProfile(
      loadExampleProfile({
        name: user?.name ?? "",
        email: user?.email ?? "",
        id: user?.id,
      }),
    );
    setExampleStatus("Example loaded — jump to Essay Workspace to run the AI coach.");
    const essayStepIdx = journeySteps.findIndex((s) => s.slug === "essay-workspace");
    if (essayStepIdx >= 0) setStepIdx(essayStepIdx);
  }

  function handleClearAll() {
    resetProfile();
    setStepIdx(0);
    setProfileError("");
    setExampleStatus(null);
  }

  const step = journeySteps[stepIdx];
  const goNext = () => {
    if (step.slug === "profile" && !isProfileComplete(user)) {
      setProfileError("Fill out the required fields");
      return;
    }
    setProfileError("");
    setStepIdx((i) => Math.min(i + 1, journeySteps.length - 1));
  };
  const goPrev = () => {
    setProfileError("");
    setStepIdx((i) => Math.max(i - 1, 0));
  };
  const selectStep = (idx: number) => {
    setStepIdx(idx);
    setIsSidebarOpen(false);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen flex">
        <Sidebar
          activeIdx={stepIdx}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          onSelect={selectStep}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            step={step}
            onNext={goNext}
            onPrev={goPrev}
            stepIdx={stepIdx}
            onLoadExample={handleLoadExample}
            onClearAll={handleClearAll}
          />
          <FloatingSidebarToggle
            isOpen={isSidebarOpen}
            onOpen={() => setIsSidebarOpen(true)}
          />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-5xl px-6 md:px-10 py-10">
              {exampleStatus && (
                <div className="mb-4 rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-foreground/90">
                  {exampleStatus}
                </div>
              )}
              <div>
                <StepBody slug={step.slug} goNext={goNext} profileError={profileError} />
              </div>
              <Nav stepIdx={stepIdx} onNext={goNext} onPrev={goPrev} />
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function isProfileComplete(user: UserProfile | null) {
  return !!(
    user?.gender?.trim() &&
    user.location?.trim() &&
    user.citizenshipStatus?.trim() &&
    user.raceEthnicity &&
    (user.educationHistory?.some((entry) => entry.educationLevel?.trim()) || user.educationLevel)
  );
}

function Sidebar({
  activeIdx,
  isOpen,
  onClose,
  onSelect,
}: {
  activeIdx: number;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (i: number) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, typeof journeySteps>();
    journeySteps.forEach((s) => {
      const arr = map.get(s.group) ?? [];
      arr.push(s);
      map.set(s.group, arr);
    });
    return Array.from(map.entries());
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label="Close sidebar"
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-background/60 transition-opacity duration-300 ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-80 max-w-[85vw] shrink-0 flex-col border-r border-border bg-card/95 backdrop-blur transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link to="/" className="flex items-center gap-2 px-6 h-16 border-b border-border">
          <div className="size-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-display font-bold">
            S<span className="text-gold">e</span>
          </div>
          <div className="font-display font-semibold tracking-tight">Scholar-E</div>
          <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground">journey</span>
        </Link>

        <div className="px-6 py-5 border-b border-border">
          <SidebarUser />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {groups.map(([group, steps]) => (
            <div key={group}>
              <div className="px-3 text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{group}</div>
              <div className="space-y-0.5">
                {steps.map((s) => {
                  const idx = journeySteps.findIndex((x) => x.id === s.id);
                  const isActive = idx === activeIdx;
                  const isDone = idx < activeIdx;
                  return (
                    <button
                      key={s.id}
                      onClick={() => onSelect(idx)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent text-foreground/80"
                      }`}
                    >
                      <span
                        className={`size-6 shrink-0 rounded-full grid place-items-center text-[11px] font-mono ${
                          isActive
                            ? "bg-gold text-gold-foreground"
                            : isDone
                            ? "bg-success/20 text-success"
                            : "bg-secondary text-secondary-foreground"
                        }`}
                      >
                        {isDone ? "✓" : s.id}
                      </span>
                      <span className="truncate">{s.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-border text-[11px] text-muted-foreground">
          A coach, not a ghostwriter.
        </div>
      </aside>
    </>
  );
}

function TopBar({
  step,
  onNext,
  onPrev,
  stepIdx,
  onLoadExample,
  onClearAll,
}: {
  step: (typeof journeySteps)[number];
  onNext: () => void;
  onPrev: () => void;
  stepIdx: number;
  onLoadExample: () => void;
  onClearAll: () => void;
}) {
  const pct = ((stepIdx + 1) / journeySteps.length) * 100;
  return (
    <div className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="px-6 md:px-10 h-16 flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5">
          <div className="size-7 rounded-md bg-primary text-primary-foreground grid place-items-center font-display font-bold text-sm">
            S<span className="text-gold">e</span>
          </div>
          <span className="font-display font-semibold">Scholar-E</span>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground">
            Step {step.id} of {journeySteps.length} · {step.group}
          </div>
          <div className="text-sm font-medium truncate">{step.title}</div>
          <div className="text-xs text-muted-foreground truncate">Goal: {step.goal}</div>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onLoadExample}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
              >
                Load example
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Fill profile, scholarship, and essay with a sample application for testing
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onClearAll}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
              >
                Clear all
              </button>
            </TooltipTrigger>
            <TooltipContent>Reset every field and return to step 1</TooltipContent>
          </Tooltip>
        <div className="hidden md:flex items-center gap-2">
          <button
            onClick={onPrev}
            disabled={stepIdx === 0}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
          >
            ← Back
          </button>
          <button
            onClick={onNext}
            disabled={stepIdx === journeySteps.length - 1}
            className="rounded-full bg-primary text-primary-foreground px-4 py-1.5 text-sm hover:opacity-90 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
        </div>
      </div>
      <div className="h-1 bg-secondary">
        <div className="h-full bg-gold transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FloatingSidebarToggle({
  isOpen,
  onOpen,
}: {
  isOpen: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Open sidebar"
      onClick={onOpen}
      className={`fixed left-0 top-[70px] z-30 flex h-10 items-center gap-3 rounded-full rounded-l-none border border-l-0 border-border/70 bg-white px-3 text-foreground shadow-md shadow-black/10 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${
        isOpen ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      <span className="size-6 rounded-md bg-primary text-primary-foreground grid place-items-center font-display font-bold text-xs">
        S<span className="text-gold">e</span>
      </span>
      <Menu className="size-5 text-muted-foreground" strokeWidth={2.5} />
    </button>
  );
}

function Nav({ stepIdx, onNext, onPrev }: { stepIdx: number; onNext: () => void; onPrev: () => void }) {
  return (
    <div className="mt-12 flex items-center justify-between border-t border-border pt-6">
      <button
        onClick={onPrev}
        disabled={stepIdx === 0}
        className="rounded-full border border-border bg-card px-5 py-2 text-sm hover:bg-accent disabled:opacity-40"
      >
        ← Previous
      </button>
      <div className="text-xs text-muted-foreground font-mono">
        {stepIdx + 1} / {journeySteps.length}
      </div>
      <button
        onClick={onNext}
        disabled={stepIdx === journeySteps.length - 1}
        className="rounded-full bg-primary text-primary-foreground px-6 py-2 text-sm hover:opacity-90 disabled:opacity-40"
      >
        Continue →
      </button>
    </div>
  );
}

function StepBody({
  slug,
  goNext,
  profileError,
}: {
  slug: string;
  goNext: () => void;
  profileError: string;
}) {
  switch (slug) {
    case "profile": return <StepProfile error={profileError} />;
    case "discovery": return <StepDiscovery />;
    case "opportunities": return <StepOpportunities onAnalyze={goNext} />;
    case "requirements": return <StepRequirementsAndFit />;
    case "essay-workspace": return <StepEssayWorkspace />;
    case "revise": return <StepRevise />;
    case "final-check": return <StepFinalCheck />;
    case "tracker": return <StepTracker />;
    default: return null;
  }
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border bg-card p-6 ${className}`}>{children}</div>;
}

function Pill({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "gold" | "success" | "warn" | "info" | "danger" }) {
  const tones = {
    default: "bg-secondary text-secondary-foreground",
    gold: "bg-gold/20 text-foreground",
    success: "bg-success/15 text-success",
    warn: "bg-warning/20 text-foreground",
    info: "bg-info/15 text-info",
    danger: "bg-destructive/15 text-destructive",
  } as const;
  return <span className={`text-xs rounded-full px-2.5 py-1 ${tones[tone]}`}>{children}</span>;
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-border last:border-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground text-right">{value}</div>
    </div>
  );
}

function FitList({ title, items }: { title: string; items?: string[] }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{title}</div>
      {items?.length ? (
        <ul className="mt-3 list-disc pl-5 text-sm space-y-1">
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No items reported.</p>
      )}
    </div>
  );
}

/* ---------------- Step 1: Land + Onboarding combined ---------------- */

function StepLand() {
  const slides = [
    {
      t: "What is a scholarship?",
      d: "Free money for school — never paid back. Awarded by foundations, employers, governments, and schools.",
    },
    {
      t: "Three types you should know",
      d: "Merit (grades, talent), need-based (income), and identity / community (heritage, major, location, status).",
    },
    {
      t: "How Scholar-E helps",
      d: "We don't write your essay. We help you find scholarships, understand requirements, and improve your drafts.",
    },
  ];
  return (
    <div className="space-y-6">
      <Card className="!p-0 overflow-hidden">
        <div className="p-8 md:p-10 bg-gradient-to-br from-primary to-primary/85 text-primary-foreground">
          <div className="text-xs uppercase tracking-[0.2em] opacity-70">scholar-e.app</div>
          <h2 className="font-display text-3xl md:text-5xl mt-3 text-balance leading-[1.05]">
            Win scholarships in your own voice.
          </h2>
          <p className="mt-4 text-primary-foreground/80 max-w-xl text-base md:text-lg leading-relaxed">
            A coach that helps you discover, analyze, write, and submit — without writing your essays for you.
          </p>
        </div>
        <div className="p-6 md:p-8 grid sm:grid-cols-3 gap-4 bg-card">
          {["Discover", "Analyze", "Coach"].map((t, i) => (
            <div key={t} className="rounded-xl bg-secondary/50 p-5">
              <div className="font-mono text-xs text-gold">0{i + 1}</div>
              <div className="font-display text-lg mt-2">{t}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Quick onboarding — 3 things to know</div>
        <div className="mt-4 grid md:grid-cols-3 gap-4">
          {slides.map((s, i) => (
            <div key={s.t} className="rounded-xl border border-border bg-secondary/40 p-5">
              <div className="font-mono text-xs text-gold">0{i + 1}</div>
              <div className="font-display text-lg mt-2 leading-snug">{s.t}</div>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}



function SidebarUser() {
  const { user, resetProfile } = useUser();
  const navigate = useNavigate();

  function handleSignOut() {
    resetProfile();
    navigate({ to: "/" });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-full bg-primary text-primary-foreground grid place-items-center font-display">
          {toInitials(user?.name)}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{user?.name || "Your profile"}</div>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Power className="size-3.5" strokeWidth={2.5} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function eduLevelLabel(l: EducationLevel) {
  return {
    high_school: "High school student",
    undergrad: "Undergraduate",
    grad: "Graduate student",
    phd: "PhD student",
  }[l];
}

/* -------------------- Glossary tooltip + ext checkbox groups -------------------- */

const GLOSSARY: Record<string, string> = {
  "Pell Grant eligible": "A U.S. federal grant for undergraduates with significant financial need — based on your FAFSA. Doesn't have to be repaid.",
  "FAFSA completed": "Free Application for Federal Student Aid — determines federal aid, work-study, and many state/institutional awards.",
  "First-generation college student": "Typically: neither parent/guardian completed a 4-year college degree.",
  "Low-income background": "Household income below standard federal/state thresholds; often Pell-eligible.",
  "Student with disability": "A documented physical, learning, or mental-health disability eligible for accommodations.",
  "Foster care experience": "You spent time in the U.S. foster-care system (often qualifies for dedicated awards).",
  "Student with dependents": "You have children or other dependents you financially support.",
  "U.S. citizen": "Born in the U.S. or naturalized — broadest eligibility for federal/state aid.",
  "Permanent resident": "Holds a Green Card (Lawful Permanent Resident) — eligible for most federal aid.",
  "International student": "Non-U.S. citizen on a student visa — eligibility narrows to private/institutional awards.",
  "DACA / undocumented student": "Deferred Action for Childhood Arrivals or undocumented — many private and state awards still apply.",
  "Full-time student": "Generally enrolled in 12+ credits/semester (undergrad) or as defined by your school.",
  "Part-time student": "Below the full-time credit threshold.",
  Veteran: "Served in the U.S. armed forces; eligible for GI Bill and veteran-specific awards.",
  "Military dependent": "Spouse or child of an active-duty, retired, or deceased service member.",
};

function GlossaryCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const gloss = GLOSSARY[label];
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-[oklch(0.32_0.09_270)]"
      />
      {gloss ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="border-b border-dotted border-muted-foreground/50 cursor-help">{label}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-relaxed">
            {gloss}
          </TooltipContent>
        </Tooltip>
      ) : (
        <span>{label}</span>
      )}
    </label>
  );
}

function compactObject<T extends Record<string, unknown>>(value: T | undefined) {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, entry]) => {
      if (typeof entry === "string") return entry.trim().length > 0;
      return entry !== undefined && entry !== null;
    }),
  );
}

const EXTENDED_CONTEXT_GROUPS: { group: string; options: string[] }[] = [
  { group: "Financial Need", options: ["Pell Grant eligible", "FAFSA completed", "Low-income background"] },
  { group: "Student Background", options: ["First-generation college student", "Student with disability", "Foster care experience", "Student with dependents"] },
  { group: "Citizenship / Residency Status", options: ["U.S. citizen", "Permanent resident", "International student", "DACA / undocumented student"] },
  { group: "Enrollment Status", options: ["Full-time student", "Part-time student"] },
  { group: "Military Affiliation", options: ["Veteran", "Military dependent"] },
];

/* ---------------- Step 2: Profile (with materials before story prompts) ---------------- */

function StepProfile({ error }: { error: string }) {
  const { user, updateProfile } = useUser();
  const level = user?.educationLevel;
  const [showExtended, setShowExtended] = useState(false);
  const [resumeStatus, setResumeStatus] = useState("");
  const [resumeError, setResumeError] = useState("");
  const [profileStartMode, setProfileStartMode] = useState<"resume" | "manual" | null>(
    user?.optional?.resumeFileName ? "resume" : user?.educationLevel ? "manual" : null,
  );
  const [showStartDialog, setShowStartDialog] = useState(
    !user?.educationLevel && !user?.optional?.resumeFileName,
  );
  const startResumeInputRef = useRef<HTMLInputElement | null>(null);

  function set<K extends keyof UserProfile>(key: K, value: UserProfile[K]) {
    updateProfile({ [key]: value } as Partial<UserProfile>);
  }
  function setBranch<T extends "highSchool" | "undergrad" | "graduate">(
    branch: T,
    patch: Record<string, unknown>,
  ) {
    updateProfile({
      [branch]: { ...((user?.[branch] as object | undefined) ?? {}), ...patch },
    } as Partial<UserProfile>);
  }
  function setOptional(patch: Record<string, unknown>) {
    updateProfile({ optional: { ...(user?.optional ?? {}), ...patch } });
  }
  function setPrompts(patch: Record<string, unknown>) {
    updateProfile({ prompts: { ...(user?.prompts ?? {}), ...patch } });
  }
  function setExt(key: string, v: boolean) {
    updateProfile({ extendedContext: { ...(user?.extendedContext ?? {}), [key]: v } });
  }
  const educationHistory = user?.educationHistory?.length
    ? user.educationHistory
    : buildEducationHistoryFromProfile(user);
  const researchExperience = user?.researchExperience?.length
    ? user.researchExperience
    : buildResearchExperienceFromProfile(user);
  const workExperience = user?.workExperience ?? [];
  const hasGraduateEducation = educationHistory.some((entry) =>
    /grad|master|phd|doctor|mba|jd|md/i.test(
      [entry.educationLevel, entry.degreeProgram].filter(Boolean).join(" "),
    ),
  );
  const [researchOpen, setResearchOpen] = useState(hasGraduateEducation);
  useEffect(() => {
    if (hasGraduateEducation) setResearchOpen(true);
  }, [hasGraduateEducation]);

  function newId(prefix: string) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  function updateEducationEntry(id: string, patch: Partial<EducationHistoryEntry>) {
    const next = educationHistory.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
    updateProfile({
      educationHistory: next,
      educationLevel: educationLevelCode(next[0]?.educationLevel) ?? user?.educationLevel,
    });
  }
  function addEducationEntry() {
    updateProfile({
      educationHistory: [
        ...educationHistory,
        {
          id: newId("edu"),
          educationLevel: "",
          institution: "",
          degreeProgram: "",
          majorField: "",
          department: "",
          gpa: "",
          startDate: "",
          endDate: "",
        },
      ],
    });
  }
  function removeEducationEntry(id: string) {
    const next = educationHistory.filter((entry) => entry.id !== id);
    updateProfile({
      educationHistory: next,
      educationLevel: educationLevelCode(next[0]?.educationLevel),
    });
  }
  function updateResearchEntry(id: string, patch: Partial<ResearchExperienceEntry>) {
    updateProfile({
      researchExperience: researchExperience.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    });
  }
  function addResearchEntry() {
    updateProfile({
      researchExperience: [
        ...researchExperience,
        {
          id: newId("research"),
          researchAreas: "",
          researchProjects: "",
          publications: "",
          conferences: "",
          thesisStatus: "",
          assistantshipStatus: "",
          advisorLabDepartment: "",
        },
      ],
    });
    setResearchOpen(true);
  }
  function removeResearchEntry(id: string) {
    updateProfile({ researchExperience: researchExperience.filter((entry) => entry.id !== id) });
  }
  function updateWorkEntry(id: string, patch: Partial<WorkExperienceEntry>) {
    updateProfile({
      workExperience: workExperience.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    });
  }
  function addWorkEntry() {
    updateProfile({
      workExperience: [
        ...workExperience,
        {
          id: newId("work"),
          roleTitle: "",
          organization: "",
          experienceType: "",
          startDate: "",
          endDate: "",
          description: "",
          skillsTechnologies: "",
        },
      ],
    });
  }
  function removeWorkEntry(id: string) {
    updateProfile({ workExperience: workExperience.filter((entry) => entry.id !== id) });
  }

  // documents
  const docs = user?.documents ?? [];
  function addDoc(kind: string, file: File) {
    updateProfile({ documents: [...docs, { name: file.name, kind }] });
  }
  function removeDoc(name: string) {
    updateProfile({ documents: docs.filter((d) => d.name !== name) });
  }

  async function handleResumeUpload(file: File) {
    setResumeStatus("Reading resume...");
    setResumeError("");
    setProfileStartMode("resume");
    try {
      const profile = await autofillProfileFromResume(file);
      const nextLevel = profile.educationLevel || user?.educationLevel;
      const parsedHighSchool = compactObject(profile.highSchool);
      const parsedUndergrad = compactObject(profile.undergrad);
      const parsedGraduate = compactObject(profile.graduate);
      const parsedProfile: UserProfile = {
        name: profile.name || user?.name || "",
        email: profile.email || user?.email || "",
        educationLevel: (nextLevel || undefined) as EducationLevel | undefined,
        highSchool: parsedHighSchool,
        undergrad: parsedUndergrad,
        graduate: parsedGraduate,
      };
      const nextEducationHistory = (profile.educationHistory?.length
        ? profile.educationHistory
        : buildEducationHistoryFromProfile(parsedProfile)
      ).map((entry, index) => ({ ...entry, id: entry.id || `edu-${index + 1}` }));
      const nextResearchExperience = (profile.researchExperience?.length
        ? profile.researchExperience
        : buildResearchExperienceFromProfile(parsedProfile)
      ).map((entry, index) => ({ ...entry, id: entry.id || `research-${index + 1}` }));
      const nextWorkExperience = (profile.workExperience ?? []).map((entry, index) => ({
        ...entry,
        id: entry.id || `work-${index + 1}`,
      }));
      updateProfile({
        name: profile.name || user?.name || "",
        email: profile.email || user?.email || "",
        location: profile.location || user?.location,
        careerGoal: profile.careerGoal || user?.careerGoal,
        educationLevel: (nextLevel || undefined) as EducationLevel | undefined,
        highSchool: {
          ...(user?.highSchool ?? {}),
          ...parsedHighSchool,
        },
        undergrad: {
          ...(user?.undergrad ?? {}),
          ...parsedUndergrad,
        },
        graduate: {
          ...(user?.graduate ?? {}),
          ...parsedGraduate,
        },
        educationHistory: nextEducationHistory.length ? nextEducationHistory : user?.educationHistory,
        researchExperience: nextResearchExperience.length
          ? nextResearchExperience
          : user?.researchExperience,
        workExperience: nextWorkExperience.length ? nextWorkExperience : user?.workExperience,
        optional: {
          ...(user?.optional ?? {}),
          ...compactObject(profile.optional),
          resumeFileName: file.name,
        },
        documents: [...docs, { name: file.name, kind: "Resume" }],
      });
      setResumeStatus("");
      setShowStartDialog(false);
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : "Resume extraction failed.");
      setResumeStatus("");
    }
  }

  const raceOptions = [
    "White (Not Hispanic or Latino)",
    "Hispanic / Latino",
    "Black or African American",
    "Asian",
    "Native American or Alaskan Native",
    "Two or More Races",
    "Prefer not to disclose",
  ];
  const genderOptions = ["Female", "Male", "Non-binary", "Transgender", "Other", "Prefer not to say"];
  const citizenshipOptions = [
    "A-U.S. Citizen, U.S. National, Permanent Resident (Green Card Holder), Refugee, or Asylee",
    "B-International Student or Other Visa Status (F-1, J-1, H-4, TN, DACA, TPS, etc.)",
  ];
  const uploadedDocsList = docs.length > 0 && (
    <div className="mt-4 divide-y divide-border">
      {docs.map((d) => (
        <div key={d.name} className="py-3 flex items-center gap-4">
          <div className="size-10 rounded-lg bg-success/15 text-success grid place-items-center text-xs font-mono">✓</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{d.name}</div>
            <div className="text-xs text-muted-foreground">{d.kind}</div>
          </div>
          <button
            onClick={() => removeDoc(d.name)}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
  const uploadMaterialsCard = (
    <Card>
      <SectionLabel>Upload Materials (Optional)</SectionLabel>
      <p className="text-xs text-muted-foreground mt-1">
        Add supporting documents you may reuse across applications.
      </p>
      {uploadedDocsList}
      <div className="mt-5 grid sm:grid-cols-3 gap-3">
        {["Transcript", "Letter of Recommendation", "Other documents"].map((k) => (
          <label key={k} className="rounded-xl border-2 border-dashed border-border p-4 text-sm cursor-pointer hover:bg-accent">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Upload</div>
            <div className="font-medium mt-1">{k}</div>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) addDoc(k, f);
              }}
              className="mt-2 text-xs"
            />
          </label>
        ))}
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      <Dialog open={showStartDialog} onOpenChange={setShowStartDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Start your profile</DialogTitle>
            <DialogDescription>
              Use your resume to fill in many of the fields for creating students profile
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 pt-2">
            <button
              type="button"
              onClick={() => startResumeInputRef.current?.click()}
              disabled={!!resumeStatus}
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-primary px-4 py-3 text-left text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <FileUp className="size-5 shrink-0" />
              <span>Autofill with Resume</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setProfileStartMode("manual");
                setResumeError("");
                setShowStartDialog(false);
              }}
              disabled={!!resumeStatus}
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left text-sm font-medium hover:bg-accent"
            >
              <PencilLine className="size-5 shrink-0" />
              <span>Apply Manually</span>
            </button>
          </div>

          {(resumeStatus || resumeError) && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                resumeError
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-success/30 bg-success/10 text-success"
              }`}
            >
              {resumeError || resumeStatus}
            </div>
          )}

          <input
            ref={startResumeInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleResumeUpload(f);
              e.currentTarget.value = "";
            }}
          />
        </DialogContent>
      </Dialog>

      <Card>
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-2xl bg-primary text-primary-foreground grid place-items-center font-display text-xl">
            {toInitials(user?.name)}
          </div>
          <div>
            <div className="font-display text-xl">{user?.name}</div>
            <div className="text-sm text-muted-foreground">{user?.email}</div>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          {profileStartMode === "resume"
            ? "Review and edit the fields filled from your resume."
            : "Fill out the fields below to build your student profile."}
        </p>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <Input label="Full name" value={user?.name ?? ""} onChange={(v) => set("name", v)} placeholder="Maya Rodriguez" />
          <Input label="Email" value={user?.email ?? ""} onChange={(v) => set("email", v)} placeholder="you@school.edu" type="email" />
        </div>
      </Card>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          {error}
        </div>
      )}

      <Card>
        <SectionLabel>About you *</SectionLabel>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <Select
            label="Gender"
            value={user?.gender ?? ""}
            onChange={(v) => set("gender", v)}
            options={genderOptions}
          />
          <Input label="Location" value={user?.location ?? ""} onChange={(v) => set("location", v)} placeholder="City, State" />
          <Select
            label="Citizenship / Residency Status"
            value={user?.citizenshipStatus ?? ""}
            onChange={(v) => set("citizenshipStatus", v)}
            options={citizenshipOptions}
          />
          <Select
            label="Please select your Race / Ethnicity"
            value={user?.raceEthnicity ?? ""}
            onChange={(v) => set("raceEthnicity", v)}
            options={raceOptions}
            className="sm:col-span-2"
          />
        </div>

        <div className="mt-5 grid sm:grid-cols-2 gap-3">
          <GlossaryCheck label="First-generation college student" checked={!!user?.firstGen} onChange={(v) => set("firstGen", v)} />
          <GlossaryCheck label="Pell Grant eligible" checked={!!user?.pellEligible} onChange={(v) => set("pellEligible", v)} />
        </div>

        <button
          onClick={() => setShowExtended((s) => !s)}
          className="mt-5 text-xs underline text-muted-foreground hover:text-foreground"
        >
          {showExtended ? "− Hide" : "+ Add more personalized context"}
        </button>

        {showExtended && (
          <div className="mt-4 space-y-5">
            {EXTENDED_CONTEXT_GROUPS.map((grp) => (
              <div key={grp.group}>
                <div className="text-[11px] uppercase tracking-widest text-gold">{grp.group}</div>
                <div className="mt-2 grid sm:grid-cols-2 gap-2">
                  {grp.options.map((opt) => (
                    <GlossaryCheck
                      key={opt}
                      label={opt}
                      checked={!!user?.extendedContext?.[opt]}
                      onChange={(v) => setExt(opt, v)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <EducationHistorySection
        entries={educationHistory}
        onAdd={addEducationEntry}
        onRemove={removeEducationEntry}
        onChange={updateEducationEntry}
      />

      <ResearchExperienceSection
        entries={researchExperience}
        isOpen={researchOpen}
        onToggle={() => setResearchOpen((open) => !open)}
        onAdd={addResearchEntry}
        onRemove={removeResearchEntry}
        onChange={updateResearchEntry}
      />

      <WorkExperienceSection
        entries={workExperience}
        onAdd={addWorkEntry}
        onRemove={removeWorkEntry}
        onChange={updateWorkEntry}
      />

      <Card>
        <SectionLabel>Optional context</SectionLabel>
        <p className="text-xs text-muted-foreground mt-1">
          All optional — add whatever helps scholarships see who you are.
        </p>
        <div className="mt-4 space-y-3">
          <Textarea label="Society / club involvement" value={user?.optional?.societyInvolvement ?? ""} onChange={(v) => setOptional({ societyInvolvement: v })} placeholder="Clubs, organizations, roles…" />
          <Textarea label="Leadership experience" value={user?.optional?.leadership ?? ""} onChange={(v) => setOptional({ leadership: v })} placeholder="Captain, president, lead organizer, founder…" />
          <Textarea label="Sports" value={user?.optional?.sports ?? ""} onChange={(v) => setOptional({ sports: v })} placeholder="Teams, varsity/club, captaincy…" />
          <Textarea label="Articles published" value={user?.optional?.articlesPublished ?? ""} onChange={(v) => setOptional({ articlesPublished: v })} placeholder="Titles, outlets, links…" />
          <Textarea label="Projects" value={user?.optional?.projects ?? ""} onChange={(v) => setOptional({ projects: v })} placeholder="Personal, school, or research projects…" />
        </div>
      </Card>

      {uploadMaterialsCard}

      <Card>
        <SectionLabel>Story prompts (optional)</SectionLabel>
        <p className="text-xs text-muted-foreground mt-1">
          Short reflections you can reuse across scholarship essays.
        </p>
        <div className="mt-4 space-y-3">
          <Textarea label="Name a time you overcame a challenge." value={user?.prompts?.challenge ?? ""} onChange={(v) => setPrompts({ challenge: v })} />
          <Textarea label="Leadership — describe a time you had to lead." value={user?.prompts?.leadership ?? ""} onChange={(v) => setPrompts({ leadership: v })} />
          <Textarea label="Name a time you worked with a team." value={user?.prompts?.teamwork ?? ""} onChange={(v) => setPrompts({ teamwork: v })} />
        </div>
      </Card>
    </div>
  );
}

/* form atoms */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs uppercase tracking-widest text-muted-foreground">{children}</div>;
}
function Input({
  label, value, onChange, placeholder, className = "", type = "text",
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string; type?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}
function Textarea({
  label, value, onChange, placeholder, rows = 3, className = "",
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed"
      />
    </label>
  );
}
function Select({
  label, value, onChange, options, className = "",
}: { label: string; value: string; onChange: (v: string) => void; options: string[]; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      >
        <option value="">Select…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
function FileField({ label, fileName, onFile }: { label: string; fileName?: string; onFile: (name: string) => void }) {
  return (
    <div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-center gap-3 rounded-lg border-2 border-dashed border-border p-4">
        <input
          type="file"
          accept=".pdf,.doc,.docx"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f.name);
          }}
          className="text-sm"
        />
        {fileName && <span className="text-xs text-success">✓ {fileName}</span>}
      </div>
    </div>
  );
}
function CheckGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  function toggle(o: string) {
    onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  }
  return (
    <div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => toggle(o)}
              className={`rounded-full px-3 py-1.5 text-xs border transition-colors ${
                on ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-accent"
              }`}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function buildEducationHistoryFromProfile(user: UserProfile | null): EducationHistoryEntry[] {
  if (!user) return [];
  const entries: EducationHistoryEntry[] = [];
  if (user.highSchool && Object.keys(compactObject(user.highSchool)).length) {
    entries.push({
      id: "edu-high-school",
      educationLevel: "High school",
      institution: "",
      degreeProgram: "High school diploma",
      majorField: user.highSchool.intendedMajor ?? "",
      department: "",
      gpa: user.highSchool.gpa ?? "",
      startDate: user.highSchool.intendedStartYear ?? "",
      endDate: [user.highSchool.gradMonth, user.highSchool.gradYear].filter(Boolean).join(" "),
    });
  }
  if (user.undergrad && Object.keys(compactObject(user.undergrad)).length) {
    entries.push({
      id: "edu-undergrad",
      educationLevel: "Undergraduate",
      institution: user.undergrad.institution ?? "",
      degreeProgram: user.undergrad.collegeType ?? "",
      majorField: [user.undergrad.major, user.undergrad.minor && `Minor: ${user.undergrad.minor}`].filter(Boolean).join("; "),
      department: "",
      gpa: user.undergrad.gpa ?? "",
      startDate: "",
      endDate: user.undergrad.currentYear ?? "",
    });
  }
  if (user.graduate && Object.keys(compactObject(user.graduate)).length) {
    entries.push({
      id: "edu-graduate",
      educationLevel: user.graduate.graduateLevel || (user.educationLevel === "phd" ? "PhD" : "Graduate"),
      institution: user.graduate.institution ?? "",
      degreeProgram: user.graduate.program ?? user.graduate.graduateLevel ?? "",
      majorField: user.graduate.researchArea ?? "",
      department: user.graduate.department ?? "",
      gpa: "",
      startDate: "",
      endDate: "",
    });
  }
  return entries;
}

function buildResearchExperienceFromProfile(user: UserProfile | null): ResearchExperienceEntry[] {
  const graduate = user?.graduate;
  if (!graduate || !Object.keys(compactObject(graduate)).length) return [];
  return [
    {
      id: "research-graduate",
      researchAreas: graduate.researchArea ?? "",
      researchProjects: "",
      publications: graduate.researchOutput ?? "",
      conferences: graduate.travelNeeds ?? "",
      thesisStatus: "",
      assistantshipStatus: graduate.assistantshipStatus ?? "",
      advisorLabDepartment: [graduate.department, graduate.program].filter(Boolean).join(" · "),
    },
  ];
}

function educationLevelCode(value?: string): EducationLevel | undefined {
  const text = value?.toLowerCase() ?? "";
  if (!text) return undefined;
  if (text.includes("phd") || text.includes("doctor")) return "phd";
  if (text.includes("grad") || text.includes("master") || text.includes("mba") || text.includes("jd") || text.includes("md")) return "grad";
  if (text.includes("under") || text.includes("bachelor") || text.includes("college")) return "undergrad";
  if (text.includes("high")) return "high_school";
  return undefined;
}

function EducationHistorySection({
  entries,
  onAdd,
  onRemove,
  onChange,
}: {
  entries: EducationHistoryEntry[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<EducationHistoryEntry>) => void;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionLabel>Education History *</SectionLabel>
          <p className="text-xs text-muted-foreground mt-1">
            Review every school or program parsed from your resume in one place.
          </p>
        </div>
        <button type="button" onClick={onAdd} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">
          + Add education
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {entries.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            No education entries yet. Add an education entry or upload a resume to autofill this section.
          </div>
        )}
        {entries.map((entry, index) => (
          <div key={entry.id} className="rounded-xl border border-border bg-secondary/25 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Education {index + 1}</div>
              <button type="button" onClick={() => onRemove(entry.id)} className="text-xs text-muted-foreground hover:text-destructive">
                Remove
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Education level"
                value={entry.educationLevel ?? ""}
                onChange={(value) => onChange(entry.id, { educationLevel: value })}
                options={["High school", "Undergraduate", "Master's", "PhD", "Graduate", "Professional degree", "Other"]}
              />
              <Input label="Institution" value={entry.institution ?? ""} onChange={(value) => onChange(entry.id, { institution: value })} />
              <Input label="Degree / program" value={entry.degreeProgram ?? ""} onChange={(value) => onChange(entry.id, { degreeProgram: value })} />
              <Input label="Major / field" value={entry.majorField ?? ""} onChange={(value) => onChange(entry.id, { majorField: value })} />
              <Input label="Department" value={entry.department ?? ""} onChange={(value) => onChange(entry.id, { department: value })} />
              <Input label="GPA" value={entry.gpa ?? ""} onChange={(value) => onChange(entry.id, { gpa: value })} placeholder="3.85" />
              <Input label="Start date" value={entry.startDate ?? ""} onChange={(value) => onChange(entry.id, { startDate: value })} placeholder="August 2022" />
              <Input label="End date / expected graduation" value={entry.endDate ?? ""} onChange={(value) => onChange(entry.id, { endDate: value })} placeholder="May 2026" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ResearchExperienceSection({
  entries,
  isOpen,
  onToggle,
  onAdd,
  onRemove,
  onChange,
}: {
  entries: ResearchExperienceEntry[];
  isOpen: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<ResearchExperienceEntry>) => void;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button type="button" onClick={onToggle} className="text-left">
          <SectionLabel>Academic / Research Experience</SectionLabel>
          <p className="text-xs text-muted-foreground mt-1">
            Graduate, PhD, research, assistantship, publication, and presentation evidence.
          </p>
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={onToggle} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">
            {isOpen ? "Collapse" : "Expand"}
          </button>
          <button type="button" onClick={onAdd} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">
            + Add research
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="mt-4 space-y-4">
          {entries.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              Optional for high school and undergraduate profiles. Add research details if they strengthen your scholarship fit.
            </div>
          )}
          {entries.map((entry, index) => (
            <div key={entry.id} className="rounded-xl border border-border bg-secondary/25 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Academic / Research Entry {index + 1}</div>
                <button type="button" onClick={() => onRemove(entry.id)} className="text-xs text-muted-foreground hover:text-destructive">
                  Remove
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Textarea label="Research areas / concentration" value={entry.researchAreas ?? ""} onChange={(value) => onChange(entry.id, { researchAreas: value })} />
                <Textarea label="Research projects" value={entry.researchProjects ?? ""} onChange={(value) => onChange(entry.id, { researchProjects: value })} />
                <Textarea label="Publications" value={entry.publications ?? ""} onChange={(value) => onChange(entry.id, { publications: value })} />
                <Textarea label="Conferences / presentations / posters" value={entry.conferences ?? ""} onChange={(value) => onChange(entry.id, { conferences: value })} />
                <Input label="Thesis / dissertation status" value={entry.thesisStatus ?? ""} onChange={(value) => onChange(entry.id, { thesisStatus: value })} />
                <Input label="Assistantship / fellowship status" value={entry.assistantshipStatus ?? ""} onChange={(value) => onChange(entry.id, { assistantshipStatus: value })} />
                <Input label="Advisor / lab / department" value={entry.advisorLabDepartment ?? ""} onChange={(value) => onChange(entry.id, { advisorLabDepartment: value })} className="sm:col-span-2" />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function WorkExperienceSection({
  entries,
  onAdd,
  onRemove,
  onChange,
}: {
  entries: WorkExperienceEntry[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<WorkExperienceEntry>) => void;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionLabel>Work & Internship Experience</SectionLabel>
          <p className="text-xs text-muted-foreground mt-1">
            Work, internships, research assistantships, teaching assistantships, volunteer roles, and leadership experience.
          </p>
        </div>
        <button type="button" onClick={onAdd} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">
          + Add experience
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {entries.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            No experience entries yet. Add roles manually, or upload a resume to extract experience from it.
          </div>
        )}
        {entries.map((entry, index) => (
          <div key={entry.id} className="rounded-xl border border-border bg-secondary/25 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Experience {index + 1}</div>
              <button type="button" onClick={() => onRemove(entry.id)} className="text-xs text-muted-foreground hover:text-destructive">
                Remove
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Role / title" value={entry.roleTitle ?? ""} onChange={(value) => onChange(entry.id, { roleTitle: value })} />
              <Input label="Organization / company" value={entry.organization ?? ""} onChange={(value) => onChange(entry.id, { organization: value })} />
              <Select
                label="Experience type"
                value={entry.experienceType ?? ""}
                onChange={(value) => onChange(entry.id, { experienceType: value })}
                options={["Work", "Internship", "Research Assistant", "Teaching Assistant", "Volunteer", "Leadership", "Other"]}
              />
              <Input label="Start date" value={entry.startDate ?? ""} onChange={(value) => onChange(entry.id, { startDate: value })} />
              <Input label="End date" value={entry.endDate ?? ""} onChange={(value) => onChange(entry.id, { endDate: value })} />
              <Input label="Skills / technologies" value={entry.skillsTechnologies ?? ""} onChange={(value) => onChange(entry.id, { skillsTechnologies: value })} />
              <Textarea label="Description / responsibilities" value={entry.description ?? ""} onChange={(value) => onChange(entry.id, { description: value })} className="sm:col-span-2" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function HighSchoolForm({ value, setBranch }: { value: Record<string, unknown>; setBranch: (b: "highSchool", p: Record<string, unknown>) => void }) {
  const v = value as Record<string, string | string[] | undefined>;
  const needsOptions = ["Finding scholarships", "Essay review", "College list", "FAFSA", "Recommendation strategy", "Deadlines"];
  return (
    <Card>
      <SectionLabel>High school details</SectionLabel>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <Select label="Current grade" value={(v.currentGrade as string) ?? ""} onChange={(x) => setBranch("highSchool", { currentGrade: x })} options={["9th", "10th", "11th", "12th"]} />
        <Select label="Graduation month" value={(v.gradMonth as string) ?? ""} onChange={(x) => setBranch("highSchool", { gradMonth: x })} options={["January","February","March","April","May","June","July","August","September","October","November","December"]} />
        <Input label="Graduation year" value={(v.gradYear as string) ?? ""} onChange={(x) => setBranch("highSchool", { gradYear: x })} placeholder="2027" />
        <Input label="High school GPA" value={(v.gpa as string) ?? ""} onChange={(x) => setBranch("highSchool", { gpa: x })} placeholder="3.85" />
        <Select label="GPA weighting" value={(v.gpaWeighting as string) ?? ""} onChange={(x) => setBranch("highSchool", { gpaWeighting: x })} options={["Weighted", "Unweighted"]} />
        <Select label="SAT / ACT status" value={(v.testStatus as string) ?? ""} onChange={(x) => setBranch("highSchool", { testStatus: x })} options={["Taken", "Planning to take", "Test-optional"]} />
        <Input label="Intended college start year (optional)" value={(v.intendedStartYear as string) ?? ""} onChange={(x) => setBranch("highSchool", { intendedStartYear: x })} placeholder="2027" />
        <Input label="Intended college major (optional)" value={(v.intendedMajor as string) ?? ""} onChange={(x) => setBranch("highSchool", { intendedMajor: x })} placeholder="Biology, CS, Undecided…" />
      </div>
      <div className="mt-3 space-y-3">
        <Textarea label="AP / IB / dual-credit courses" value={(v.apIb as string) ?? ""} onChange={(x) => setBranch("highSchool", { apIb: x })} />
        <Select label="Parent / guardian education level" value={(v.parentEducation as string) ?? ""} onChange={(x) => setBranch("highSchool", { parentEducation: x })} options={["Did not finish high school", "High school", "Some college", "Associate's", "Bachelor's", "Graduate degree"]} />
        <Textarea label="Extracurriculars" value={(v.extracurricular as string) ?? ""} onChange={(x) => setBranch("highSchool", { extracurricular: x })} />
        <Textarea label="Activities, work, family duties, athletics" value={(v.activities as string) ?? ""} onChange={(x) => setBranch("highSchool", { activities: x })} />
        <Textarea label="Volunteer service" value={(v.volunteer as string) ?? ""} onChange={(x) => setBranch("highSchool", { volunteer: x })} />
        <CheckGroup
          label="I need help with"
          options={needsOptions}
          value={(v.needsHelpWith as string[]) ?? []}
          onChange={(x) => setBranch("highSchool", { needsHelpWith: x })}
        />
      </div>
    </Card>
  );
}

function UndergradForm({ value, setBranch }: { value: Record<string, unknown>; setBranch: (b: "undergrad", p: Record<string, unknown>) => void }) {
  const v = value as Record<string, string | string[] | undefined>;
  const needsOptions = ["Departmental scholarships", "Transfer scholarships", "Merit aid", "Need-based aid", "Emergency grants", "Internship funding", "Study abroad funding"];
  return (
    <Card>
      <SectionLabel>Undergraduate details</SectionLabel>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <Input label="Institution name" value={(v.institution as string) ?? ""} onChange={(x) => setBranch("undergrad", { institution: x })} placeholder="e.g. Rice University" />
        <Select label="College type" value={(v.collegeType as string) ?? ""} onChange={(x) => setBranch("undergrad", { collegeType: x })} options={["2-year", "4-year", "Transfer student"]} />
        <Select label="Current year" value={(v.currentYear as string) ?? ""} onChange={(x) => setBranch("undergrad", { currentYear: x })} options={["Freshman", "Sophomore", "Junior", "Senior", "Super senior"]} />
        <Select label="Enrollment status" value={(v.enrollment as string) ?? ""} onChange={(x) => setBranch("undergrad", { enrollment: x })} options={["Full-time", "Part-time"]} />
        <Input label="Major" value={(v.major as string) ?? ""} onChange={(x) => setBranch("undergrad", { major: x })} />
        <Input label="Minor" value={(v.minor as string) ?? ""} onChange={(x) => setBranch("undergrad", { minor: x })} />
        <Input label="College GPA" value={(v.gpa as string) ?? ""} onChange={(x) => setBranch("undergrad", { gpa: x })} placeholder="3.85" />
        <Input label="Credits completed" value={(v.creditsCompleted as string) ?? ""} onChange={(x) => setBranch("undergrad", { creditsCompleted: x })} placeholder="48" />
      </div>
      <div className="mt-3 space-y-3">
        <Textarea label="Transfer history (if any)" value={(v.transferHistory as string) ?? ""} onChange={(x) => setBranch("undergrad", { transferHistory: x })} />
        <Textarea label="Internships / research / lab experience" value={(v.experience as string) ?? ""} onChange={(x) => setBranch("undergrad", { experience: x })} />
        <Textarea label="Student organizations & leadership" value={(v.orgsLeadership as string) ?? ""} onChange={(x) => setBranch("undergrad", { orgsLeadership: x })} />
        <Textarea label="Scholarship history" value={(v.scholarshipHistory as string) ?? ""} onChange={(x) => setBranch("undergrad", { scholarshipHistory: x })} />
        <CheckGroup
          label="I need help with"
          options={needsOptions}
          value={(v.needsHelpWith as string[]) ?? []}
          onChange={(x) => setBranch("undergrad", { needsHelpWith: x })}
        />
      </div>
    </Card>
  );
}

function GradForm({ value, setBranch, level }: { value: Record<string, unknown>; setBranch: (b: "graduate", p: Record<string, unknown>) => void; level: EducationLevel }) {
  const v = value as Record<string, string | string[] | undefined>;
  const needsOptions = ["Fellowships", "Assistantships", "Conference grants", "Dissertation funding", "Research grants", "Professional association awards"];
  return (
    <Card>
      <SectionLabel>{level === "phd" ? "PhD" : "Graduate"} details</SectionLabel>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <Select label="Graduate level" value={(v.graduateLevel as string) ?? (level === "phd" ? "PhD" : "")} onChange={(x) => setBranch("graduate", { graduateLevel: x })} options={["Master's", "PhD", "MBA", "JD", "MD", "Other"]} />
        <Input label="Program name" value={(v.program as string) ?? ""} onChange={(x) => setBranch("graduate", { program: x })} />
        <Input label="Institution" value={(v.institution as string) ?? ""} onChange={(x) => setBranch("graduate", { institution: x })} />
        <Input label="Department" value={(v.department as string) ?? ""} onChange={(x) => setBranch("graduate", { department: x })} />
        <Input label="Research area / concentration" value={(v.researchArea as string) ?? ""} onChange={(x) => setBranch("graduate", { researchArea: x })} className="sm:col-span-2" />
        <Select label="Assistantship / fellowship status" value={(v.assistantshipStatus as string) ?? ""} onChange={(x) => setBranch("graduate", { assistantshipStatus: x })} options={["TA", "RA", "Fellowship", "Self-funded", "Other"]} />
        <Input label="Professional licenses / exams (if relevant)" value={(v.licenses as string) ?? ""} onChange={(x) => setBranch("graduate", { licenses: x })} />
      </div>
      <div className="mt-3 space-y-3">
        <Textarea label="Research output (publications, presentations, posters, thesis/dissertation stage)" value={(v.researchOutput as string) ?? ""} onChange={(x) => setBranch("graduate", { researchOutput: x })} />
        <Textarea label="Conference travel or research expense needs" value={(v.travelNeeds as string) ?? ""} onChange={(x) => setBranch("graduate", { travelNeeds: x })} />
        <CheckGroup
          label="I need help with"
          options={needsOptions}
          value={(v.needsHelpWith as string[]) ?? []}
          onChange={(x) => setBranch("graduate", { needsHelpWith: x })}
        />
      </div>
    </Card>
  );
}

/* ---------------- Step 3: Scholarship Discovery Wiki ---------------- */

function StepDiscovery() {
  const { user, updateProfile } = useUser();
  const wiki = user?.wikiDiscovery;
  const savedSources = user?.savedWikiSources ?? [];
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [freeOnly, setFreeOnly] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [manualSource, setManualSource] = useState({ name: "", url: "", category: "", notes: "" });

  async function refreshWiki() {
    setLoading(true);
    setStatus("Building your discovery wiki...");
    try {
      const result = await discoverScholarshipWiki(buildWikiPayload(user));
      updateProfile({ wikiDiscovery: result });
      setStatus("Wiki recommendations refreshed.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Wiki discovery failed.");
    } finally {
      setLoading(false);
    }
  }

  function saveSource(source: Partial<SavedWikiSource>) {
    const name = (source.name ?? "").trim();
    if (!name) return;
    const url = (source.url ?? "").trim();
    const exists = savedSources.some((item) => item.name.toLowerCase() === name.toLowerCase() && (item.url ?? "") === url);
    if (exists) {
      setStatus("Source is already saved.");
      return;
    }
    const saved: SavedWikiSource = {
      id: crypto.randomUUID(),
      name,
      url,
      category: source.category ?? "Saved source",
      notes: source.notes ?? "",
      tags: source.tags ?? [],
      saved_at: new Date().toISOString(),
    };
    updateProfile({ savedWikiSources: [saved, ...savedSources] });
    setStatus("Source saved to your Wiki.");
  }

  function saveManualSource() {
    saveSource({
      name: manualSource.name,
      url: manualSource.url,
      category: manualSource.category || "Manual source",
      notes: manualSource.notes,
      tags: manualSource.category ? [manualSource.category] : [],
    });
    setManualSource({ name: "", url: "", category: "", notes: "" });
  }

  function copyText(value: string) {
    void navigator.clipboard?.writeText(value);
    setStatus("Copied.");
  }

  const allSourceCards = [
    ...(wiki?.top_free_platforms ?? []).map((source) => ({ ...source, section: "Top Free Platforms", cost: "Free" })),
    ...(wiki?.specific_opportunities ?? []).map((source) => ({ ...source, section: "Specific Opportunity Sources", cost: source.cost ?? "" })),
  ];
  const categories = ["All", ...Array.from(new Set(allSourceCards.map((source) => source.category).filter(Boolean)))];
  const filteredSources = allSourceCards.filter((source) => {
    if (categoryFilter !== "All" && source.category !== categoryFilter) return false;
    if (freeOnly && !String(source.cost ?? "").toLowerCase().includes("free")) return false;
    if (savedOnly && !savedSources.some((saved) => saved.name === source.name || saved.url === source.url)) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Scholarship Discovery Wiki</div>
            <h2 className="mt-2 font-display text-[42px] font-extrabold leading-[0.98] tracking-tight">
              Find the right places to search.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground/85">
              Scholar-E recommends trusted platforms, source pages, funding categories, and search queries based on your profile.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={refreshWiki} disabled={loading} className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40">
              {loading ? "Running Wiki agents..." : "Run Wiki Agents"}
            </button>
            <button onClick={() => setStatus("Go back to the profile step to update your background details.")} className="rounded-full border border-border bg-card px-4 py-2 text-sm hover:bg-accent">
              Update profile
            </button>
          </div>
        </div>
        {status && <p className="mt-3 text-xs text-muted-foreground">{status}</p>}
        {!wiki && !loading && (
          <p className="mt-3 text-xs text-muted-foreground">
            Run the Wiki agents to generate recommendations from your saved profile. This is separate from resume autofill and requirement extraction.
          </p>
        )}
      </Card>

      <Card>
        <SectionLabel>Profile used for discovery</SectionLabel>
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(wiki?.profile_summary ?? {}).map(([key, value]) => (
            <div key={key} className="rounded-xl border border-border bg-secondary/30 p-3">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">{key.replace(/_/g, " ")}</div>
              <div className="mt-1 text-sm font-medium">{Array.isArray(value) ? value.join(", ") : String(value)}</div>
            </div>
          ))}
        </div>
        {!!wiki?.missing_profile_fields?.length && (
          <p className="mt-3 text-xs text-muted-foreground">
            Add more profile details to improve recommendations: {wiki.missing_profile_fields.join(", ")}.
          </p>
        )}
      </Card>

      <Card>
        <SectionLabel>Recommended sources for you</SectionLabel>
        <div className="mt-4 grid lg:grid-cols-2 gap-4">
          {(wiki?.recommended_source_groups ?? []).map((group) => (
            <div key={group.group_name} className="rounded-2xl border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-display text-[18px] font-bold">{group.group_name}</div>
                  <p className="mt-1 text-sm text-muted-foreground/85">{group.match_reason}</p>
                </div>
                <Pill tone={group.priority === "High" ? "success" : group.priority === "Medium" ? "info" : "default"}>{group.priority}</Pill>
              </div>
              <div className="mt-3 space-y-3">
                {(group.sources ?? []).map((source) => (
                  <WikiSourceCard key={`${group.group_name}-${source.name}`} source={source} onSave={saveSource} onCopy={copyText} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <SectionLabel>Top free platforms and specific source pages</SectionLabel>
          <div className="flex flex-wrap items-center gap-2">
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="rounded-full border border-border bg-card px-3 py-1.5 text-sm">
              {categories.map((category) => <option key={category}>{category}</option>)}
            </select>
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
              Free only
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={savedOnly} onChange={(e) => setSavedOnly(e.target.checked)} />
              Saved only
            </label>
          </div>
        </div>
        <div className="mt-4 grid md:grid-cols-2 gap-3">
          {filteredSources.map((source) => (
            <WikiSourceCard key={`${source.section}-${source.name}`} source={source} onSave={saveSource} onCopy={copyText} compact />
          ))}
          {!filteredSources.length && <p className="text-sm text-muted-foreground">No sources match the selected filters.</p>}
        </div>
      </Card>

      <Card>
        <SectionLabel>Funding categories</SectionLabel>
        <div className="mt-4 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(wiki?.funding_categories ?? []).map((category) => (
            <div key={category.category_name} className="rounded-xl border border-border p-4">
              <div className="font-display text-[18px] font-bold">{category.category_name}</div>
              <p className="mt-2 text-sm text-muted-foreground/85">{category.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(category.best_for ?? []).map((item) => <Pill key={item}>{item}</Pill>)}
              </div>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {(category.suggested_queries ?? []).map((query) => <li key={query}>Search: {query}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>Personalized search queries</SectionLabel>
            <button onClick={() => copyText((wiki?.personalized_search_queries ?? []).join("\n"))} className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-accent">
              Copy all
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {(wiki?.personalized_search_queries ?? []).map((query) => (
              <div key={query} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <span className="text-sm">{query}</span>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => copyText(query)} className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-accent">Copy</button>
                  <button onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, "_blank")} className="rounded-full bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:opacity-90">Search</button>
                </div>
              </div>
            ))}
          </div>
        </Card>

      <Card>
        <SectionLabel>Saved sources</SectionLabel>
          <div className="mt-4 grid gap-2">
            {savedSources.map((source) => (
              <div key={source.id} className="rounded-xl border border-border p-3">
                <div className="font-medium">{source.name}</div>
                <div className="text-xs text-muted-foreground">{source.category}</div>
                {source.url && <div className="mt-1 text-xs font-mono text-info">{source.url}</div>}
              </div>
            ))}
            {!savedSources.length && <p className="text-sm text-muted-foreground">Save platforms or source pages here while researching.</p>}
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <div className="text-sm font-medium">Add source manually</div>
            <div className="mt-3 grid gap-2">
              <Input label="Source name" value={manualSource.name} onChange={(name) => setManualSource((s) => ({ ...s, name }))} />
              <Input label="URL" value={manualSource.url} onChange={(url) => setManualSource((s) => ({ ...s, url }))} />
              <Input label="Category" value={manualSource.category} onChange={(category) => setManualSource((s) => ({ ...s, category }))} />
              <Textarea label="Notes" value={manualSource.notes} onChange={(notes) => setManualSource((s) => ({ ...s, notes }))} rows={2} />
              <button onClick={saveManualSource} className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90">Save source</button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function WikiSourceCard({
  source,
  onSave,
  onCopy,
  compact = false,
}: {
  source: {
    name?: string;
    url?: string;
    category?: string;
    cost?: string;
    best_for?: string[];
    why_recommended?: string;
    search_tips?: string[];
    suggested_queries?: string[];
    status_note?: string;
  };
  onSave: (source: Partial<SavedWikiSource>) => void;
  onCopy: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{source.name}</div>
          <div className="text-xs text-muted-foreground">{source.category} {source.cost ? `- ${source.cost}` : ""}</div>
        </div>
        <button onClick={() => onSave({ ...source, tags: source.best_for ?? [] })} className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-accent">
          Save
        </button>
      </div>
      {source.why_recommended && <p className="mt-2 text-sm text-muted-foreground/85">{source.why_recommended}</p>}
      {source.status_note && <p className="mt-2 text-xs text-warning">{source.status_note}</p>}
      {!!source.best_for?.length && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {source.best_for.slice(0, compact ? 3 : 5).map((item) => <Pill key={item}>{item}</Pill>)}
        </div>
      )}
      {!compact && !!source.search_tips?.length && (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {source.search_tips.map((tip) => <li key={tip}>{tip}</li>)}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {source.url && (
          <button onClick={() => window.open(source.url, "_blank")} className="rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90">
            Open source
          </button>
        )}
        {!!source.suggested_queries?.[0] && (
          <button onClick={() => onCopy(source.suggested_queries?.[0] ?? "")} className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-accent">
            Copy query
          </button>
        )}
      </div>
    </div>
  );
}

function buildOpportunityBuckets(user: UserProfile | null) {
  const text = JSON.stringify(user ?? {}).toLowerCase();
  const buckets = [
    {
      id: "institutional",
      name: "Institutional scholarships",
      sponsor: "Your school or target institution",
      matchScore: user?.educationLevel ? 82 : 60,
      tags: ["School portal", "Departmental", "Merit/need"],
      blurb: "Start with your current school, target college, department, or graduate program scholarship portal.",
      source: "Institutional scholarship office",
    },
    {
      id: "local",
      name: "Local and community scholarships",
      sponsor: "Community foundations, civic groups, local employers",
      matchScore: user?.location ? 84 : 58,
      tags: ["Local", "Community", user?.location ?? "Location"],
      blurb: "Use your location to search city, county, chamber of commerce, employer, bank, and foundation awards.",
      source: user?.location ? `${user.location} scholarship search` : "Local scholarship search",
    },
  ];
  if (text.includes("stem") || text.includes("engineering") || text.includes("computer") || text.includes("science")) {
    buckets.push({
      id: "stem",
      name: "STEM and professional society scholarships",
      sponsor: "Professional associations",
      matchScore: 88,
      tags: ["STEM", "Major-based", "Professional societies"],
      blurb: "Search awards from engineering, computing, science, healthcare, or discipline-specific societies.",
      source: "Professional society scholarship pages",
    });
  }
  if (user?.firstGen || user?.pellEligible) {
    buckets.push({
      id: "need-first-gen",
      name: "First-generation and need-aware scholarships",
      sponsor: "Foundations and access organizations",
      matchScore: 86,
      tags: ["First-gen", "Need-aware", "Access"],
      blurb: "Look for awards connected to first-generation status, Pell eligibility, FAFSA, or college access.",
      source: "First-gen and financial need directories",
    });
  }
  if (text.includes("research") || text.includes("graduate") || text.includes("phd")) {
    buckets.push({
      id: "research",
      name: "Research, fellowship, and travel awards",
      sponsor: "Fellowship programs and academic societies",
      matchScore: 85,
      tags: ["Research", "Fellowship", "Travel"],
      blurb: "Search for fellowships, conference travel, dissertation funding, lab/program awards, and research grants.",
      source: "ProFellow and academic society databases",
    });
  }
  return buckets.sort((a, b) => b.matchScore - a.matchScore);
}

function StepOpportunities({ onAnalyze }: { onAnalyze: () => void }) {
  const { user, updateProfile } = useUser();
  const buckets = buildOpportunityBuckets(user);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2">
            Based on your profile keywords:
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="gold">Rule-based suggestions</Pill>
            {user?.educationLevel && <Pill>{eduLevelLabel(user.educationLevel)}</Pill>}
            {user?.firstGen && <Pill>First-gen</Pill>}
            {user?.location && <Pill>{user.location}</Pill>}
            {user?.pellEligible && <Pill>Financial need</Pill>}
          </div>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {buckets.map((s) => (
          <Card key={s.id} className="!p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-display text-lg leading-tight">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.sponsor}</div>
              </div>
              <MatchRing score={s.matchScore} />
            </div>
            <p className="text-sm text-muted-foreground mt-3">{s.blurb}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {s.tags.map((t) => <Pill key={t}>{t}</Pill>)}
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <div>
                <div className="font-display text-lg text-foreground">{s.source}</div>
                <div className="text-xs text-muted-foreground">Use this bucket to find a real scholarship, then paste it in the next step.</div>
              </div>
              <button
                onClick={() => {
                  updateProfile({
                    activeScholarship: {
                      ...user?.activeScholarship,
                      type: s.id === "research" ? "Research & Fellowship" : "Merit-based",
                    },
                  });
                  onAnalyze();
                }}
                className="rounded-full px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:opacity-90"
              >
                Paste real opportunity →
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function MatchRing({ score }: { score: number }) {
  const circ = 2 * Math.PI * 18;
  const dash = (score / 100) * circ;
  const color = score >= 80 ? "var(--success)" : score >= 50 ? "var(--warning)" : "var(--destructive)";
  return (
    <div className="relative size-12">
      <svg viewBox="0 0 44 44" className="size-12 -rotate-90">
        <circle cx="22" cy="22" r="18" stroke="var(--border)" strokeWidth="4" fill="none" />
        <circle
          cx="22" cy="22" r="18"
          stroke={color}
          strokeWidth="4" fill="none" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-xs font-mono">{score}</div>
    </div>
  );
}

function ScholarshipDetailsCard({
  scholarship,
  updateScholarship,
  onExtract,
  extracting,
  extractionStatus,
  extractionError,
}: {
  scholarship: ActiveScholarship;
  updateScholarship: (patch: ActiveScholarship) => void;
  onExtract: () => void;
  extracting: boolean;
  extractionStatus: string | null;
  extractionError: string | null;
}) {
  return (
    <Card>
      <SectionLabel>Scholarship details for extraction</SectionLabel>
      <p className="mt-1 text-xs text-muted-foreground">
        After using the Wiki to find a real opportunity, paste its name, link, or copied description here. Scholar-E will extract requirements into editable fields.
      </p>
      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        <Input
          label="Scholarship name"
          value={scholarship.name ?? ""}
          onChange={(name) => updateScholarship({ name })}
          placeholder="Coca-Cola Scholars Program, Gates Scholarship..."
          className="sm:col-span-2"
        />
        <Input
          label="Scholarship link or source"
          value={scholarship.url ?? ""}
          onChange={(url) => updateScholarship({ url })}
          placeholder="https://... or source name"
          className="sm:col-span-2"
        />
      </div>
      <Textarea
        label="Additional notes"
        value={scholarship.additionalNotes ?? ""}
        onChange={(additionalNotes) => updateScholarship({ additionalNotes })}
        placeholder="Optional notes about selection criteria, recommender deadlines, submission portal details, or anything else."
        rows={3}
      />
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onExtract}
          disabled={extracting}
          className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {extracting ? "Extracting requirements..." : "Extract Scholarship Information"}
        </button>
      </div>
      {extractionStatus && <p className="mt-3 text-xs text-muted-foreground text-right">{extractionStatus}</p>}
      {extractionError && <p className="mt-3 text-xs text-destructive text-right">{extractionError}</p>}
    </Card>
  );
}

function EditableScholarshipFields({
  scholarship,
  updateScholarship,
}: {
  scholarship: ActiveScholarship;
  updateScholarship: (patch: ActiveScholarship) => void;
}) {
  const docsValue = (scholarship.requiredDocumentTypes ?? []).join(", ");
  const hasExtractedDetails = !!scholarship.extractionCompletedAt;
  const listValue = (items?: string[]) => (items ?? []).join("\n");
  const parseList = (value: string) =>
    value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);

  if (!hasExtractedDetails) return null;

  return (
    <Card>
      <SectionLabel>Extracted requirements</SectionLabel>
      <p className="mt-1 text-xs text-muted-foreground">
        Review and edit anything the extractor found before analyzing fit.
      </p>

      <div className="mt-4">
        <Textarea
          label="Complete extraction output"
          value={scholarship.requirementsPreview ?? ""}
          onChange={(requirementsPreview) => updateScholarship({ requirementsPreview })}
          rows={14}
        />
      </div>

      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        <Input label="Scholarship name" value={scholarship.name ?? ""} onChange={(name) => updateScholarship({ name })} />
        <Input label="Sponsoring organization" value={scholarship.organization ?? ""} onChange={(organization) => updateScholarship({ organization })} />
        <Input label="Scholarship type" value={scholarship.type ?? ""} onChange={(type) => updateScholarship({ type })} />
        <Input label="Country / region" value={scholarship.country ?? ""} onChange={(country) => updateScholarship({ country })} />
        <Input label="Official website" value={scholarship.officialWebsite ?? scholarship.url ?? ""} onChange={(officialWebsite) => updateScholarship({ officialWebsite, url: officialWebsite })} />
        <Input label="Award amount" value={scholarship.awardAmount ?? ""} onChange={(awardAmount) => updateScholarship({ awardAmount })} />
        <Input label="Application opens" value={scholarship.applicationOpens ?? ""} onChange={(applicationOpens) => updateScholarship({ applicationOpens })} />
        <Input label="Application deadline" value={scholarship.applicationDeadline ?? ""} onChange={(applicationDeadline) => updateScholarship({ applicationDeadline })} />
        <Input label="Notification date" value={scholarship.notificationDate ?? ""} onChange={(notificationDate) => updateScholarship({ notificationDate })} />
        <Input label="Program start" value={scholarship.programStart ?? ""} onChange={(programStart) => updateScholarship({ programStart })} />
        <Input label="Program end" value={scholarship.programEnd ?? ""} onChange={(programEnd) => updateScholarship({ programEnd })} />
        <Input label="Current status" value={scholarship.currentStatus ?? ""} onChange={(currentStatus) => updateScholarship({ currentStatus })} />
      </div>

      <div className="mt-3 space-y-3">
        <Textarea label="Scholarship description" value={scholarship.description ?? ""} onChange={(description) => updateScholarship({ description })} rows={3} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="Minimum GPA" value={scholarship.minimumGpa ?? ""} onChange={(minimumGpa) => updateScholarship({ minimumGpa })} />
          <Input label="Enrollment level" value={scholarship.enrollmentLevel ?? ""} onChange={(enrollmentLevel) => updateScholarship({ enrollmentLevel })} />
          <Input label="Citizenship / residency requirement" value={scholarship.citizenshipRequirement ?? ""} onChange={(citizenshipRequirement) => updateScholarship({ citizenshipRequirement })} />
          <Input label="Financial need requirement" value={scholarship.financialNeedRequirement ?? ""} onChange={(financialNeedRequirement) => updateScholarship({ financialNeedRequirement })} />
          <Input label="Location / residency requirement" value={scholarship.locationRequirement ?? ""} onChange={(locationRequirement) => updateScholarship({ locationRequirement })} />
          <Input label="Eligible majors / fields" value={scholarship.eligibleMajors ?? ""} onChange={(eligibleMajors) => updateScholarship({ eligibleMajors })} />
        </div>
        <Textarea label="Other eligibility rules" value={scholarship.otherEligibilityRules ?? ""} onChange={(otherEligibilityRules) => updateScholarship({ otherEligibilityRules })} rows={4} />
        <Input
          label="Required document types"
          value={docsValue}
          onChange={(value) =>
            updateScholarship({
              requiredDocumentTypes: value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
          placeholder="Essay, transcript, recommendation letter..."
        />
        <Textarea label="Other required materials" value={scholarship.otherRequiredMaterials ?? ""} onChange={(otherRequiredMaterials) => updateScholarship({ otherRequiredMaterials })} rows={3} />
        <Textarea label="Essay prompts" value={scholarship.essayPrompts ?? ""} onChange={(essayPrompts) => updateScholarship({ essayPrompts })} rows={5} />
        <Textarea
          label="Eligibility requirements"
          value={listValue(scholarship.eligibilityRequirements)}
          onChange={(value) => updateScholarship({ eligibilityRequirements: parseList(value) })}
          rows={6}
        />
        <Textarea
          label="Required application materials"
          value={listValue(scholarship.requiredApplicationMaterials)}
          onChange={(value) => updateScholarship({ requiredApplicationMaterials: parseList(value) })}
          rows={5}
        />
        <Textarea
          label="Benefits"
          value={listValue(scholarship.benefits)}
          onChange={(value) => updateScholarship({ benefits: parseList(value) })}
          rows={5}
        />
        <Textarea
          label="Selection criteria"
          value={listValue(scholarship.selectionCriteria)}
          onChange={(value) => updateScholarship({ selectionCriteria: parseList(value) })}
          rows={5}
        />
        <Textarea
          label="Application process"
          value={listValue(scholarship.applicationProcess)}
          onChange={(value) => updateScholarship({ applicationProcess: parseList(value) })}
          rows={5}
        />
        <Textarea
          label="Important notes"
          value={listValue(scholarship.importantNotes)}
          onChange={(value) => updateScholarship({ importantNotes: parseList(value) })}
          rows={4}
        />
        {!!scholarship.missingInformation?.length && (
          <Textarea
            label="Missing information"
            value={listValue(scholarship.missingInformation)}
            onChange={(value) => updateScholarship({ missingInformation: parseList(value) })}
            rows={4}
          />
        )}
      </div>
    </Card>
  );
}

/* ---------------- Step 4: Requirements + Fit combined ---------------- */

function StepRequirementsAndFit() {
  const { user, updateProfile } = useUser();
  const scholarship = user?.activeScholarship ?? {};
  const [fitStatus, setFitStatus] = useState<string | null>(null);
  const [fitAnalyzing, setFitAnalyzing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractionStatus, setExtractionStatus] = useState<string | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [rubricOpen, setRubricOpen] = useState(false);
  function updateScholarship(patch: ActiveScholarship) {
    updateProfile({ activeScholarship: { ...scholarship, ...patch } });
  }
  async function runScholarshipExtraction() {
    setExtracting(true);
    setExtractionStatus("Looking up scholarship details and extracting requirements...");
    setExtractionError(null);
    try {
      const extracted = await extractScholarshipOpportunity({
        scholarship_name: scholarship.name ?? "",
        scholarship_url: scholarship.url ?? "",
        additional_notes: scholarship.additionalNotes ?? "",
      });
      updateScholarship({
        ...extracted,
        additionalNotes: scholarship.additionalNotes,
        url: extracted.url || scholarship.url,
        name: extracted.name || scholarship.name,
        extractionCompletedAt: new Date().toISOString(),
      });
      setExtractionStatus("Requirements extracted. Review and edit the fields below.");
    } catch (err) {
      setExtractionError(err instanceof Error ? err.message : "Scholarship extraction failed.");
      setExtractionStatus(null);
    } finally {
      setExtracting(false);
    }
  }
  async function runFitAnalysis() {
    if (!scholarship.extractionCompletedAt) {
      setFitStatus("Extract and review scholarship requirements before analyzing fit.");
      return;
    }
    setFitAnalyzing(true);
    setFitStatus("Analyzing fit...");
    try {
      const result = await analyzeScholarshipFit(buildFitPayload(user));
      updateProfile({ fitAnalysis: result });
      setFitStatus("Fit analysis complete. Review the results below.");
    } catch (err) {
      setFitStatus(err instanceof Error ? err.message : "Scholarship fit analysis failed.");
    } finally {
      setFitAnalyzing(false);
    }
  }
  const fitAnalysis = user?.fitAnalysis;

  return (
    <div className="space-y-6">
      <ScholarshipDetailsCard
        scholarship={scholarship}
        updateScholarship={updateScholarship}
        onExtract={runScholarshipExtraction}
        extracting={extracting}
        extractionStatus={extractionStatus}
        extractionError={extractionError}
      />

      <EditableScholarshipFields scholarship={scholarship} updateScholarship={updateScholarship} />

      <div>
        <div className="space-y-6">
          <Card className="bg-secondary/40">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={runFitAnalysis}
                disabled={fitAnalyzing}
                className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                {fitAnalyzing ? "Analyzing fit..." : "Accept and Analyze Fit"}
              </button>
            </div>
            {fitStatus && <p className="mt-3 text-xs text-muted-foreground text-right">{fitStatus}</p>}
          </Card>

          {!fitAnalysis && (
            <Card>
              <div className="font-medium">No analysis yet</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Extract and review scholarship requirements, then use Accept and Analyze Fit.
                Scholar-E will compare your profile against the cleaned scholarship requirements.
              </p>
            </Card>
          )}

          {!!fitAnalysis && (
            <div className="grid md:grid-cols-3 gap-6">
              <Card className="md:col-span-1 flex flex-col items-center justify-center text-center">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Fit score</div>
                <div className="relative mt-3 size-44">
                  <svg viewBox="0 0 100 100" className="size-44 -rotate-90">
                    <circle cx="50" cy="50" r="42" stroke="var(--border)" strokeWidth="8" fill="none" />
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      stroke="var(--gold)"
                      strokeWidth="8"
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray={`${((fitAnalysis.fit_score ?? 0) / 100) * 2 * Math.PI * 42} 999`}
                    />
                  </svg>
                  <div className="absolute inset-0 grid place-items-center">
                    <div>
                      <div className="font-display text-5xl">{fitAnalysis.fit_score ?? 0}</div>
                      <div className="text-xs text-muted-foreground">/ 100</div>
                    </div>
                  </div>
                </div>
                <Pill tone={fitAnalysis.likely_eligible === "No" ? "danger" : fitAnalysis.likely_eligible === "Yes" ? "success" : "gold"}>
                  {fitAnalysis.fit_label || "Insufficient Information"}
                </Pill>
                <div className="mt-3 text-xs text-muted-foreground">
                  Likely eligible: {fitAnalysis.likely_eligible || "Unclear"}
                </div>
                <button
                  type="button"
                  onClick={() => setRubricOpen(true)}
                  className="mt-2 text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  Rubric
                </button>
                <FitRubricDialog open={rubricOpen} onOpenChange={setRubricOpen} />
              </Card>

              <Card className="md:col-span-2">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Fit summary</div>
                <p className="mt-3 text-sm leading-relaxed">{fitAnalysis.summary}</p>

                {!!fitAnalysis.eligibility_analysis?.length && (
                  <div className="mt-5">
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">Eligibility checks</div>
                    <div className="mt-3 space-y-3">
                      {fitAnalysis.eligibility_analysis.map((item, index) => (
                        <div key={`${item.requirement}-${index}`} className="rounded-lg border border-border p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium">{item.requirement}</div>
                            <Pill tone={item.status === "Met" ? "success" : item.status === "Not met" ? "danger" : "gold"}>
                              {item.status || "Unclear"}
                            </Pill>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">{item.student_evidence}</div>
                          <div className="mt-1 text-xs">{item.explanation}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>

              <Card className="md:col-span-3">
                <div className="grid md:grid-cols-2 gap-6">
                  <FitList title="Strengths" items={fitAnalysis.strengths} />
                  <FitList title="Gaps or risks" items={fitAnalysis.gaps_or_risks} />
                  <FitList title="Missing student information" items={fitAnalysis.missing_student_information} />
                  <FitList title="Recommended next steps" items={fitAnalysis.recommended_next_steps} />
                </div>
              </Card>

              {!!fitAnalysis.application_materials_check?.length && (
                <Card className="md:col-span-3">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Application materials</div>
                  <div className="mt-3 grid md:grid-cols-2 gap-3">
                    {fitAnalysis.application_materials_check.map((item, index) => (
                      <div key={`${item.material}-${index}`} className="rounded-lg border border-border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium">{item.material}</div>
                          <Pill tone={item.status === "Ready" ? "success" : item.status === "Missing" ? "danger" : "gold"}>
                            {item.status || "Need to confirm"}
                          </Pill>
                        </div>
                        {item.notes && <div className="mt-2 text-xs text-muted-foreground">{item.notes}</div>}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {!!fitAnalysis.selection_criteria_alignment?.length && (
                <Card className="md:col-span-3">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Selection criteria alignment</div>
                  <div className="mt-3 grid md:grid-cols-2 gap-3">
                    {fitAnalysis.selection_criteria_alignment.map((item, index) => (
                      <div key={`${item.criterion}-${index}`} className="rounded-lg border border-border p-3 text-sm">
                        <div className="font-medium">{item.criterion}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{item.alignment}: {item.student_evidence}</div>
                        {item.notes && <div className="mt-1 text-xs">{item.notes}</div>}
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FitRubricDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const scoreBands = [
    {
      range: "90-100",
      label: "Strong Fit",
      description: "Mandatory eligibility appears met, profile evidence strongly matches the scholarship purpose, and required materials look ready or easy to confirm.",
    },
    {
      range: "75-89",
      label: "Good Fit",
      description: "Eligibility mostly appears met with strong alignment, but one or two details may need confirmation or stronger evidence.",
    },
    {
      range: "55-74",
      label: "Possible Fit",
      description: "Some requirements or selection criteria match, but missing profile information or unclear scholarship language keeps confidence moderate.",
    },
    {
      range: "40-54",
      label: "Weak Fit",
      description: "The student may be eligible, but there are meaningful gaps, weak alignment, missing documents, or important unclear requirements.",
    },
    {
      range: "0-39",
      label: "Not Eligible / Insufficient Information",
      description: "A mandatory requirement is clearly not met, or too much information is missing to responsibly score the opportunity higher.",
    },
  ];
  const factors = [
    "Mandatory eligibility requirements: enrollment level, citizenship/residency, GPA, location, major/field, identity-based requirements, or other required criteria.",
    "Student evidence: the score uses only information already in the profile, uploaded/identified documents, essay availability, and reviewed scholarship requirements.",
    "Missing information: if the profile does not provide enough evidence, the agent marks items as unclear instead of guessing.",
    "Application materials: required documents are checked as ready, missing, need to prepare, need to confirm, or not applicable.",
    "Selection criteria alignment: leadership, service, academic fit, community involvement, goals, or other stated selection priorities are scored separately from basic eligibility.",
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden p-0">
        <div className="border-b border-border px-6 py-5">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Fit Score Rubric</DialogTitle>
          <DialogDescription>
            Scholar-E compares the cleaned scholarship requirements against the student profile. The agent separates eligibility from competitiveness and does not invent missing facts.
          </DialogDescription>
        </DialogHeader>
        </div>

        <div className="max-h-[calc(90vh-150px)] space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Score bands</div>
            <div className="mt-3 space-y-2">
              {scoreBands.map((band) => (
                <div key={band.range} className="rounded-xl border border-border bg-secondary/30 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{band.label}</div>
                    <span className="font-mono text-xs text-muted-foreground">{band.range}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{band.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">What the agent checks</div>
            <ul className="mt-3 space-y-2 text-sm text-foreground/85">
              {factors.map((factor) => (
                <li key={factor} className="flex gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold" />
                  <span>{factor}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-foreground/85">
            If a mandatory requirement is clearly not met, the score is kept below 40. If eligibility is unclear because information is missing, the score stays conservative until the student adds more details.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Step 5: Essay Workspace ---------------- */

type WorkspaceTab = "outline" | "evaluation" | "highlights";

function StepEssayWorkspace() {
  const { user, updateProfile } = useUser();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const editorSelectionRef = useRef<Range | null>(null);
  const draft = user?.essayDraft ?? "";
  const essayTitle = user?.essayTitle ?? "";
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).filter(Boolean).length : 0;
  const characterCount = draft.length;
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("outline");
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.innerText !== draft) editor.innerText = draft;
  }, [draft]);

  function syncEditor() {
    updateProfile({ essayDraft: editorRef.current?.innerText ?? "" });
  }

  function saveEditorSelection() {
    const selection = window.getSelection();
    const editor = editorRef.current;
    if (!selection?.rangeCount || !editor) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      editorSelectionRef.current = range.cloneRange();
    }
  }

  function restoreEditorSelection() {
    const range = editorSelectionRef.current;
    if (!range) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function applyEditorCommand(command: string, value?: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    restoreEditorSelection();
    const applied = document.execCommand(command, false, value);
    if (!applied && command === "formatBlock" && value?.startsWith("<")) {
      document.execCommand(command, false, value.replace(/[<>]/g, ""));
    }
    saveEditorSelection();
    syncEditor();
  }

  async function handlePdf(file: File) {
    setPdfStatus(`Extracting text from ${file.name}...`);
    try {
      const w = window as unknown as {
        pdfjsLib?: {
          GlobalWorkerOptions?: { workerSrc?: string };
          getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> };
        };
      };
      type PdfDoc = {
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{ items: { str?: string }[] }>;
        }>;
      };

      if (!w.pdfjsLib) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs";
          s.type = "module";
          s.onload = () => resolve();
          s.onerror = () => reject(new Error("Failed to load PDF parser"));
          document.head.appendChild(s);
        });
      }
      if (!w.pdfjsLib) throw new Error("PDF parser unavailable");
      if (w.pdfjsLib.GlobalWorkerOptions) {
        w.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";
      }

      const buf = await file.arrayBuffer();
      const pdf: PdfDoc = await w.pdfjsLib.getDocument({ data: buf }).promise;
      let full = "";
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        full += tc.items.map((i) => i.str ?? "").join(" ") + "\n\n";
      }
      updateProfile({ essayDraft: full.trim() });
      setPdfStatus(`Imported ${pdf.numPages} pages from ${file.name}.`);
    } catch (e) {
      setPdfStatus(`Could not parse PDF: ${(e as Error).message}`);
    }
  }

  function saveAsDraft() {
    if (wordCount < 1) return;
    const prev = user?.drafts ?? [];
    const newDraft: EssayDraft = {
      id: crypto.randomUUID(),
      version: (prev[prev.length - 1]?.version ?? 0) + 1,
      content: draft,
      wordCount,
      savedAt: new Date().toISOString(),
    };
    updateProfile({ drafts: [...prev, newDraft] });
  }

  const toolbar = [
    { label: "Bold", icon: Bold, action: () => applyEditorCommand("bold") },
    { label: "Italic", icon: Italic, action: () => applyEditorCommand("italic") },
    { label: "Underline", icon: Underline, action: () => applyEditorCommand("underline") },
    { label: "Heading 1", icon: Heading1, action: () => applyEditorCommand("formatBlock", "<h1>") },
    { label: "Heading 2", icon: Heading2, action: () => applyEditorCommand("formatBlock", "<h2>") },
    { label: "Bullet list", icon: List, action: () => applyEditorCommand("insertUnorderedList") },
    { label: "Numbered list", icon: ListOrdered, action: () => applyEditorCommand("insertOrderedList") },
    {
      label: "Link",
      icon: LinkIcon,
      action: () => {
        const url = window.prompt("Paste a link");
        if (url) applyEditorCommand("createLink", url);
      },
    },
    { label: "Undo", icon: Undo2, action: () => applyEditorCommand("undo") },
    { label: "Redo", icon: Redo2, action: () => applyEditorCommand("redo") },
  ];

  return (
    <div className="relative left-1/2 w-screen -translate-x-1/2 -mt-3 bg-background">
      <div className="min-h-[calc(100vh-9rem)] border-y border-border bg-white lg:pr-[380px]">
        <div className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-4xl flex-col px-6 pt-8 md:px-10 lg:px-14">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Essay Workspace</div>
              <input
                type="text"
                value={essayTitle}
                onChange={(e) => updateProfile({ essayTitle: e.target.value })}
                placeholder="Untitled scholarship essay"
                className="mt-1 w-full min-w-[260px] max-w-xl border-none bg-transparent p-0 font-display text-2xl text-foreground outline-none placeholder:text-foreground"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-sm hover:bg-accent">
                <FileUp className="size-4" />
                Upload PDF
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePdf(f);
                  }}
                  className="sr-only"
                />
              </label>
              <button
                type="button"
                onClick={saveAsDraft}
                disabled={!draft.trim()}
                className="rounded-full border border-border bg-card px-3 py-2 text-sm hover:bg-accent disabled:opacity-40"
              >
                Save draft
              </button>
              <CoachRunButton
                label={wordCount < 30 ? "Write more to evaluate" : "Run evaluation"}
                loadingLabel="Analyzing..."
                disabled={wordCount < 30}
                onStatus={setAnalysisStatus}
                className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
              />
            </div>
          </div>

          {(pdfStatus || analysisStatus) && (
            <div className="mt-4 space-y-1 text-xs text-muted-foreground">
              {pdfStatus && <div>{pdfStatus}</div>}
              {analysisStatus && <div>{analysisStatus}</div>}
            </div>
          )}

          <div className="relative flex-1 py-12">
            {!draft.trim() && (
              <div className="pointer-events-none absolute left-0 top-12 max-w-xl text-2xl leading-relaxed text-muted-foreground/75">
                Type or paste your essay draft here, or upload a PDF.
              </div>
            )}
            <div
              ref={editorRef}
              contentEditable
              role="textbox"
              aria-label="Essay draft editor"
              suppressContentEditableWarning
              onInput={syncEditor}
              onBlur={syncEditor}
              onKeyUp={saveEditorSelection}
              onMouseUp={saveEditorSelection}
              className="min-h-[520px] w-full whitespace-pre-wrap break-words font-display text-[18px] leading-8 text-foreground outline-none [&_h1]:mb-4 [&_h1]:mt-6 [&_h1]:text-4xl [&_h1]:font-bold [&_h1]:leading-tight [&_h2]:mb-3 [&_h2]:mt-5 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:leading-snug [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-8 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-8 [&_li]:my-1 [&_a]:text-info [&_a]:underline"
            />
          </div>

          <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white/95 px-6 py-3 backdrop-blur md:-mx-10 md:px-10 lg:-mx-14 lg:px-14">
            <div className="flex flex-wrap items-center gap-1">
              {toolbar.map((item) => {
                const Icon = item.icon;
                return (
                  <Tooltip key={item.label}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          item.action();
                        }}
                        onTouchStart={(event) => {
                          event.preventDefault();
                          item.action();
                        }}
                        className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Icon className="size-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{item.label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{wordCount} words</span>
              <span>{characterCount} characters</span>
            </div>
          </div>
        </div>
      </div>

      <EssayWorkspacePanel activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}

function EssayWorkspacePanel({
  activeTab,
  onTabChange,
}: {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
}) {
  const tabs: Array<{ id: WorkspaceTab; label: string }> = [
    { id: "outline", label: "Personalized Outline" },
    { id: "evaluation", label: "Application Evaluation" },
    { id: "highlights", label: "Review Highlights" },
  ];

  return (
    <aside className="border-l border-border bg-card lg:fixed lg:right-0 lg:top-[65px] lg:z-10 lg:h-[calc(100vh-65px)] lg:w-[380px] lg:overflow-y-auto">
      <div className="grid grid-cols-3 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`min-h-16 border-r border-border px-3 text-left text-xs font-medium leading-tight transition-colors last:border-r-0 ${
              activeTab === tab.id
                ? "bg-background text-foreground shadow-[inset_0_-3px_0_var(--primary)]"
                : "text-muted-foreground hover:bg-accent"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="p-6">
        {activeTab === "outline" && <WorkspaceList title="Personalized Outline" items={["Introduction", "Personal story", "Key strengths", "Scholarship fit", "Conclusion"]} />}
        {activeTab === "evaluation" && <WorkspaceEvaluationTab />}
        {activeTab === "highlights" && <WorkspaceHighlightsTab />}
      </div>
    </aside>
  );
}

function WorkspaceList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{title}</div>
      <div className="mt-6 space-y-3">
        {items.map((item) => (
          <div key={item} className="rounded-xl border border-border bg-background px-4 py-3 text-sm">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkspaceEvaluationTab() {
  const { user } = useUser();
  const analysis = user?.lastAnalysis;
  const scores = Object.values(analysis?.readiness_index ?? {})
    .map((entry) => entry.score)
    .filter((score): score is number => typeof score === "number");
  const overall = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Application Evaluation</div>
      <div className="mt-6 space-y-3">
        <div className="rounded-xl border border-border bg-background px-4 py-3">
          <div className="text-sm font-medium">Overall score</div>
          <div className="mt-1 font-display text-3xl text-primary">{overall ?? "--"}</div>
        </div>
        {["Requirement coverage", "Strengths", "Missing requirements", "Areas to improve"].map((item) => (
          <div key={item} className="rounded-xl border border-border bg-background px-4 py-3 text-sm">
            {item}
          </div>
        ))}
        {analysis?.coaching_brief?.coach_message && (
          <p className="pt-2 text-sm leading-relaxed text-muted-foreground">
            {analysis.coaching_brief.coach_message}
          </p>
        )}
      </div>
    </div>
  );
}

function WorkspaceHighlightsTab() {
  const { user } = useUser();
  const priorities = user?.lastAnalysis?.revision_priorities ?? [];
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Review Highlights</div>
      <div className="mt-6 space-y-3">
        {["Clarity suggestions", "Grammar suggestions", "Strong sections", "Weak sections", "Suggested revisions"].map((item) => (
          <div key={item} className="rounded-xl border border-border bg-background px-4 py-3 text-sm">
            {item}
          </div>
        ))}
        {priorities.length > 0 && (
          <div className="pt-2">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Coach priorities</div>
            <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
              {priorities.slice(0, 3).map((item, i) => (
                <li key={item} className="flex gap-2">
                  <span className="font-display text-gold">{i + 1}.</span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Step 7: Personalized Outline ---------------- */

function StepEssayOutline() {
  const { user } = useUser();
  const focus =
    user?.undergrad?.major ?? user?.highSchool?.intendedMajor ?? user?.graduate?.researchArea ?? "your field";
  const leadership = user?.prompts?.leadership || user?.optional?.societyInvolvement || "a leadership moment from your profile";
  const challenge = user?.prompts?.challenge || "a specific challenge you've overcome";

  const outline = [
    {
      h: "Hook (60–80 words)",
      d: `Open with a vivid scene from ${challenge}. Use one sensory detail (sound, smell, image) — avoid generalities.`,
    },
    {
      h: "Bridge to identity (80–100 words)",
      d: `Connect that moment to who you are and why ${focus} matters to you. One concrete fact from your profile beats three abstract claims.`,
    },
    {
      h: "Leadership / impact (120–150 words)",
      d: `Anchor on ${leadership}. Quantify: how many people, hours, dollars, or outcomes? Name one person whose story changed because of you.`,
    },
    {
      h: "Sponsor alignment (80–100 words)",
      d: `Tie your goals to the sponsor's mission. Name a specific program, value, or initiative — show you read their site.`,
    },
    {
      h: "Closer (40–60 words)",
      d: `End on a forward-looking sentence — what you'll build, contribute, or pay forward. Avoid "Thank you for your consideration."`,
    },
  ];
  return (
    <div className="space-y-6">
      <Card className="bg-secondary/40">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Essay prompt</div>
        <p className="mt-2 font-display italic text-lg">
          "{user?.activeScholarship?.essayPrompts || "Paste the scholarship prompt in the import step to tailor this outline."}"
        </p>
      </Card>

      <Card>
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-full bg-gold text-gold-foreground grid place-items-center">✎</div>
          <div>
            <div className="font-medium">Personalized outline based on your profile</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Use this as a scaffold — every sentence is still yours to write.
            </p>
          </div>
        </div>
        <ol className="mt-5 space-y-4">
          {outline.map((o, i) => (
            <li key={o.h} className="rounded-xl border border-border p-4">
              <div className="flex items-baseline justify-between">
                <div className="font-display text-lg">{i + 1}. {o.h}</div>
              </div>
              <p className="text-sm text-muted-foreground mt-1.5">{o.d}</p>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="bg-primary/5 border-primary/30">
        <div className="text-sm">
          <span className="font-medium">Ready?</span>{" "}
          <span className="text-muted-foreground">Continue to the next step to upload or paste your draft.</span>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Step 8: Essay Upload (paste OR PDF) ---------------- */

function StepEssayUpload() {
  const { user, updateProfile } = useUser();
  const draft = user?.essayDraft ?? "";
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);

  async function handlePdf(file: File) {
    setPdfStatus(`Extracting text from ${file.name}…`);
    try {
      const w = window as unknown as {
        pdfjsLib?: {
          GlobalWorkerOptions?: { workerSrc?: string };
          getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> };
        };
      };
      type PdfDoc = {
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{ items: { str?: string }[] }>;
        }>;
      };

      if (!w.pdfjsLib) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs";
          s.type = "module";
          s.onload = () => resolve();
          s.onerror = () => reject(new Error("Failed to load PDF parser"));
          document.head.appendChild(s);
        });
      }
      if (!w.pdfjsLib) throw new Error("PDF parser unavailable");
      if (w.pdfjsLib.GlobalWorkerOptions) {
        w.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";
      }

      const buf = await file.arrayBuffer();
      const pdf: PdfDoc = await w.pdfjsLib.getDocument({ data: buf }).promise;
      let full = "";
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        full += tc.items.map((i) => i.str ?? "").join(" ") + "\n\n";
      }
      updateProfile({ essayDraft: full.trim() });
      setPdfStatus(`Imported ${pdf.numPages} pages from ${file.name}.`);
    } catch (e) {
      setPdfStatus(`Could not parse PDF: ${(e as Error).message}`);
    }
  }


  function saveAsDraft() {
    const prev = user?.drafts ?? [];
    const nextVersion = (prev[prev.length - 1]?.version ?? 0) + 1;
    const newDraft: EssayDraft = {
      id: crypto.randomUUID(),
      version: nextVersion,
      content: draft,
      wordCount,
      savedAt: new Date().toISOString(),
    };
    updateProfile({ drafts: [...prev, newDraft] });
  }

  return (
    <div className="space-y-6">
      <Card className="bg-secondary/40">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Essay prompt</div>
        <p className="mt-2 font-display italic text-lg">
          "{user?.activeScholarship?.essayPrompts || "Paste the scholarship prompt in the import step."}"
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Paste your draft below — or upload a PDF and we'll pull the text out for you.
        </p>
      </Card>

      <Card>
        <SectionLabel>Upload a PDF (optional)</SectionLabel>
        <div className="mt-2 flex items-center gap-3 rounded-lg border-2 border-dashed border-border p-4">
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePdf(f);
            }}
            className="text-sm"
          />
          {pdfStatus && <span className="text-xs text-muted-foreground">{pdfStatus}</span>}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono">your-essay-draft.txt</span>
          <span>{wordCount} words · Draft v{(user?.drafts?.length ?? 0) + 1}</span>
        </div>
        <textarea
          value={draft}
          onChange={(e) => updateProfile({ essayDraft: e.target.value })}
          rows={16}
          placeholder="Paste or write your essay here…"
          className="mt-3 w-full rounded-lg border border-border bg-background p-4 font-display text-[15px] leading-relaxed"
        />
      </Card>

      <Card>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={saveAsDraft}
            disabled={wordCount < 30}
            className="rounded-full bg-card border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-40"
          >
            Save as new draft
          </button>
          <CoachRunButton
            label={
              wordCount < 30
                ? "Write at least a paragraph to send to the coach"
                : "Send to AI Coach for evaluation →"
            }
            loadingLabel="Analyzing…"
            disabled={wordCount < 30}
            onStatus={setAnalysisStatus}
            className="flex-1 rounded-full bg-primary text-primary-foreground py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
          />
        </div>
        {analysisStatus && <p className="mt-3 text-xs text-muted-foreground">{analysisStatus}</p>}
      </Card>
    </div>
  );
}

/* ---------------- Step 9: Application Evaluation (combined eval + scores) ---------------- */

const SCORE_DESCRIPTIONS: Record<string, string> = {
  Clarity: "How easily a reader can follow your argument and identify each sentence's purpose.",
  Specificity: "Concrete sensory details, names, numbers, and moments instead of vague generalities.",
  Leadership: "Evidence you initiated something, organized people, or carried responsibility — not just participated.",
  Storytelling: "Pacing, scene-building, and emotional arc — does the essay carry the reader through a change?",
  Impact: "Quantified outcomes (people helped, dollars raised, lives changed) and what the reader can verify.",
  "Scholarship alignment": "How clearly your goals and identity match the sponsor's stated mission and values.",
  Grammar: "Sentence-level correctness, punctuation, and consistent verb tense.",
  Structure: "Paragraph order, transitions, and a strong opener / closer.",
};

function StepScores() {
  const { user } = useUser();
  const analysis = user?.lastAnalysis;
  const cats = Object.entries(analysis?.readiness_index ?? {})
    .filter(([, entry]) => typeof entry?.score === "number")
    .map(([key, entry]) => ({
      name: key.replace(/_/g, " "),
      score: entry.score ?? 0,
      description: entry.coaching || entry.level || "Reviewed by the Scholar-E coach.",
    }));
  const overall = cats.length
    ? Math.round(cats.reduce((a, c) => a + c.score, 0) / cats.length)
    : 0;
  const [open, setOpen] = useState<string | null>(null);
  const stages = [
    "Analyzer + Retriever agents",
    "Strategy / discovery / narrative agents",
    "Reviewer simulation agent",
    "Combiner agent synthesis",
    "Critic agent quality check",
  ];
  const critique = analysis?.critique;

  return (
    <div className="space-y-6">
      {!analysis && (
        <Card>
          <div className="font-medium">No evaluation yet</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Run the AI coach from step 8 (Upload Essay Draft) first. Your scores will appear here.
          </p>
        </Card>
      )}

      {!!analysis && (
      <>
      <Card>
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-full bg-gold text-gold-foreground grid place-items-center font-display">AI</div>
          <div>
            <div className="font-medium">Scholar-E Coach evaluated your essay</div>
            <div className="text-xs text-muted-foreground">
              Draft {analysis.draft_number ?? 1} evaluated by the Scholar-E AI coaching agents.
            </div>
          </div>
        </div>
        <div className="mt-4 grid sm:grid-cols-5 gap-2 text-xs">
          {stages.map((s) => (
            <div key={s} className="rounded-lg bg-success/10 text-success p-2 flex items-center gap-1.5">
              <span className="font-mono">✓</span>
              <span className="truncate">{s}</span>
            </div>
          ))}
        </div>
      </Card>

      {critique && Object.keys(critique).length > 0 && (
        <Card>
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Critic agent quality check
            </div>
            <Pill tone={critique.verdict === "needs_revision" ? "warn" : "success"}>
              {critique.verdict === "needs_revision" ? "Revised by critic" : "Approved"}
            </Pill>
          </div>
          <div className="mt-3 grid sm:grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Confidence</div>
              <div className="font-display text-2xl">{critique.confidence ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Grounding</div>
              <div className="font-medium">{critique.grounding_pass === false ? "Fail" : "Pass"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Review passes</div>
              <div className="font-medium">{critique.attempt ?? 1}</div>
            </div>
          </div>
          {(critique.issues?.length ?? 0) > 0 && (
            <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground space-y-1">
              {critique.issues!.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="grid md:grid-cols-3 gap-6 items-center">
        <div className="md:col-span-1 text-center">
          <div className="font-display text-7xl text-primary">{overall}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-widest">Overall essay score</div>
          <Pill tone={overall >= 80 ? "success" : "warn"}>{overall >= 80 ? "Ready to polish" : "Promising — needs revision"}</Pill>
        </div>
        <div className="md:col-span-2 grid sm:grid-cols-2 gap-3">
          {cats.map((c) => {
            const isOpen = open === c.name;
            return (
              <button
                key={c.name}
                onClick={() => setOpen(isOpen ? null : c.name)}
                className="text-left rounded-xl border border-border hover:bg-accent transition-colors p-3"
              >
                <div className="flex items-baseline justify-between text-sm">
                  <span className="border-b border-dotted border-muted-foreground/50">{c.name}</span>
                  <span className="font-mono text-xs">{c.score}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full"
                    style={{
                      width: `${c.score}%`,
                      background: c.score >= 80 ? "var(--success)" : c.score >= 65 ? "var(--gold)" : "var(--warning)",
                    }}
                  />
                </div>
                {isOpen && (
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                    {c.description}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      {analysis.growth_report?.has_previous_draft && (
        <Card>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Growth across drafts</div>
          <p className="mt-2 text-sm">{analysis.growth_report.growth_message}</p>
          {(analysis.growth_report.improvements?.length ?? 0) > 0 && (
            <ul className="mt-3 space-y-2 text-sm">
              {analysis.growth_report.improvements!.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-success shrink-0">↑</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Top three things to fix</div>
        <ol className="mt-3 space-y-3 text-sm">
          {(analysis.revision_priorities?.length
            ? analysis.revision_priorities
            : [analysis.coaching_brief?.recommended_action, analysis.coaching_brief?.biggest_opportunity, analysis.feedback].filter(
                (item): item is string => !!item,
              )
          ).slice(0, 3).map((item, i) => (
            <li key={String(item)} className="flex gap-3">
              <span className="font-display text-gold">{i + 1}.</span>
              {item}
            </li>
          ))}
        </ol>
      </Card>
      </>
      )}
    </div>
  );
}

/* ---------------- Step 10: Highlights (accept/decline) ---------------- */

function StepHighlights() {
  const { user } = useUser();
  const analysis = user?.lastAnalysis;
  const priorities = analysis?.revision_priorities ?? [];
  const reviewers = analysis?.reviewer_comments ?? [];
  const reports = analysis?.coaching_reports ?? {};
  const sectionCoaching = analysis?.section_coaching ?? {};
  const draft = user?.essayDraft ?? "";
  const [showSections, setShowSections] = useState(false);
  const [showPackage, setShowPackage] = useState(false);

  const strategy = reports.strategy as Record<string, string> | undefined;
  const discovery = reports.discovery as Record<string, string> | undefined;
  const narrative = reports.narrative as Record<string, string> | undefined;

  return (
    <div className="space-y-6">
    <div className="grid lg:grid-cols-5 gap-6">
      <Card className="lg:col-span-3">
        <div className="text-xs uppercase tracking-widest text-muted-foreground flex items-center justify-between">
          <span>Your essay draft</span>
          <span className="font-mono">{draft.trim() ? draft.trim().split(/\s+/).length : 0} words</span>
        </div>
        <div className="mt-4 font-display text-[15px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
          {draft || "Paste your essay in the previous step to review it here."}
        </div>
      </Card>

      <Card className="lg:col-span-2 h-fit sticky top-24">
        <div className="flex items-center justify-between">
          <Pill tone={analysis ? "info" : "warn"}>{analysis ? "Backend feedback" : "No analysis yet"}</Pill>
          {analysis?.coaching_brief?.current_strength_level && (
            <span className="text-xs text-muted-foreground uppercase tracking-widest">
              {analysis.coaching_brief.current_strength_level}
            </span>
          )}
        </div>
        <div className="mt-4 text-sm">
          {analysis?.coaching_brief?.coach_message ||
            analysis?.feedback ||
            "Send your draft to the AI coach to receive revision guidance."}
        </div>
        {priorities.length > 0 && (
          <div className="mt-5">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Revision priorities</div>
            <ol className="mt-3 space-y-3 text-sm">
              {priorities.map((item, i) => (
                <li key={item} className="flex gap-3">
                  <span className="font-display text-gold">{i + 1}.</span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {reviewers.length > 0 && (
          <div className="mt-5">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Reviewer comments</div>
            <div className="mt-3 space-y-3">
              {reviewers.map((item, i) => (
                <div key={i} className="rounded-xl border border-border bg-secondary/50 p-3 text-sm">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                    {item.persona || "Reviewer"}
                  </div>
                  <div>{item.comment}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>

    {!analysis && (
      <Card>
        <p className="text-sm text-muted-foreground">
          Run the AI coach from step 8 first to receive strategy, narrative, and reviewer feedback.
        </p>
      </Card>
    )}

    {!!analysis && (strategy || discovery || narrative) && (
      <div className="grid md:grid-cols-3 gap-4">
        {strategy && (
          <Card>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Opportunity strategy</div>
            <p className="mt-2 text-sm">{strategy.strategic_insight}</p>
            {strategy.reflection_vs_story_ratio && (
              <p className="mt-2 text-xs text-muted-foreground">{strategy.reflection_vs_story_ratio}</p>
            )}
          </Card>
        )}
        {discovery && (
          <Card>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Experience discovery</div>
            <p className="mt-2 text-sm">{discovery.coaching_message}</p>
            {discovery.recommended_experience_to_feature && (
              <p className="mt-2 text-xs text-muted-foreground">
                Feature: {discovery.recommended_experience_to_feature}
              </p>
            )}
          </Card>
        )}
        {narrative && (
          <Card>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Narrative coach</div>
            <p className="mt-2 text-sm">{narrative.overall_narrative_coaching}</p>
            {narrative.biggest_narrative_gap && (
              <p className="mt-2 text-xs text-muted-foreground">Gap: {narrative.biggest_narrative_gap}</p>
            )}
          </Card>
        )}
      </div>
    )}

    {Object.keys(sectionCoaching).length > 0 && (
      <Card>
        <button
          type="button"
          onClick={() => setShowSections((v) => !v)}
          className="w-full text-left text-xs uppercase tracking-widest text-muted-foreground"
        >
          Section-by-section coaching {showSections ? "▲" : "▼"}
        </button>
        {showSections && (
          <div className="mt-4 space-y-4">
            {Object.entries(sectionCoaching).map(([name, feedback]) => (
              <div key={name}>
                <div className="text-sm font-medium">{name}</div>
                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{String(feedback)}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    )}

    {analysis?.final_application_package && (
      <Card>
        <button
          type="button"
          onClick={() => setShowPackage((v) => !v)}
          className="w-full text-left text-xs uppercase tracking-widest text-muted-foreground"
        >
          Full coaching package {showPackage ? "▲" : "▼"}
        </button>
        {showPackage && (
          <pre className="mt-4 max-h-96 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">
            {analysis.final_application_package}
          </pre>
        )}
      </Card>
    )}
    </div>
  );
}

/* ---------------- Step 11: Revise — multiple drafts ---------------- */

function StepRevise() {
  const { user, updateProfile } = useUser();
  const drafts = user?.drafts ?? [];
  const current = user?.essayDraft ?? "";
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = drafts.find((d) => d.id === openId);

  function addDraft() {
    if (!current.trim()) return;
    const nextVersion = (drafts[drafts.length - 1]?.version ?? 0) + 1;
    const wc = current.trim() ? current.trim().split(/\s+/).length : 0;
    const next: EssayDraft = {
      id: crypto.randomUUID(),
      version: nextVersion,
      content: current,
      wordCount: wc,
      savedAt: new Date().toISOString(),
    };
    updateProfile({ drafts: [...drafts, next] });
  }

  function deleteDraft(id: string) {
    updateProfile({ drafts: drafts.filter((d) => d.id !== id) });
    if (openId === id) setOpenId(null);
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <SectionLabel>Your drafts</SectionLabel>
            <p className="text-xs text-muted-foreground mt-1">
              {drafts.length} saved · click any version to read it and see its score.
            </p>
          </div>
          <button
            onClick={addDraft}
            disabled={!current.trim()}
            className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm hover:opacity-90 disabled:opacity-40"
          >
            + Save current as new draft
          </button>
        </div>

        {drafts.length === 0 ? (
          <div className="mt-4 text-sm text-muted-foreground">
            No drafts saved yet — write something in Essay Workspace and save it as a draft.
          </div>
        ) : (
          <div className="mt-4 grid sm:grid-cols-2 gap-3">
            {drafts.map((d) => {
              const isOpen = openId === d.id;
              return (
                <button
                  key={d.id}
                  onClick={() => setOpenId(isOpen ? null : d.id)}
                  className={`text-left rounded-xl border p-4 transition-colors ${
                    isOpen ? "border-primary bg-primary/5" : "border-border hover:bg-accent"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-display text-lg">Draft v{d.version}</div>
                    <Pill tone="info">pending re-review</Pill>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {d.wordCount} words · saved {new Date(d.savedAt).toLocaleString()}
                  </div>
                  <p className="text-xs text-foreground/70 mt-2 line-clamp-2">{d.content.slice(0, 160)}…</p>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <SectionLabel>
            {opened ? `Draft v${opened.version}` : "Current working draft"}
          </SectionLabel>
          {opened && (
            <button
              onClick={() => deleteDraft(opened.id)}
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              Delete draft
            </button>
          )}
        </div>
        <pre className="mt-3 whitespace-pre-wrap font-display text-sm leading-relaxed text-foreground max-h-[480px] overflow-y-auto">
{opened ? opened.content : current || "(Your current draft is empty.)"}
        </pre>
        {opened && (
          <div className="mt-3 text-xs text-muted-foreground">
            Return to Essay Workspace to get an AI score · {opened.wordCount} words
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Step 12: Resubmit — with improvement tips ---------------- */

function StepResubmit() {
  const { user } = useUser();
  const [status, setStatus] = useState<string | null>(null);
  const tips = user?.lastAnalysis?.revision_priorities ?? [
    "Revise the draft using the feedback from the previous step.",
    "Add evidence from your profile where the scholarship asks for fit.",
    "Run the AI coach again to compare the new draft with the prior review.",
  ];

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-2xl">Resubmit your latest draft</div>
            <div className="text-xs text-muted-foreground mt-1">
              {user?.activeScholarship?.name || "Current scholarship"} · {user?.essayDraft?.trim().split(/\s+/).filter(Boolean).length ?? 0} words
            </div>
          </div>
          <Pill tone="info">AI coach review</Pill>
        </div>
        <div className="mt-5">
          <CoachRunButton
            label="Get coaching again"
            loadingLabel="Reviewing revised draft..."
            disabled={!user?.essayDraft?.trim()}
            onStatus={setStatus}
            className="rounded-full bg-primary text-primary-foreground px-5 py-2 text-sm hover:opacity-90 disabled:opacity-40"
          />
          {status && <p className="mt-3 text-xs text-muted-foreground">{status}</p>}
        </div>
      </Card>

      <Card>
        <div className="text-xs uppercase tracking-widest text-gold">Ways to improve your score further</div>
        <ul className="mt-3 space-y-3 text-sm">
          {tips.map((t, i) => (
            <li key={t} className="flex gap-3">
              <span className="font-display text-gold shrink-0">{i + 1}.</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="bg-success/10 border-success/30">
        <div className="text-sm font-medium text-success">
          {user?.lastAnalysis?.coaching_brief?.recommended_action || "Coach feedback will update after each review."}
        </div>
        <p className="text-sm text-foreground/80 mt-1">
          {user?.lastAnalysis?.coaching_brief?.coach_message ||
            "Continue to the final submission check when your materials and draft are ready."}
        </p>
      </Card>
    </div>
  );
}

/* ---------------- Step 13: Final Check ---------------- */

function StepFinalCheck() {
  const { user } = useUser();
  const analysis = user?.lastAnalysis;
  const docs = user?.documents ?? [];
  const hasDoc = (kind: string) => docs.some((doc) => doc.kind.toLowerCase().includes(kind));
  const checklist = [
    { item: "Student profile created", done: !!user?.educationLevel },
    {
      item: "Scholarship requirements imported",
      done: !!(
        user?.activeScholarship?.minimumGpa ||
        user?.activeScholarship?.enrollmentLevel ||
        user?.activeScholarship?.citizenshipRequirement ||
        user?.activeScholarship?.financialNeedRequirement ||
        user?.activeScholarship?.locationRequirement ||
        user?.activeScholarship?.eligibleMajors ||
        user?.activeScholarship?.otherEligibilityRules ||
        user?.activeScholarship?.requiredDocumentTypes?.length ||
        user?.activeScholarship?.otherRequiredMaterials ||
        user?.activeScholarship?.essayPrompts ||
        user?.activeScholarship?.fullText
      ),
    },
    { item: "Resume uploaded or identified", done: hasDoc("resume") },
    { item: "Transcript uploaded or identified", done: hasDoc("transcript") },
    { item: "Recommendation letter uploaded or identified", done: hasDoc("recommendation") || hasDoc("rec") },
    { item: "Essay draft added", done: !!user?.essayDraft?.trim() },
    { item: "AI coach review completed", done: !!analysis },
  ];
  const blockers = [
    ...(analysis?.revision_priorities ?? []).slice(0, 3),
    ...checklist.filter((c) => !c.done).map((c) => c.item),
  ].filter((item, i, arr) => arr.indexOf(item) === i);
  const done = checklist.filter((x) => x.done).length;
  const readiness = analysis?.readiness_index ?? {};
  const lowDims = Object.entries(readiness)
    .filter(([, entry]) => typeof entry?.score === "number" && (entry.score ?? 0) < 70)
    .map(([key, entry]) => `${key.replace(/_/g, " ")} (${entry.score}/100)`);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Submission readiness</div>
            <div className="font-display text-3xl mt-1">{done} / {checklist.length} complete</div>
          </div>
          <div className="size-16 rounded-2xl bg-warning/20 grid place-items-center font-display text-2xl">!</div>
        </div>
        <div className="mt-4 h-2 rounded-full bg-secondary overflow-hidden">
          <div className="h-full bg-gold" style={{ width: `${(done / checklist.length) * 100}%` }} />
        </div>
      </Card>

      <Card>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Final checklist</div>
        <ul className="mt-3 divide-y divide-border">
          {checklist.map((c) => (
            <li key={c.item} className="py-3 flex items-center gap-3">
              <div className={`size-5 rounded-md grid place-items-center text-[11px] ${c.done ? "bg-success text-white" : "border-2 border-warning"}`}>
                {c.done ? "✓" : ""}
              </div>
              <div className={`text-sm flex-1 ${c.done ? "" : "text-foreground font-medium"}`}>{c.item}</div>
              {!c.done && <Pill tone="warn">action needed</Pill>}
            </li>
          ))}
        </ul>
      </Card>

      {blockers.length > 0 ? (
        <Card className="bg-warning/10 border-warning/30">
          <div className="text-sm font-medium">
            {blockers.length} item{blockers.length === 1 ? "" : "s"} to address before you submit:
          </div>
          <ul className="mt-2 list-disc pl-5 text-sm text-foreground/80 space-y-1">
            {blockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {lowDims.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Lowest readiness dimensions: {lowDims.join(", ")}
            </p>
          )}
        </Card>
      ) : (
        <Card className="bg-success/10 border-success/30">
          <div className="text-sm font-medium text-success">Ready to submit — all checks passed.</div>
        </Card>
      )}
    </div>
  );
}

/* ---------------- Step 14: Tracker ---------------- */

function StepTracker() {
  const columns = ["Interested", "Drafting", "Submitted", "Awarded"] as const;
  const { user } = useUser();
  const scholarship = user?.activeScholarship;
  const readiness = user?.lastAnalysis?.readiness_index ?? {};
  const scores = Object.values(readiness)
    .map((entry) => entry.score)
    .filter((score): score is number => typeof score === "number");
  const average = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const activeColumn = user?.lastAnalysis ? "Drafting" : scholarship?.name ? "Interested" : "Interested";

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-3 gap-4">
        <Card><div className="text-xs text-muted-foreground uppercase tracking-widest">Active</div><div className="font-display text-3xl mt-1">{scholarship?.name ? 1 : 0}</div></Card>
        <Card><div className="text-xs text-muted-foreground uppercase tracking-widest">Readiness</div><div className="font-display text-3xl mt-1">{average || "—"}</div></Card>
        <Card><div className="text-xs text-muted-foreground uppercase tracking-widest">Latest review</div><div className="font-display text-3xl mt-1">{user?.lastAnalysis ? "Done" : "Needed"}</div><div className="text-xs text-muted-foreground">{scholarship?.name || "No scholarship imported"}</div></Card>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        {columns.map((col) => (
          <div key={col} className="rounded-2xl bg-secondary/40 p-3 min-h-[320px]">
            <div className="flex items-center justify-between px-1 mb-3">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">{col}</div>
              <span className="text-xs font-mono text-muted-foreground">{scholarship?.name && col === activeColumn ? 1 : 0}</span>
            </div>
            <div className="space-y-2">
              {scholarship?.name && col === activeColumn ? (
                <div className="rounded-xl bg-card border border-border p-3">
                  <div className="text-sm font-medium leading-tight">{scholarship.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{scholarship.type || "Scholarship"}</div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <Pill tone="gold">{average ? `${average}/100 readiness` : "Needs review"}</Pill>
                    <span className="text-muted-foreground">{user?.lastAnalysis ? "AI reviewed" : "Not reviewed"}</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground text-center py-6">No items yet.</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <Card className="bg-primary text-primary-foreground">
        <div className="font-display text-2xl">That's the full Scholar-E journey.</div>
        <p className="text-primary-foreground/80 mt-2 text-sm">
          From landing on the homepage to a polished, sponsor-aligned submission — all without anyone writing your essay for you.
        </p>
        <Link to="/" className="mt-4 inline-flex rounded-full bg-gold text-gold-foreground px-5 py-2 text-sm font-medium">
          ← Back to landing
        </Link>
      </Card>
    </div>
  );
}
