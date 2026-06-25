import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { journeySteps } from "@/lib/persona";
import { loadExampleProfile } from "@/lib/loadExample";
import { CoachRunButton } from "@/components/CoachRunButton";
import {
  useUser,
  initials as toInitials,
  type EducationLevel,
  type UserProfile,
  type EssayDraft,
  type ActiveScholarship,
} from "@/lib/userStore";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

  function handleLoadExample() {
    updateProfile(
      loadExampleProfile({
        name: user?.name,
        email: user?.email,
        id: user?.id,
      }),
    );
    setExampleStatus("Example loaded — jump to Upload Essay Draft to run the AI coach.");
    const essayStepIdx = journeySteps.findIndex((s) => s.slug === "essay-upload");
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

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen flex">
        <Sidebar activeIdx={stepIdx} onSelect={setStepIdx} />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            step={step}
            onNext={goNext}
            onPrev={goPrev}
            stepIdx={stepIdx}
            onLoadExample={handleLoadExample}
            onClearAll={handleClearAll}
          />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-5xl px-6 md:px-10 py-10">
              {exampleStatus && (
                <div className="mb-4 rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-foreground/90">
                  {exampleStatus}
                </div>
              )}
              <StepHeader step={step} />
              <div className="mt-8">
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
    user?.pronouns?.trim() &&
    user.location?.trim() &&
    user.citizenshipStatus?.trim() &&
    user.hispanicLatino &&
    user.raceEthnicity &&
    user.careerGoal?.trim() &&
    user.educationLevel
  );
}

function Sidebar({ activeIdx, onSelect }: { activeIdx: number; onSelect: (i: number) => void }) {
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
    <aside className="hidden lg:flex w-80 shrink-0 flex-col border-r border-border bg-card/60 backdrop-blur sticky top-0 h-screen">
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
        <Link to="/" className="lg:hidden font-display font-semibold">
          Scholar-E
        </Link>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground">
            Step {step.id} of {journeySteps.length} · {step.group}
          </div>
          <div className="text-sm font-medium truncate">{step.title}</div>
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

function StepHeader({ step }: { step: (typeof journeySteps)[number] }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <div className="font-mono text-xs text-gold uppercase tracking-widest">
          Step {String(step.id).padStart(2, "0")} · {step.group}
        </div>
        <h1 className="font-display text-4xl md:text-5xl mt-2 text-balance">{step.title}</h1>
        <div className="text-sm text-muted-foreground mt-2">Goal: {step.goal}</div>
      </div>
      <div className="hidden md:flex size-14 rounded-2xl bg-primary text-primary-foreground items-center justify-center font-display text-2xl shrink-0">
        {step.id}
      </div>
    </div>
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
    case "land": return <StepLand />;
    case "profile": return <StepProfile error={profileError} />;
    case "discovery": return <StepDiscovery />;
    case "opportunities": return <StepOpportunities onAnalyze={goNext} />;
    case "import": return <StepImport />;
    case "requirements": return <StepRequirementsAndFit />;
    case "essay-outline": return <StepEssayOutline />;
    case "essay-upload": return <StepEssayUpload />;
    case "scores": return <StepScores />;
    case "highlights": return <StepHighlights />;
    case "revise": return <StepRevise />;
    case "resubmit": return <StepResubmit />;
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
        <div className="mt-6 space-y-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" defaultChecked className="size-4 mt-0.5 accent-[oklch(0.32_0.09_270)]" />
            <span className="text-sm leading-relaxed">Scholar-E is a coach, not a ghostwriter.</span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" defaultChecked className="size-4 mt-0.5 accent-[oklch(0.32_0.09_270)]" />
            <span className="text-sm leading-relaxed">My essays will stay in my own voice and authorship.</span>
          </label>
        </div>
      </Card>
    </div>
  );
}



function SidebarUser() {
  const { user } = useUser();
  const subtitle =
    user?.educationLevel
      ? eduLevelLabel(user.educationLevel)
      : "Complete your profile →";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-full bg-primary text-primary-foreground grid place-items-center font-display">
          {toInitials(user?.name)}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{user?.name || "Your profile"}</div>
          <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
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

  // documents
  const docs = user?.documents ?? [];
  function addDoc(kind: string, file: File) {
    updateProfile({ documents: [...docs, { name: file.name, kind }] });
  }
  function removeDoc(name: string) {
    updateProfile({ documents: docs.filter((d) => d.name !== name) });
  }

  const raceOptions = [
    "American Indian or Alaska Native",
    "Asian",
    "Black or African American",
    "Native Hawaiian or Other Pacific Islander",
    "Prefer not to say",
    "Two or More Races",
    "White",
  ];
  const citizenshipOptions = [
    "A-U.S. Citizen, U.S. National, Permanent Resident (Green Card Holder), Refugee, or Asylee",
    "B-International Student or Other Visa Status (F-1, J-1, H-4, TN, DACA, TPS, etc.)",
  ];

  return (
    <div className="space-y-6">
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
      </Card>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          {error}
        </div>
      )}

      <Card>
        <SectionLabel>About you *</SectionLabel>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <Input label="Pronouns" value={user?.pronouns ?? ""} onChange={(v) => set("pronouns", v)} placeholder="she/her, he/him, they/them…" />
          <Input label="Location" value={user?.location ?? ""} onChange={(v) => set("location", v)} placeholder="City, State" />
          <Select
            label="Citizenship / Residency Status"
            value={user?.citizenshipStatus ?? ""}
            onChange={(v) => set("citizenshipStatus", v)}
            options={citizenshipOptions}
          />
          <Select
            label="Are you of Hispanic or Latino descent?"
            value={user?.hispanicLatino ?? ""}
            onChange={(v) => set("hispanicLatino", v)}
            options={["Yes", "No"]}
          />
          <Select
            label="Please select your Race / Ethnicity"
            value={user?.raceEthnicity ?? ""}
            onChange={(v) => set("raceEthnicity", v)}
            options={raceOptions}
            className="sm:col-span-2"
          />
          <Input
            label="Career goal (1-2 sentences)"
            value={user?.careerGoal ?? ""}
            onChange={(v) => set("careerGoal", v)}
            placeholder="What do you want to do after school?"
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

      <Card>
        <SectionLabel>Education level *</SectionLabel>
        <p className="text-xs text-muted-foreground mt-1">
          We use this to ask only the questions that apply to you.
        </p>
        <select
          value={level ?? ""}
          onChange={(e) => set("educationLevel", (e.target.value || undefined) as EducationLevel | undefined)}
          className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
        >
          <option value="">Select your education level…</option>
          <option value="high_school">High school</option>
          <option value="undergrad">Undergraduate</option>
          <option value="grad">Graduate student</option>
          <option value="phd">PhD student</option>
        </select>
      </Card>

      {level === "high_school" && <HighSchoolForm setBranch={setBranch} value={user?.highSchool ?? {}} />}
      {level === "undergrad" && <UndergradForm setBranch={setBranch} value={user?.undergrad ?? {}} />}
      {(level === "grad" || level === "phd") && <GradForm setBranch={setBranch} value={user?.graduate ?? {}} level={level} />}

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

      {/* Materials/document vault moved here, before Story Prompts */}
      <Card>
        <SectionLabel>Upload Materials (Optional)</SectionLabel>
        <p className="text-xs text-muted-foreground mt-1">
          Build your document vault so each application can reuse them.
        </p>
        {docs.length > 0 && (
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
        )}
        <div className="mt-5 grid sm:grid-cols-2 gap-3">
          {["Resume", "Transcript", "Recommendation letter", "Past Personal Application Essays"].map((k) => (
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
  label, value, onChange, placeholder, rows = 3,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <label className="block">
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

/* ---------------- Step 3: Discovery (shortened) ---------------- */

function StepDiscovery() {
  const { user } = useUser();
  const ug = user?.undergrad;
  const hs = user?.highSchool;
  const gr = user?.graduate;
  const major = ug?.major ?? hs?.intendedMajor ?? gr?.researchArea;
  const qs: { q: string; a: string }[] = [];
  if (user?.educationLevel) qs.push({ q: "Education level", a: eduLevelLabel(user.educationLevel) });
  if (major) qs.push({ q: "Major / focus", a: major });
  if (user?.location) qs.push({ q: "Location", a: user.location });
  if (user?.citizenshipStatus) qs.push({ q: "Citizenship / Residency Status", a: user.citizenshipStatus });
  if (user?.raceEthnicity) qs.push({ q: "Race / ethnicity", a: user.raceEthnicity });
  if (user?.hispanicLatino) qs.push({ q: "Hispanic / Latino?", a: user.hispanicLatino });
  if (user?.firstGen) qs.push({ q: "First-generation?", a: "Yes" });
  if (user?.pellEligible) qs.push({ q: "Financial need?", a: "Pell-eligible" });
  if (user?.careerGoal) qs.push({ q: "Career interests", a: user.careerGoal });
  const resources = buildDiscoveryResources(user);

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card className="self-start">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Your answers</div>
        {qs.length === 0 ? (
          <div className="mt-3 text-sm text-muted-foreground">No profile data yet — fill out your profile first.</div>
        ) : (
          <div className="mt-3">
            {qs.map((q) => <FieldRow key={q.q} label={q.q} value={q.a} />)}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Personalized resources
          </div>
          <Pill tone="info">Rule-based engine</Pill>
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          Curated based on your profile. We don't scrape — we point you to the right places.
        </p>
        <div className="mt-4 space-y-3">
          {resources.map((r) => (
            <div key={r.name} className="flex items-start gap-3 rounded-xl border border-border p-3">
              <div className="size-9 rounded-lg bg-gold/20 grid place-items-center font-display">
                {r.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.reason}</div>
                <div className="text-xs font-mono text-info mt-0.5">{r.url}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function buildDiscoveryResources(user: UserProfile | null) {
  const resources = [
    { name: "Scholarships.com", reason: "Broad search to build your first scholarship list.", url: "scholarships.com" },
    { name: "Fastweb", reason: "Saved searches and recurring scholarship discovery.", url: "fastweb.com" },
    { name: "Going Merry", reason: "Useful for managing multiple scholarship applications.", url: "goingmerry.com" },
  ];
  const text = JSON.stringify(user ?? {}).toLowerCase();
  if (user?.pellEligible || text.includes("financial")) {
    resources.push({ name: "Scholarship America", reason: "Strong source for need-aware scholarship programs.", url: "scholarshipamerica.org" });
  }
  if (user?.firstGen) {
    resources.push({ name: "First-generation scholarship directories", reason: "Search for awards tied to first-generation status.", url: "imfirst.org" });
  }
  if (user?.hispanicLatino === "Yes" || text.includes("hispanic") || text.includes("latino")) {
    resources.push({ name: "UNCF and identity-based directories", reason: "Use identity and community filters to find relevant awards.", url: "uncf.org" });
  }
  if (text.includes("research") || text.includes("graduate") || text.includes("phd")) {
    resources.push({ name: "ProFellow", reason: "Good fit for fellowships, graduate funding, research, and travel awards.", url: "profellow.com" });
  }
  if (user?.educationLevel) {
    resources.push({ name: "Institutional scholarship office", reason: "Check awards connected to your current or target school.", url: "your school scholarship portal" });
  }
  if (user?.location) {
    resources.push({ name: "Local foundations and civic groups", reason: "Search by city, county, state, employers, banks, and community foundations.", url: `${user.location} local scholarships` });
  }
  return resources;
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

/* ---------------- Step 5: Import ---------------- */

function StepImport() {
  const { user, updateProfile } = useUser();
  const scholarship = user?.activeScholarship ?? {};
  const requiredMaterialOptions = [
    "Resume / CV",
    "Transcript",
    "Personal Statement",
    "Essay",
    "Recommendation Letter(s)",
    "FAFSA Submission",
    "Financial Information",
    "Portfolio",
    "Research Proposal",
    "Proof of Enrollment",
    "Community Service Verification",
    "Video Submission",
  ];
  const hasEligibilityDetails = !!(
    scholarship.minimumGpa ||
    scholarship.enrollmentLevel ||
    scholarship.citizenshipRequirement ||
    scholarship.financialNeedRequirement ||
    scholarship.locationRequirement ||
    scholarship.eligibleMajors ||
    scholarship.otherEligibilityRules
  );
  const hasStructuredDetails = !!(
    scholarship.description ||
    hasEligibilityDetails ||
    scholarship.requiredDocumentTypes?.length ||
    scholarship.otherRequiredMaterials ||
    scholarship.essayPrompts ||
    scholarship.fullText
  );
  const isReady = !!scholarship.name && !!scholarship.type && hasStructuredDetails;

  function updateScholarship(patch: ActiveScholarship) {
    updateProfile({ activeScholarship: { ...scholarship, ...patch } });
  }

  function toggleRequiredMaterial(material: string, checked: boolean) {
    const current = scholarship.requiredDocumentTypes ?? [];
    const next = checked
      ? Array.from(new Set([...current, material]))
      : current.filter((item) => item !== material);
    updateScholarship({ requiredDocumentTypes: next });
  }

  return (
    <div className="space-y-6">
      <Card>
        <SectionLabel>Scholarship details</SectionLabel>
        <p className="mt-1 text-xs text-muted-foreground">
          Paste the real opportunity details here. Scholar-E does not scrape; it analyzes the information you provide.
        </p>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <Input
            label="Scholarship name"
            value={scholarship.name ?? ""}
            onChange={(name) => updateScholarship({ name })}
            placeholder="Scholarship name"
          />
          <Select
            label="Scholarship type"
            value={scholarship.type ?? ""}
            onChange={(type) => updateScholarship({ type })}
            options={["Merit-based", "Need-based", "Identity-based", "Research & Fellowship", "Institutional", "Local or community"]}
          />
          <Input
            label="Scholarship link or source"
            value={scholarship.url ?? ""}
            onChange={(url) => updateScholarship({ url })}
            placeholder="https://... or source name"
            className="sm:col-span-2"
          />
          <Input
            label="Award amount"
            value={scholarship.awardAmount ?? ""}
            onChange={(awardAmount) => updateScholarship({ awardAmount })}
            placeholder="$5,000"
          />
          <Input
            label="Application deadline"
            value={scholarship.applicationDeadline ?? ""}
            onChange={(applicationDeadline) => updateScholarship({ applicationDeadline })}
            type="date"
          />
        </div>
        <Textarea
          label="Scholarship description"
          value={scholarship.description ?? ""}
          onChange={(description) => updateScholarship({ description })}
          placeholder="Summarize what the scholarship is for and who sponsors it."
          rows={4}
        />
      </Card>

      <Card>
        <SectionLabel>Eligibility Requirements</SectionLabel>
        <p className="mt-1 text-xs text-muted-foreground">
          Use the structured fields for requirements that can be compared directly against the student profile.
        </p>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <Select
            label="Minimum GPA"
            value={scholarship.minimumGpa ?? ""}
            onChange={(minimumGpa) => updateScholarship({ minimumGpa })}
            options={["No minimum listed", "2.5+", "3.0+", "3.25+", "3.5+", "4.0", "Other"]}
          />
          <Select
            label="Enrollment Level"
            value={scholarship.enrollmentLevel ?? ""}
            onChange={(enrollmentLevel) => updateScholarship({ enrollmentLevel })}
            options={[
              "High school senior",
              "Undergraduate student",
              "Graduate student",
              "Community college student",
              "Transfer student",
              "Other",
            ]}
          />
          <Select
            label="Citizenship / Residency Status"
            value={scholarship.citizenshipRequirement ?? ""}
            onChange={(citizenshipRequirement) => updateScholarship({ citizenshipRequirement })}
            options={[
              "U.S. Citizen / National",
              "Permanent Resident",
              "Refugee / Asylee",
              "DACA Recipient",
              "International Student",
              "Other",
            ]}
          />
          <Select
            label="Financial Need Requirement"
            value={scholarship.financialNeedRequirement ?? ""}
            onChange={(financialNeedRequirement) => updateScholarship({ financialNeedRequirement })}
            options={["Not specified", "Required", "Preferred", "FAFSA required", "Pell Grant eligible"]}
          />
          <Select
            label="Location / Residency Requirement"
            value={scholarship.locationRequirement ?? ""}
            onChange={(locationRequirement) => updateScholarship({ locationRequirement })}
            options={[
              "No location restriction",
              "U.S. resident",
              "State resident required",
              "City/county resident required",
              "Other",
            ]}
            className="sm:col-span-2"
          />
        </div>
        <Textarea
          label="Eligible Majors / Fields of Study"
          value={scholarship.eligibleMajors ?? ""}
          onChange={(eligibleMajors) => updateScholarship({ eligibleMajors })}
          placeholder="Paste major or field-of-study requirements exactly as listed by the scholarship, such as 'Open to all majors,' 'STEM majors only,' or 'Computer Science, Cybersecurity, Information Systems.'"
          rows={4}
        />
        <Textarea
          label="Other Eligibility Rules"
          value={scholarship.otherEligibilityRules ?? ""}
          onChange={(otherEligibilityRules) => updateScholarship({ otherEligibilityRules })}
          placeholder="Paste any extra eligibility rules that do not fit above, such as leadership, community service, identity-based eligibility, military status, employer affiliation, or special circumstances."
          rows={4}
        />
      </Card>

      <Card>
        <SectionLabel>Application materials</SectionLabel>
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {requiredMaterialOptions.map((material) => (
            <label key={material} className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={!!scholarship.requiredDocumentTypes?.includes(material)}
                onChange={(e) => toggleRequiredMaterial(material, e.target.checked)}
                className="size-4 accent-[oklch(0.32_0.09_270)]"
              />
              <span>{material}</span>
            </label>
          ))}
        </div>
        <Textarea
          label="Other Required Materials"
          value={scholarship.otherRequiredMaterials ?? ""}
          onChange={(otherRequiredMaterials) => updateScholarship({ otherRequiredMaterials })}
          placeholder="Paste any additional required documents or materials not listed above."
          rows={4}
        />
        <Textarea
          label="Essay prompt(s)"
          value={scholarship.essayPrompts ?? ""}
          onChange={(essayPrompts) => updateScholarship({ essayPrompts })}
          placeholder="Paste each essay or short-answer prompt here."
          rows={5}
        />
        <Textarea
          label="Additional notes"
          value={scholarship.additionalNotes ?? ""}
          onChange={(additionalNotes) => updateScholarship({ additionalNotes })}
          placeholder="Optional notes about selection criteria, recommender deadlines, submission portal details, or anything else."
          rows={3}
        />
        <Textarea
          label="Paste full scholarship text (optional)"
          value={scholarship.fullText ?? ""}
          onChange={(fullText) => updateScholarship({ fullText })}
          placeholder="Optional: paste the full scholarship page text if you want Scholar-E to analyze everything together."
          rows={6}
        />
      </Card>

      <Card className={isReady ? "bg-success/10 border-success/30" : "bg-secondary/40"}>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">{isReady ? "Ready for analysis" : "Add the required scholarship details"}</div>
            <div className="text-xs text-muted-foreground mt-1">
              The next analysis will compare these details against your profile.
            </div>
          </div>
          <Pill tone={isReady ? "success" : "warn"}>{isReady ? "ready" : "incomplete"}</Pill>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Step 6: Requirements + Fit combined ---------------- */

const ELIGIBILITY_STATUS_META: Record<
  string,
  { label: string; icon: string; row: string; badge: string }
> = {
  met: {
    label: "Met",
    icon: "✓",
    row: "border-success/40 bg-success/5",
    badge: "bg-success/15 text-success",
  },
  not_met: {
    label: "Not met",
    icon: "✕",
    row: "border-destructive/50 bg-destructive/10",
    badge: "bg-destructive/15 text-destructive",
  },
  missing: {
    label: "Needs info",
    icon: "!",
    row: "border-warning/50 bg-warning/10",
    badge: "bg-warning/20 text-foreground",
  },
};

function EligibilityMatrixCard({
  matrix,
}: {
  matrix?: import("@/lib/userStore").EligibilityMatrix;
}) {
  const rows = matrix?.rows ?? [];
  if (!rows.length) {
    return (
      <Card>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          Requirements comparison matrix
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {matrix?.summary ||
            "Add the scholarship's eligibility rules and required documents in the import step, then run the coach to see how your profile compares."}
        </p>
      </Card>
    );
  }

  const violations = matrix?.violation_count ?? rows.filter((r) => r.status === "not_met").length;
  const missing = matrix?.missing_count ?? rows.filter((r) => r.status === "missing").length;
  const met = matrix?.met_count ?? rows.filter((r) => r.status === "met").length;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Requirements comparison matrix
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            How your profile compares against every requirement Scholar-E found.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone="success">{met} met</Pill>
          {missing > 0 && <Pill tone="warn">{missing} to fill in</Pill>}
          {violations > 0 && <Pill tone="danger">{violations} not met</Pill>}
        </div>
      </div>

      {(violations > 0 || missing > 0) && (
        <div
          className={`mt-4 rounded-xl border p-4 text-sm ${
            violations > 0
              ? "border-destructive/40 bg-destructive/10"
              : "border-warning/40 bg-warning/10"
          }`}
        >
          <div className="font-medium">
            {violations > 0
              ? `${violations} requirement${violations > 1 ? "s are" : " is"} not met`
              : `${missing} requirement${missing > 1 ? "s need" : " needs"} more information`}
          </div>
          <p className="mt-1 text-muted-foreground">
            {violations > 0
              ? "Review the highlighted rows below — these may make you ineligible unless addressed."
              : "Fill in the highlighted rows below so Scholar-E can confirm your eligibility."}
          </p>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {rows.map((row, i) => {
          const meta = ELIGIBILITY_STATUS_META[row.status ?? "missing"] ?? ELIGIBILITY_STATUS_META.missing;
          return (
            <div key={`${row.requirement}-${i}`} className={`rounded-xl border p-3 ${meta.row}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] rounded-full px-2 py-0.5 ${meta.badge}`}>
                      <span className="font-mono">{meta.icon}</span> {meta.label}
                    </span>
                    {row.category && (
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        {row.category}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 text-sm font-medium">{row.requirement}</div>
                  {row.explanation && (
                    <div className="text-xs text-muted-foreground mt-0.5">{row.explanation}</div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Your profile</div>
                  <div className="text-sm">{row.student_value || "Not provided"}</div>
                </div>
              </div>
              {row.status !== "met" && row.action_needed && (
                <div className="mt-2 rounded-lg bg-background/60 border border-border px-3 py-2 text-xs">
                  <span className="font-medium">What to fill in: </span>
                  {row.action_needed}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {matrix?.summary && (
        <p className="mt-4 text-sm text-muted-foreground border-t border-border pt-3">
          {matrix.summary}
        </p>
      )}
    </Card>
  );
}

function StepRequirementsAndFit() {
  const { user } = useUser();
  const scholarship = user?.activeScholarship;
  const eligibilitySummary = [
    scholarship?.minimumGpa && `Minimum GPA: ${scholarship.minimumGpa}`,
    scholarship?.enrollmentLevel && `Enrollment level: ${scholarship.enrollmentLevel}`,
    scholarship?.citizenshipRequirement && `Citizenship/residency: ${scholarship.citizenshipRequirement}`,
    scholarship?.financialNeedRequirement && `Financial need: ${scholarship.financialNeedRequirement}`,
    scholarship?.locationRequirement && `Location/residency: ${scholarship.locationRequirement}`,
    scholarship?.eligibleMajors && `Eligible majors/fields: ${scholarship.eligibleMajors}`,
    scholarship?.otherEligibilityRules && `Other rules: ${scholarship.otherEligibilityRules}`,
  ].filter(Boolean).join("\n");
  const requiredMaterialsSummary = [
    scholarship?.requiredDocumentTypes?.length && scholarship.requiredDocumentTypes.join(", "),
    scholarship?.otherRequiredMaterials && `Other: ${scholarship.otherRequiredMaterials}`,
  ].filter(Boolean).join("\n");
  const scholarshipSummary = [
    scholarship?.awardAmount && `Award amount: ${scholarship.awardAmount}`,
    scholarship?.applicationDeadline && `Deadline: ${scholarship.applicationDeadline}`,
    scholarship?.description,
    eligibilitySummary && `Eligibility:\n${eligibilitySummary}`,
    requiredMaterialsSummary && `Required materials:\n${requiredMaterialsSummary}`,
    scholarship?.essayPrompts && `Essay prompt(s): ${scholarship.essayPrompts}`,
  ].filter(Boolean).join("\n\n");
  const analysis = user?.lastAnalysis;
  const readiness = analysis?.readiness_index ?? {};
  const dims = Object.entries(readiness)
    .filter(([, d]) => typeof d?.score === "number")
    .map(([key, d]) => ({
      name: key.replace(/_/g, " "),
      score: d.score ?? 0,
      note: d.coaching || d.level || "Reviewed by Scholar-E.",
    }));
  const overall = dims.length
    ? Math.round(dims.reduce((a, d) => a + d.score, 0) / dims.length)
    : 0;
  const opportunityAnalysis = analysis?.opportunity_analysis ?? {};

  return (
    <div className="space-y-6">
      <Card className="bg-secondary/40">
        <div className="text-sm font-medium">{scholarship?.name || "Scholarship opportunity"}</div>
        <p className="mt-2 whitespace-pre-wrap text-foreground/90 font-display italic text-lg">
          "{scholarshipSummary || "Add scholarship requirements in the import step, then run the coach from the essay step."}"
        </p>
      </Card>

      {!analysis && (
        <Card>
          <div className="font-medium">No analysis yet</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Run the AI coach from step 8 (Upload Essay Draft) first. Scholar-E will analyze
            scholarship fit, compare your profile against every requirement, and return readiness
            scores here.
          </p>
        </Card>
      )}

      {!!analysis && <EligibilityMatrixCard matrix={analysis.eligibility_matrix} />}

      {!!analysis && (
        <div className="grid md:grid-cols-3 gap-6">
        <Card className="md:col-span-1 flex flex-col items-center justify-center text-center">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Overall fit</div>
          <div className="relative mt-3 size-44">
            <svg viewBox="0 0 100 100" className="size-44 -rotate-90">
              <circle cx="50" cy="50" r="42" stroke="var(--border)" strokeWidth="8" fill="none" />
              <circle
                cx="50" cy="50" r="42"
                stroke="var(--gold)" strokeWidth="8" fill="none" strokeLinecap="round"
                strokeDasharray={`${(overall / 100) * 2 * Math.PI * 42} 999`}
              />
            </svg>
            <div className="absolute inset-0 grid place-items-center">
              <div>
                <div className="font-display text-5xl">{overall}</div>
                <div className="text-xs text-muted-foreground">/ 100</div>
              </div>
            </div>
          </div>
          <Pill tone="success">Strong fit</Pill>
        </Card>

        <Card className="md:col-span-2">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Dimension breakdown</div>
          <div className="mt-4 space-y-4">
            {dims.map((d) => (
              <div key={d.name}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{d.name}</span>
                  <span className="font-mono text-xs">{d.score}/100</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-gold transition-all" style={{ width: `${d.score}%` }} />
                </div>
                <div className="text-xs text-muted-foreground mt-1">{d.note}</div>
              </div>
            ))}
          </div>
        </Card>
        </div>
      )}

      {!!analysis && Object.keys(opportunityAnalysis).length > 0 && (
        <Card>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Backend opportunity analysis</div>
          <div className="mt-4 grid sm:grid-cols-2 gap-4 text-sm">
            {!!opportunityAnalysis.opportunity_type && (
              <div>
                <div className="text-xs text-muted-foreground">Type</div>
                <div className="font-medium">{String(opportunityAnalysis.opportunity_type)}</div>
              </div>
            )}
            {Array.isArray(opportunityAnalysis.deadlines) && opportunityAnalysis.deadlines.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground">Deadlines</div>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {(opportunityAnalysis.deadlines as string[]).map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            )}
            {Array.isArray(opportunityAnalysis.requirements) && opportunityAnalysis.requirements.length > 0 && (
              <div className="sm:col-span-2">
                <div className="text-xs text-muted-foreground">Requirements</div>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {(opportunityAnalysis.requirements as string[]).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {Array.isArray(opportunityAnalysis.evaluation_themes) && opportunityAnalysis.evaluation_themes.length > 0 && (
              <div className="sm:col-span-2">
                <div className="text-xs text-muted-foreground">Evaluation themes</div>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {(opportunityAnalysis.evaluation_themes as string[]).map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}
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
            No drafts saved yet — write something in Step 8 and save it as a draft.
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
            Run step 12 to get an AI score · {opened.wordCount} words
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
