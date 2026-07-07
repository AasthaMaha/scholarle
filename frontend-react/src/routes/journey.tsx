import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ClipboardList,
  Copy,
  FileUp,
  Gauge,
  Lightbulb,
  ListChecks,
  Menu,
  MessageSquare,
  PencilLine,
  Power,
  RefreshCw,
  Save,
  Sparkles,
  Target,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EssayEditor, type EssayEditorHandle } from "@/components/EssayEditor";
import {
  analyzeText,
  CATEGORY_META,
  CATEGORY_ORDER,
  countByCategory,
  type Suggestion,
} from "@/lib/suggestions";
import { journeySteps } from "@/lib/persona";
import { loadExampleProfile } from "@/lib/loadExample";
import { CoachRunButton } from "@/components/CoachRunButton";
import {
  analyzeScholarshipFit,
  autofillProfileFromResume,
  buildFitPayload,
  buildOutlinePayload,
  buildWikiPayload,
  discoverScholarshipWiki,
  extractScholarshipOpportunity,
  generatePersonalizedOutline,
} from "@/lib/api/scholarE";
import {
  useUser,
  initials as toInitials,
  type EducationLevel,
  type EducationHistoryEntry,
  type ResearchExperienceEntry,
  type WorkExperienceEntry,
  type UserProfile,
  type AnalysisResult,
  type AnalysisScore,
  type EssayDraft,
  type ActiveScholarship,
  type WikiDiscoveryResult,
  type ApplicationReadinessMatrix,
  type EssayAlignmentMatrix,
  type FitAnalysisResult,
  type PersonalizedOutlineResult,
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
            <div className={`mx-auto px-6 md:px-10 ${["discovery", "requirements"].includes(step.slug) ? "max-w-7xl py-6" : step.slug === "profile" ? "max-w-7xl py-10" : "max-w-5xl py-10"}`}>
              {exampleStatus && (
                <div className="mb-4 rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-foreground/90">
                  {exampleStatus}
                </div>
              )}
              <div>
              <StepBody
                slug={step.slug}
                goNext={goNext}
                goPrev={goPrev}
                goToProfile={() => setStepIdx(Math.max(0, journeySteps.findIndex((s) => s.slug === "profile")))}
                goToRequirements={() => setStepIdx(Math.max(0, journeySteps.findIndex((s) => s.slug === "requirements")))}
                profileError={profileError}
              />
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
  goPrev,
  goToProfile,
  goToRequirements,
  profileError,
}: {
  slug: string;
  goNext: () => void;
  goPrev: () => void;
  goToProfile: () => void;
  goToRequirements: () => void;
  profileError: string;
}) {
  switch (slug) {
    case "profile": return <StepProfile error={profileError} />;
    case "discovery": return <StepDiscovery onUpdateProfile={goToProfile} onUseSource={goToRequirements} />;
    case "opportunities": return <StepOpportunities onAnalyze={goNext} />;
    case "requirements": return <StepRequirementsAndFit />;
    case "essay-workspace": return <StepEssayWorkspace onBack={goPrev} />;
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

function matrixTone(status?: string, risk?: string): "default" | "gold" | "success" | "warn" | "info" | "danger" {
  const value = `${status ?? ""} ${risk ?? ""}`.toLowerCase();
  if (value.includes("high") || value.includes("missing") || value.includes("blocked") || value.includes("not met")) return "danger";
  if (value.includes("medium") || value.includes("partial") || value.includes("confirm") || value.includes("progress") || value.includes("revision")) return "gold";
  if (value.includes("ready") || value.includes("met") || value.includes("low")) return "success";
  return "info";
}

function buildReadinessFallback(fitAnalysis?: FitAnalysisResult): ApplicationReadinessMatrix | undefined {
  if (!fitAnalysis) return undefined;
  if (fitAnalysis.application_readiness_matrix?.matrix?.length) return fitAnalysis.application_readiness_matrix;

  const rows: NonNullable<ApplicationReadinessMatrix["matrix"]> = [
    ...(fitAnalysis.eligibility_analysis ?? []).map((item) => {
      const ready = item.status === "Met";
      const missing = item.status === "Not met";
      return {
        item: item.requirement,
        item_type: "Eligibility",
        status: ready ? "Ready" : missing ? "Missing" : "Need to confirm",
        risk_level: ready ? "Low" : missing ? "High" : "Medium",
        student_evidence: item.student_evidence,
        action_needed: item.explanation,
        notes: item.explanation,
      };
    }),
    ...(fitAnalysis.application_materials_check ?? []).map((item) => {
      const ready = item.status === "Ready";
      const missing = item.status === "Missing";
      return {
        item: item.material,
        item_type: "Application material",
        status: ready ? "Ready" : missing ? "Missing" : "Need to confirm",
        risk_level: ready ? "Low" : missing ? "High" : "Medium",
        student_evidence: "",
        action_needed: item.notes,
        notes: item.notes,
      };
    }),
  ].filter((row) => !!row.item);

  if (!rows.length) return undefined;
  const readyCount = rows.filter((row) => row.status === "Ready").length;
  return {
    overall_status: rows.some((row) => row.risk_level === "High") ? "Blocked" : readyCount === rows.length ? "Ready" : "Needs preparation",
    completion_percent: Math.round((readyCount / rows.length) * 100),
    ready_count: readyCount,
    total_count: rows.length,
    matrix: rows,
    blockers: rows.filter((row) => row.risk_level === "High") as Array<Record<string, string>>,
    preparation_tasks: rows.filter((row) => row.status !== "Ready").map((row) => row.action_needed || `Confirm ${row.item}`).filter(Boolean) as string[],
    summary: `${readyCount} of ${rows.length} eligibility/material items look ready.`,
  };
}

function ApplicationReadinessMatrixCard({ matrix }: { matrix?: ApplicationReadinessMatrix }) {
  const rows = matrix?.matrix ?? [];
  return (
    <Card className="md:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Application Readiness Matrix</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Checks whether the required eligibility items and materials are ready to apply.
          </p>
        </div>
        <div className="text-right">
          <Pill tone={matrixTone(matrix?.overall_status)}>{matrix?.overall_status ?? "Needs review"}</Pill>
          <div className="mt-2 text-xs text-muted-foreground">{matrix?.completion_percent ?? 0}% complete</div>
        </div>
      </div>
      {matrix?.summary && <p className="mt-4 text-sm">{matrix.summary}</p>}
      {rows.length ? (
        <div className="mt-4 space-y-3">
          {rows.map((row, index) => (
          <div key={`${row.item}-${index}`} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{row.item}</div>
                <div className="text-xs text-muted-foreground">{row.item_type}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Pill tone={matrixTone(row.status)}>{row.status || "Need to confirm"}</Pill>
                <Pill tone={matrixTone(undefined, row.risk_level)}>{row.risk_level || "Medium"} risk</Pill>
              </div>
            </div>
            {row.student_evidence && <div className="mt-2 text-xs text-muted-foreground">{row.student_evidence}</div>}
            {row.action_needed && <div className="mt-1 text-xs">{row.action_needed}</div>}
          </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
          Run or rerun the scholarship fit analysis to populate this matrix.
        </div>
      )}
    </Card>
  );
}

function EssayAlignmentMatrixCard({ matrix }: { matrix?: EssayAlignmentMatrix }) {
  const rows = matrix?.matrix ?? [];
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Essay Alignment Matrix</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Checks whether this essay version answers the prompt, themes, criteria, and length guidance.
          </p>
        </div>
        <div className="text-right">
          <Pill tone={matrixTone(matrix?.overall_alignment_status)}>{matrix?.overall_alignment_status ?? "Needs review"}</Pill>
          <div className="mt-2 text-xs text-muted-foreground">
            {matrix?.completion_percent ?? 0}% · {matrix?.word_count ?? 0} words · {matrix?.word_limit_status ?? "No limit provided"}
          </div>
        </div>
      </div>
      {rows.length ? (
        <div className="mt-4 space-y-3">
          {rows.slice(0, 8).map((row, index) => (
          <div key={`${row.requirement}-${index}`} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{row.requirement}</div>
                <div className="text-xs text-muted-foreground">{row.requirement_type}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Pill tone={matrixTone(row.status)}>{row.status || "Unclear"}</Pill>
                <Pill tone={matrixTone(undefined, row.risk_level)}>{row.risk_level || "Medium"} risk</Pill>
              </div>
            </div>
            {row.essay_evidence && <div className="mt-2 text-xs text-muted-foreground">{row.essay_evidence}</div>}
            {row.revision_needed && <div className="mt-1 text-xs">{row.revision_needed}</div>}
          </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
          Run or rerun the essay evaluation to populate this matrix.
        </div>
      )}
      {!!matrix?.recommended_revision_tasks?.length && (
        <div className="mt-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Revision tasks</div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {matrix.recommended_revision_tasks.slice(0, 5).map((task) => <li key={task}>{task}</li>)}
          </ul>
        </div>
      )}
      {matrix?.final_submission_readiness && (
        <p className="mt-4 text-sm text-muted-foreground">{matrix.final_submission_readiness}</p>
      )}
    </Card>
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

const SCHOLARSHIP_TYPE_OPTIONS = [
  "Scholarship",
  "Fellowship",
  "Research funding",
  "Conference travel grant",
  "Workshop",
  "Internship",
  "Grant",
  "Need-based aid",
  "Merit award",
];

const PROFILE_SECTION_CLASS = "!rounded-none !border-0 !bg-transparent !p-0 !shadow-none";
const PROFILE_ENTRY_CLASS = "rounded-lg border border-border/60 bg-white/60 p-4";

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
      ).map((entry, index) => ({
        ...entry,
        id: entry.id || `edu-${index + 1}`,
        majorField: entry.majorField || inferMajorField(entry.degreeProgram),
        educationLevel:
          normalizeEducationLevelLabel(entry.educationLevel) ||
          inferEducationLevelLabel(entry) ||
          educationLevelLabelFromCode(nextLevel),
      }));
      const nextResearchExperience = (profile.researchExperience?.length
        ? profile.researchExperience
        : buildResearchExperienceFromProfile(parsedProfile)
      )
        .filter(hasConcreteResearchEvidence)
        .map((entry, index) => ({ ...entry, id: entry.id || `research-${index + 1}` }));
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
        researchExperience: nextResearchExperience,
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
    <Card className={PROFILE_SECTION_CLASS}>
      <SectionLabel>Upload Materials (Optional)</SectionLabel>
      <p className="text-xs text-muted-foreground mt-1">
        Add supporting documents you may reuse across applications.
      </p>
      {uploadedDocsList}
      <div className="mt-4 grid sm:grid-cols-3 gap-3">
        {["Transcript", "Letter of Recommendation", "Other documents"].map((k) => (
          <label key={k} className="rounded-lg border border-dashed border-border p-3 text-sm cursor-pointer hover:bg-accent">
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
    <div className="mx-auto max-w-7xl">
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

      <div className="grid items-start gap-8 xl:grid-cols-2">
        <div className="space-y-8">
      <Card className={PROFILE_SECTION_CLASS}>
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary text-primary-foreground grid place-items-center font-display text-base">
            {toInitials(user?.name)}
          </div>
          <div>
            <div className="font-display text-xl font-semibold">{user?.name}</div>
            <div className="text-sm text-muted-foreground">{user?.email}</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
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

      <Card className={PROFILE_SECTION_CLASS}>
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

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          <GlossaryCheck label="First-generation college student" checked={!!user?.firstGen} onChange={(v) => set("firstGen", v)} />
          <GlossaryCheck label="Pell Grant eligible" checked={!!user?.pellEligible} onChange={(v) => set("pellEligible", v)} />
        </div>

        <button
          onClick={() => setShowExtended((s) => !s)}
          className="mt-4 text-xs underline text-muted-foreground hover:text-foreground"
        >
          {showExtended ? "− Hide" : "+ Add more personalized context"}
        </button>

        {showExtended && (
          <div className="mt-4 space-y-4">
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

        </div>
        <div className="space-y-8">
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

      {uploadMaterialsCard}
        </div>
      </div>

      <Card className={`${PROFILE_SECTION_CLASS} mt-8`}>
        <SectionLabel>Optional context</SectionLabel>
        <p className="text-xs text-muted-foreground mt-1">
          All optional — add whatever helps scholarships see who you are.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Textarea label="Society / club involvement" value={user?.optional?.societyInvolvement ?? ""} onChange={(v) => setOptional({ societyInvolvement: v })} placeholder="Clubs, organizations, roles…" />
          <Textarea label="Leadership experience" value={user?.optional?.leadership ?? ""} onChange={(v) => setOptional({ leadership: v })} placeholder="Captain, president, lead organizer, founder…" />
          <Textarea label="Sports" value={user?.optional?.sports ?? ""} onChange={(v) => setOptional({ sports: v })} placeholder="Teams, varsity/club, captaincy…" />
          <Textarea label="Articles published" value={user?.optional?.articlesPublished ?? ""} onChange={(v) => setOptional({ articlesPublished: v })} placeholder="Titles, outlets, links…" />
          <Textarea label="Projects" value={user?.optional?.projects ?? ""} onChange={(v) => setOptional({ projects: v })} placeholder="Personal, school, or research projects…" />
        </div>
      </Card>

      <Card className={`${PROFILE_SECTION_CLASS} mt-8`}>
        <SectionLabel>Story prompts (optional)</SectionLabel>
        <p className="text-xs text-muted-foreground mt-1">
          Short reflections you can reuse across scholarship essays.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
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
      educationLevel: "Bachelor",
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
  const hasConcreteResearchContext = [
    graduate.assistantshipStatus,
    graduate.researchOutput,
    graduate.travelNeeds,
  ].some((value) => String(value ?? "").trim());
  if (!hasConcreteResearchContext) return [];
  return [
    {
      id: "research-graduate",
      researchAreas: graduate.researchArea ?? "",
      researchProjects: "",
      publications: graduate.researchOutput ?? "",
      conferences: graduate.travelNeeds ?? "",
      thesisStatus: "",
      assistantshipStatus: graduate.assistantshipStatus ?? "",
      advisorLabDepartment: "",
    },
  ];
}

function hasConcreteResearchEvidence(entry: Partial<ResearchExperienceEntry>) {
  const directEvidence = [
    entry.researchProjects,
    entry.publications,
    entry.conferences,
    entry.thesisStatus,
    entry.assistantshipStatus,
  ].some((value) => String(value ?? "").trim());
  if (directEvidence) return true;

  const researchArea = String(entry.researchAreas ?? "").trim();
  if (/\b(research|thesis|dissertation|lab|laboratory|project|capstone|poster|publication|conference)\b/i.test(researchArea)) {
    return true;
  }

  const advisorLab = String(entry.advisorLabDepartment ?? "").trim();
  return /\b(advisor|principal investigator|pi\b|lab|laboratory|research group)\b/i.test(advisorLab);
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

function normalizeEducationLevelLabel(value?: string) {
  const text = value?.trim() ?? "";
  if (!text) return "";
  if (/^high school$/i.test(text)) return "High School";
  if (/^associate'?s?( degree)?$/i.test(text)) return "Associate Degree";
  if (/^undergrad(uate)?$/i.test(text)) return "Bachelor's Degree";
  if (/^bachelor'?s?( degree)?$/i.test(text)) return "Bachelor's Degree";
  if (/^master'?s?( degree)?$/i.test(text)) return "Master's Degree";
  if (/^masters?\b/i.test(text)) return "Master's Degree";
  if (/^(phd|ph\.d\.?|doctoral|doctorate)( degree)?$/i.test(text)) return "Doctoral Degree";
  if (/^professional degree/i.test(text)) return "Professional Degree (JD, MD, DDS, etc.)";
  return text;
}

function educationLevelLabelFromCode(value?: string) {
  switch (value) {
    case "high_school":
      return "High School";
    case "undergrad":
      return "Bachelor's Degree";
    case "grad":
      return "Master's Degree";
    case "phd":
      return "Doctoral Degree";
    default:
      return "";
  }
}

function inferEducationLevelLabel(entry: Partial<EducationHistoryEntry>) {
  const text = [
    entry.educationLevel,
    entry.degreeProgram,
    entry.majorField,
    entry.institution,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!text) return "";
  if (/\b(jd|j\.d\.?|md|m\.d\.?|dds|d\.d\.s\.?|dvm|pharmd|pharm\.d\.?)\b/.test(text)) {
    return "Professional Degree (JD, MD, DDS, etc.)";
  }
  if (/\b(phd|ph\.d|doctorate|doctoral)\b/.test(text)) return "Doctoral Degree";
  if (/\b(master|masters|m\.s\.?|ms|m\.a\.?|ma|mba|mfa|mph)\b/.test(text)) return "Master's Degree";
  if (/\b(bachelor|b\.s\.?|bs|b\.a\.?|ba|bba|undergrad|undergraduate)\b/.test(text)) return "Bachelor's Degree";
  if (/\b(associate|a\.a\.?|aa|a\.s\.?|as)\b/.test(text)) return "Associate Degree";
  if (/\b(high school|secondary school|diploma)\b/.test(text)) return "High School";
  return "";
}

function inferMajorField(value?: string) {
  const text = value?.trim() ?? "";
  if (!text) return "";

  const patterns = [
    /\b(?:master'?s?|masters|m\.s\.?|ms|m\.a\.?|ma)\s+(?:degree\s+)?(?:in|of)\s+(.+)$/i,
    /\b(?:bachelor'?s?|bachelors|b\.s\.?|bs|b\.a\.?|ba|bba)\s+(?:degree\s+)?(?:in|of)\s+(.+)$/i,
    /\b(?:associate'?s?|associates|a\.a\.?|aa|a\.s\.?|as)\s+(?:degree\s+)?(?:in|of)\s+(.+)$/i,
    /\b(?:phd|ph\.d\.?|doctorate|doctoral)\s+(?:degree\s+)?(?:in|of)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const field = match?.[1]?.trim();
    if (field) return field.replace(/[,.]$/, "");
  }

  return "";
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
    <Card className={PROFILE_SECTION_CLASS}>
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

      <div className="mt-4 space-y-3">
        {entries.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
            No education entries yet. Add an education entry or upload a resume to autofill this section.
          </div>
        )}
        {entries.map((entry, index) => (
          <div key={entry.id} className={PROFILE_ENTRY_CLASS}>
            <div className="mb-3 flex items-center justify-between gap-3">
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
                options={[
                  "High School",
                  "Associate Degree",
                  "Bachelor's Degree",
                  "Master's Degree",
                  "Doctoral Degree",
                  "Professional Degree (JD, MD, DDS, etc.)",
                  "Other",
                ]}
              />
              <Input label="Institution" value={entry.institution ?? ""} onChange={(value) => onChange(entry.id, { institution: value })} />
              <Input label="Major / field" value={entry.majorField ?? ""} onChange={(value) => onChange(entry.id, { majorField: value })} />
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
    <Card className={PROFILE_SECTION_CLASS}>
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
        <div className="mt-4 space-y-3">
          {entries.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              Optional for high school and undergraduate profiles. Add research details if they strengthen your scholarship fit.
            </div>
          )}
          {entries.map((entry, index) => (
            <div key={entry.id} className={PROFILE_ENTRY_CLASS}>
              <div className="mb-3 flex items-center justify-between gap-3">
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
    <Card className={PROFILE_SECTION_CLASS}>
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

      <div className="mt-4 space-y-3">
        {entries.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
            No experience entries yet. Add roles manually, or upload a resume to extract experience from it.
          </div>
        )}
        {entries.map((entry, index) => (
          <div key={entry.id} className={PROFILE_ENTRY_CLASS}>
            <div className="mb-3 flex items-center justify-between gap-3">
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

function StepDiscovery({
  onUpdateProfile,
  onUseSource,
}: {
  onUpdateProfile: () => void;
  onUseSource: () => void;
}) {
  const { user, updateProfile } = useUser();
  const wiki = user?.wikiDiscovery;
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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

  function copyText(value: string) {
    void navigator.clipboard?.writeText(value);
    setStatus("Copied.");
  }

  function useSourceForExtraction(source: {
    name?: string;
    url?: string;
    category?: string;
    status_note?: string;
    why_recommended?: string;
    award_amount?: string;
    deadline_window?: string;
    competitiveness?: string;
    search_tips?: string[];
    suggested_queries?: string[];
  }) {
    updateProfile({
      activeScholarship: {
        ...(user?.activeScholarship ?? {}),
        name: source.name ?? "",
        url: source.url ?? "",
        additionalNotes: [
          source.category && `Source category: ${source.category}`,
          source.award_amount && `Award amount: ${source.award_amount}`,
          source.deadline_window && `Deadline window: ${source.deadline_window}`,
          source.competitiveness && `Ranking / likelihood signal: ${source.competitiveness}`,
          source.why_recommended && `Why Scholar-E recommended it: ${source.why_recommended}`,
          source.status_note,
          ...(source.search_tips ?? []).map((tip) => `Search tip: ${tip}`),
          ...(source.suggested_queries ?? []).map((query) => `Suggested query: ${query}`),
        ].filter(Boolean).join("\n"),
      },
    });
    onUseSource();
  }

  const hasWiki = !!wiki;
  const directSources = wiki?.specific_opportunities?.slice(0, 5) ?? [];
  const platformSources = wiki?.top_free_platforms?.slice(0, 5) ?? [];
  const profileSummary = wiki?.profile_summary ?? {};

  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Scholarship Discovery Wiki</div>
            <h2 className="mt-2 max-w-3xl font-display text-[42px] font-extrabold leading-[0.98] tracking-tight">
              Search scholarships from your profile.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground/85">
              Scholar-E recommends trusted platforms, source pages, funding categories, and search queries based on your profile.
            </p>
            <div className="mt-5 grid max-w-xl grid-cols-3 gap-3">
              <div className="rounded-lg border border-border/60 bg-white/60 p-3">
                <div className="text-2xl font-bold">{directSources.length || "-"}</div>
                <div className="text-xs text-muted-foreground">Direct sources</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-white/60 p-3">
                <div className="text-2xl font-bold">{platformSources.length || "-"}</div>
                <div className="text-xs text-muted-foreground">Platforms</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-white/60 p-3">
                <div className="text-2xl font-bold">{wiki?.personalized_search_queries?.length || "-"}</div>
                <div className="text-xs text-muted-foreground">Searches</div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={refreshWiki} disabled={loading} className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40">
              {loading ? "Searching..." : "Search"}
            </button>
            <button onClick={onUpdateProfile} className="rounded-full border border-border bg-card px-4 py-2 text-sm hover:bg-accent">
              Update profile
            </button>
          </div>
        </div>
        {status && <p className="mt-3 text-xs text-muted-foreground">{status}</p>}
        {!wiki && !loading && (
          <div className="mt-5 rounded-lg border border-dashed border-border bg-white/60 p-4">
            <div className="font-medium">Ready to search from your saved profile</div>
            <p className="mt-1 text-sm text-muted-foreground/85">
              Click Search to generate profile-specific scholarship sources. Results appear after the Wiki agents finish.
            </p>
          </div>
        )}
      </div>

      {hasWiki && <section>
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Profile used for discovery</div>
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(profileSummary).map(([key, value]) => (
            <div key={key} className="rounded-lg border border-border/60 bg-white/60 p-3">
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
      </section>}

      {hasWiki && (
        <div className="space-y-8">
          <section>
            <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Top 5 direct scholarship sources</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Send one into Step 4 with its name, link, and notes filled for requirement extraction.
            </p>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {directSources.map((source) => (
                <WikiSourceCard
                  key={`direct-${source.name}`}
                  source={source}
                  onCopy={copyText}
                  onUseSource={useSourceForExtraction}
                  mode="direct"
                />
              ))}
              {!directSources.length && <p className="text-sm text-muted-foreground">No direct sources matched this profile.</p>}
            </div>
          </section>

          <section>
            <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Top 5 scholarship platforms</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Use these platforms to continue searching for real opportunities.
            </p>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {platformSources.map((source) => (
                <WikiSourceCard
                  key={`platform-${source.name}`}
                  source={{ ...source, cost: "Free" }}
                  onCopy={copyText}
                  mode="platform"
                />
              ))}
              {!platformSources.length && <p className="text-sm text-muted-foreground">No platforms matched this profile.</p>}
            </div>
          </section>
        </div>
      )}

      {hasWiki && <section>
        <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Funding categories</div>
        <div className="mt-4 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(wiki?.funding_categories ?? []).map((category) => (
            <div key={category.category_name} className="rounded-lg border border-border/60 bg-white/60 p-4">
              <div className="font-display text-[18px] font-bold">{category.category_name}</div>
              <p className="mt-2 text-sm text-muted-foreground/85">{category.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(category.best_for ?? []).map((item) => <Pill key={item}>{item}</Pill>)}
              </div>
            </div>
          ))}
        </div>
      </section>}

      {hasWiki && <section>
            <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Personalized search queries</div>
          <div className="mt-4 space-y-2">
            {(wiki?.personalized_search_queries ?? []).slice(0, 3).map((query) => (
              <div key={query} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-white/60 p-3">
                <span className="text-sm">{query}</span>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, "_blank")} className="rounded-full bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:opacity-90">Search</button>
                </div>
              </div>
            ))}
          </div>
      </section>}
    </div>
  );
}

function WikiSourceCard({
  source,
  onCopy,
  onUseSource,
  mode,
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
    award_amount?: string;
    deadline_window?: string;
    competitiveness?: string;
  };
  onCopy: (value: string) => void;
  onUseSource?: (source: {
    name?: string;
    url?: string;
    category?: string;
    status_note?: string;
    why_recommended?: string;
    award_amount?: string;
    deadline_window?: string;
    competitiveness?: string;
    search_tips?: string[];
    suggested_queries?: string[];
  }) => void;
  mode: "direct" | "platform";
}) {
  const metaItems = [
    source.award_amount && { label: "Amount", value: source.award_amount },
    source.deadline_window && { label: "Deadline", value: source.deadline_window },
    source.competitiveness && { label: "Signal", value: source.competitiveness },
  ].filter(Boolean) as { label: string; value: string }[];
  const headerLabel = mode === "direct" ? "Direct source" : source.cost ? `${source.cost} platform` : "Platform";

  return (
    <div className="group flex h-full min-h-[300px] flex-col overflow-hidden rounded-xl border border-border/70 bg-white shadow-sm shadow-black/5 transition-shadow hover:shadow-lg hover:shadow-black/10">
      <div className="bg-primary text-primary-foreground">
        <div className="h-3 bg-gold" />
        <div className="min-h-[88px] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/75">{headerLabel}</div>
              <div className="mt-3 text-xs text-primary-foreground/80">
                {source.category || (mode === "direct" ? "Scholarship source" : "Search platform")}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div>
          <div className="font-display text-xl font-bold leading-tight text-foreground">{source.name}</div>
          {source.cost && <div className="mt-2 text-xs text-muted-foreground">{source.cost}</div>}
        </div>

        {source.why_recommended && (
          <p className="mt-3 text-sm leading-6 text-muted-foreground/90">{source.why_recommended}</p>
        )}

        {!!metaItems.length && (
          <>
            <div className="my-4 border-t border-dashed border-border" />
            <div className="grid gap-2 sm:grid-cols-3">
              {metaItems.map((item) => (
                <div key={item.label} className="rounded-lg border border-border/70 bg-secondary/20 p-2">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{item.label}</div>
                  <div className="mt-1 text-sm font-semibold">{item.value}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {source.status_note && <p className="mt-3 text-xs font-medium text-warning">{source.status_note}</p>}

        {!!source.best_for?.length && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {source.best_for.slice(0, 3).map((item) => <Pill key={item}>{item}</Pill>)}
          </div>
        )}

        {!!source.search_tips?.length && (
          <div className="mt-3 border-t border-border/70 pt-3">
            <ul className="space-y-1 text-xs leading-5 text-muted-foreground">
              {source.search_tips.map((tip) => <li key={tip}>{tip}</li>)}
            </ul>
          </div>
        )}

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {source.url && (
          <button onClick={() => window.open(source.url, "_blank")} className="rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90">
            Open source
          </button>
        )}
        {!!source.suggested_queries?.[0] && mode === "platform" && (
          <button onClick={() => onCopy(source.suggested_queries?.[0] ?? "")} className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-accent">
            Copy query
          </button>
        )}
        {mode === "direct" && (
          <button onClick={() => onUseSource?.(source)} className="rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90">
            Copy query to extractor
          </button>
        )}
      </div>
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
    <section>
      <div className="max-w-3xl font-display text-[42px] font-extrabold leading-[0.98] tracking-tight">Scholarship details for extraction</div>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground/85">
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
    </section>
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
    <section>
      <div className="max-w-3xl font-display text-[42px] font-extrabold leading-[0.98] tracking-tight">Extracted requirements</div>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground/85">
        Review and edit anything the extractor found before analyzing fit.
      </p>

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
        {!!scholarship.missingInformation?.length && (
          <Textarea
            label="Missing information"
            value={listValue(scholarship.missingInformation)}
            onChange={(value) => updateScholarship({ missingInformation: parseList(value) })}
            rows={4}
          />
        )}
      </div>
    </section>
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
          <section>
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
          </section>

          {!fitAnalysis && (
            <section>
              <div className="font-medium">No analysis yet</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Extract and review scholarship requirements, then use Accept and Analyze Fit.
                Scholar-E will compare your profile against the cleaned scholarship requirements.
              </p>
            </section>
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

              <ApplicationReadinessMatrixCard matrix={buildReadinessFallback(fitAnalysis)} />

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

/** Pull the largest 2–5 digit number out of a word-limit string (e.g. "400-500 words" → 500). */
function parseWordTarget(limit?: string): number | null {
  const nums = (limit ?? "").match(/\d{2,5}/g);
  if (!nums?.length) return null;
  return Math.max(...nums.map(Number));
}

/** Overall essay score (0–100) = mean of the readiness-index dimension scores. */
function overallEssayScore(analysis?: AnalysisResult): number | null {
  const scores = Object.values(analysis?.readiness_index ?? {})
    .map((entry) => entry.score)
    .filter((s): s is number => typeof s === "number");
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function scoreColor(score: number): string {
  if (score >= 80) return "var(--success)";
  if (score >= 60) return "var(--warning)";
  return "var(--destructive)";
}

function labelize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function levelWord(score: number): string {
  if (score >= 80) return "Strong — competitive draft";
  if (score >= 60) return "Developing — keep refining";
  return "Needs work — focus on the priorities";
}

/** Grammarly-style circular score badge with a colored ring. */
function ScoreRing({ score, size = 40, stroke = 3.5 }: { score: number | null; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const color = score == null ? "var(--muted-foreground)" : scoreColor(score);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <span
        className="absolute inset-0 grid place-items-center text-[11px] font-semibold tabular-nums"
        style={{ color }}
      >
        {score == null ? "–" : score}
      </span>
    </div>
  );
}

/** Live word/character count with a thin target-progress bar. */
function WordCountMeter({ wordCount, characterCount, target }: { wordCount: number; characterCount: number; target: number | null }) {
  const pct = target ? Math.min(100, Math.round((wordCount / target) * 100)) : 0;
  const over = target ? wordCount > target : false;
  return (
    <div className="hidden flex-col items-end gap-1 sm:flex">
      <div className="flex items-center gap-1.5 text-[12px] tabular-nums text-muted-foreground">
        <span className="font-semibold text-foreground">{wordCount}</span>
        {target ? <span>/ {target} words</span> : <span>words</span>}
        <span className="hidden text-muted-foreground/60 md:inline">· {characterCount} chars</span>
      </div>
      {target && (
        <div className="h-1 w-24 overflow-hidden rounded-full bg-border">
          <div
            className={`h-full rounded-full transition-all duration-300 ${over ? "bg-warning" : "bg-info"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function StepEssayWorkspace({ onBack }: { onBack?: () => void }) {
  const { user, updateProfile } = useUser();
  const editorApiRef = useRef<EssayEditorHandle | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const draft = user?.essayDraft ?? "";
  const essayTitle = user?.essayTitle ?? "";
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).filter(Boolean).length : 0;
  const characterCount = draft.length;
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("outline");
  const [panelOpen, setPanelOpen] = useState(true);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const wordTarget = useMemo(() => parseWordTarget(buildOutlinePayload(user).word_limit), [user]);
  const score = useMemo(() => overallEssayScore(user?.lastAnalysis), [user?.lastAnalysis]);
  const suggestions = useMemo(
    () => analyzeText(draft).filter((s) => !dismissed.has(s.id)),
    [draft, dismissed],
  );

  // Lightweight autosave indicator — the working draft is continuously synced to
  // the store, so treat each settled edit as an autosave checkpoint.
  useEffect(() => {
    if (!draft.trim()) return;
    const id = window.setTimeout(() => setSavedAt(Date.now()), 600);
    return () => window.clearTimeout(id);
  }, [draft]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const savedLabel = (() => {
    if (!savedAt) return "Not saved yet";
    const mins = Math.floor((nowTick - savedAt) / 60000);
    if (mins < 1) return "Saved · just now";
    if (mins === 1) return "Saved · 1m ago";
    if (mins < 60) return `Saved · ${mins}m ago`;
    return `Saved · ${Math.floor(mins / 60)}h ago`;
  })();

  function handleRunningChange(running: boolean) {
    setIsEvaluating(running);
    if (running) {
      setPanelOpen(true);
      setActiveTab("evaluation");
    }
  }

  function acceptSuggestion(s: Suggestion) {
    editorApiRef.current?.accept(s);
  }

  function dismissSuggestion(s: Suggestion) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(s.id);
      return next;
    });
  }

  function revealSuggestion(s: Suggestion) {
    editorApiRef.current?.reveal(s);
  }

  function openHighlights() {
    setPanelOpen(true);
    setActiveTab("highlights");
    if (suggestions[0]) requestAnimationFrame(() => editorApiRef.current?.reveal(suggestions[0]));
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
      score: score ?? undefined,
      savedAt: new Date().toISOString(),
    };
    updateProfile({ drafts: [...prev, newDraft] });
    setSavedAt(Date.now());
  }

  return (
    <div className="relative left-1/2 w-screen -translate-x-1/2 -mt-10 border-t border-border bg-background">
      {/* Zone 1 — slim top bar (Grammarly-style) */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 px-3 md:px-4">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>

          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <input
              type="text"
              value={essayTitle}
              onChange={(e) => updateProfile({ essayTitle: e.target.value })}
              placeholder="Untitled scholarship essay"
              aria-label="Essay title"
              className="w-full truncate border-none bg-transparent p-0 text-[15px] font-semibold leading-tight text-foreground outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={`inline-block size-1.5 rounded-full ${savedAt ? "bg-success" : "bg-muted-foreground/40"}`} />
              {savedLabel}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 md:gap-1.5">
            <WordCountMeter wordCount={wordCount} characterCount={characterCount} target={wordTarget} />
            <div className="mx-1 hidden h-6 w-px bg-border sm:block" />

            <Tooltip>
              <TooltipTrigger asChild>
                <label className="grid size-9 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground">
                  <FileUp className="size-4" />
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
              </TooltipTrigger>
              <TooltipContent>Upload PDF</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={saveAsDraft}
                  disabled={!draft.trim()}
                  aria-label="Save draft"
                  className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:opacity-40"
                >
                  <Save className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Save draft</TooltipContent>
            </Tooltip>

            <CoachRunButton
              label={wordCount < 30 ? "Write more" : "Run evaluation"}
              loadingLabel="Analyzing…"
              disabled={wordCount < 30}
              onStatus={setAnalysisStatus}
              onRunningChange={handleRunningChange}
              className="ml-0.5 rounded-lg bg-info px-3.5 py-2 text-[13px] font-medium text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="ml-1 hidden md:block">
                  <ScoreRing score={score} />
                </div>
              </TooltipTrigger>
              <TooltipContent>{score == null ? "Run an evaluation to get your essay score" : `Essay score: ${score}/100`}</TooltipContent>
            </Tooltip>

            <button
              type="button"
              onClick={() => setPanelOpen((open) => !open)}
              aria-label={panelOpen ? "Hide panel" : "Show panel"}
              className="ml-0.5 hidden size-9 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground lg:grid"
            >
              {panelOpen ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            </button>
          </div>
        </div>

        {(pdfStatus || analysisStatus) && (
          <div className="border-t border-border bg-accent/40 px-4 py-1.5 text-[11px] text-muted-foreground">
            {pdfStatus ?? analysisStatus}
          </div>
        )}
      </header>

      {/* Zone 2 (editor) + Zone 3 (sidebar) */}
      <div className="mx-auto flex max-w-[1440px] flex-col items-stretch lg:flex-row lg:items-start">
        <div className="flex min-h-[60vh] min-w-0 flex-1 flex-col lg:h-[calc(100vh-120px)] lg:min-h-0">
          <div className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col">
            <EssayEditor
              ref={editorApiRef}
              value={draft}
              onChange={(v) => updateProfile({ essayDraft: v })}
              suggestions={suggestions}
              onDismiss={dismissSuggestion}
              onOpenHighlights={openHighlights}
              className="flex-1"
            />
          </div>
        </div>

        {panelOpen && (
          <EssayWorkspacePanel
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isEvaluating={isEvaluating}
            onCollapse={() => setPanelOpen(false)}
            suggestions={suggestions}
            onAccept={acceptSuggestion}
            onDismiss={dismissSuggestion}
            onReveal={revealSuggestion}
          />
        )}
      </div>
    </div>
  );
}

function EssayWorkspacePanel({
  activeTab,
  onTabChange,
  isEvaluating,
  onCollapse,
  suggestions,
  onAccept,
  onDismiss,
  onReveal,
}: {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  isEvaluating: boolean;
  onCollapse: () => void;
  suggestions: Suggestion[];
  onAccept: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
  onReveal: (s: Suggestion) => void;
}) {
  const { user, updateProfile } = useUser();
  const [coveredPoints, setCoveredPoints] = useState<Set<string>>(() => new Set());
  const toggleCovered = (id: string) =>
    setCoveredPoints((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineStatus, setOutlineStatus] = useState<string | null>(null);
  const outlineKey = useMemo(() => {
    const scholarship = user?.activeScholarship ?? {};
    return JSON.stringify({
      scholarshipName: scholarship.name ?? "",
      scholarshipUrl: scholarship.url ?? scholarship.officialWebsite ?? "",
      prompt: scholarship.essayPrompts || scholarship.otherRequiredMaterials || scholarship.requirementsPreview || "",
      requirementsPreview: scholarship.requirementsPreview ?? "",
      updatedAt: scholarship.extractionCompletedAt ?? "",
      profileName: user?.name ?? "",
      educationLevel: user?.educationLevel ?? "",
      careerGoal: user?.careerGoal ?? "",
      highSchool: user?.highSchool ?? {},
      undergrad: user?.undergrad ?? {},
      graduate: user?.graduate ?? {},
      researchExperience: user?.researchExperience ?? [],
      workExperience: user?.workExperience ?? [],
      optional: user?.optional ?? {},
      prompts: user?.prompts ?? {},
    });
  }, [user]);

  async function runOutlineGeneration(force = false) {
    if (!user || outlineLoading) return;
    if (!force && user.personalizedOutline?.generatedForKey === outlineKey) return;
    setOutlineLoading(true);
    setOutlineStatus("Building your personalized outline from the scholarship requirements and your profile...");
    try {
      const result = await generatePersonalizedOutline(buildOutlinePayload(user));
      updateProfile({ personalizedOutline: { ...result, generatedForKey: outlineKey } });
      setOutlineStatus(result.status === "error" ? "A fallback outline is ready." : "Personalized outline ready.");
    } catch (error) {
      setOutlineStatus(error instanceof Error ? error.message : "Could not generate the outline.");
    } finally {
      setOutlineLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "outline") return;
    if (!user) return;
    if (user.personalizedOutline?.generatedForKey === outlineKey) return;
    void runOutlineGeneration(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, outlineKey, user?.personalizedOutline?.generatedForKey]);

  const tabs: Array<{ id: WorkspaceTab; label: string; icon: typeof ListChecks; count?: number }> = [
    { id: "outline", label: "Outline", icon: ListChecks },
    { id: "evaluation", label: "Evaluation", icon: Gauge },
    { id: "highlights", label: "Highlights", icon: Sparkles, count: suggestions.length },
  ];

  return (
    <aside className="w-full shrink-0 border-t border-border bg-card lg:sticky lg:top-[56px] lg:h-[calc(100vh-120px)] lg:w-[380px] lg:overflow-y-auto lg:border-l lg:border-t-0">
      <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-border bg-card/95 p-2 backdrop-blur">
        <div className="flex flex-1 items-center gap-1 rounded-lg bg-muted/60 p-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors duration-150 ${
                  active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
                {tab.count ? (
                  <span className={`grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold ${active ? "bg-info text-white" : "bg-info/15 text-info"}`}>
                    {tab.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse panel"
          className="hidden size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground lg:grid"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div key={activeTab} className="animate-in fade-in slide-in-from-bottom-1 p-3 duration-200">
        {activeTab === "outline" && (
          <PersonalizedOutlinePanel
            outline={user?.personalizedOutline}
            scholarshipName={user?.activeScholarship?.name}
            wordLimit={buildOutlinePayload(user).word_limit}
            loading={outlineLoading}
            status={outlineStatus}
            onRegenerate={() => void runOutlineGeneration(true)}
            covered={coveredPoints}
            onToggleCovered={toggleCovered}
          />
        )}
        {activeTab === "evaluation" && <WorkspaceEvaluationTab isEvaluating={isEvaluating} />}
        {activeTab === "highlights" && (
          <WorkspaceHighlightsTab
            isEvaluating={isEvaluating}
            suggestions={suggestions}
            onAccept={onAccept}
            onDismiss={onDismiss}
            onReveal={onReveal}
          />
        )}
      </div>
    </aside>
  );
}

function outlineToText(outline?: PersonalizedOutlineResult) {
  const data = outline?.outline;
  if (!data) return "";
  const lines = [
    data.outline_title,
    "",
    "Core message:",
    data.thesis_or_core_message,
    "",
    ...(data.sections ?? []).flatMap((section, index) => [
      `Section ${index + 1}: ${section.section_name}`,
      `Purpose: ${section.purpose}`,
      "Suggested content:",
      ...(section.suggested_content ?? []).map((item) => `- ${item}`),
      "Profile evidence to use:",
      ...(section.profile_evidence_to_use ?? []).map((item) => `- ${item}`),
      "Requirements addressed:",
      ...(section.scholarship_requirement_addressed ?? []).map((item) => `- ${item}`),
      section.estimated_word_count ? `Estimated word count: ${section.estimated_word_count}` : "",
      "Coaching notes:",
      ...(section.coaching_notes ?? []).map((item) => `- ${item}`),
      "",
    ]),
    "Recommended opening:",
    data.recommended_opening,
    "",
    "Recommended conclusion:",
    data.recommended_conclusion,
  ];
  return lines.filter(Boolean).join("\n").trim();
}

function MiniList({ items }: { items?: string[] }) {
  const clean = (items ?? []).filter(Boolean);
  if (!clean.length) return <p className="text-sm text-muted-foreground">Not enough information yet.</p>;
  return (
    <ul className="mt-2 space-y-1.5 text-sm text-foreground/85">
      {clean.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/70" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function OutlineCheckRow({
  id,
  label,
  detail,
  covered,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  detail?: string;
  covered: Set<string>;
  onToggle: (id: string) => void;
  children?: React.ReactNode;
}) {
  const done = covered.has(id);
  return (
    <div className="rounded-lg border border-border bg-background p-2.5">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onToggle(id)}
          aria-pressed={done}
          aria-label={done ? "Mark as not covered" : "Mark as covered"}
          className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded border transition-colors duration-150 ${
            done ? "border-success bg-success text-white" : "border-border text-transparent hover:border-info"
          }`}
        >
          <Check className="size-3" />
        </button>
        <div className="min-w-0 flex-1">
          <div className={`text-[13px] font-medium leading-snug ${done ? "text-muted-foreground line-through" : "text-foreground"}`}>{label}</div>
          {detail && <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{detail}</div>}
          {children}
        </div>
      </div>
    </div>
  );
}

function OutlineGroup({
  id,
  title,
  icon: Icon,
  total,
  coveredCount,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: typeof Target;
  total: number;
  coveredCount: number;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex w-full items-center gap-2 bg-accent/40 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-accent/70"
      >
        <Icon className="size-4 text-info" />
        <span className="flex-1 text-[13px] font-semibold">{title}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{coveredCount}/{total}</span>
        <ChevronDown className={`size-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-2 p-2.5">{children}</div>}
    </div>
  );
}

function PersonalizedOutlinePanel({
  outline,
  scholarshipName,
  wordLimit,
  loading,
  status,
  onRegenerate,
  covered,
  onToggleCovered,
}: {
  outline?: PersonalizedOutlineResult;
  scholarshipName?: string;
  wordLimit?: string;
  loading: boolean;
  status?: string | null;
  onRegenerate: () => void;
  covered: Set<string>;
  onToggleCovered: (id: string) => void;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(["core", "strategy", "structure", "keypoints"]));
  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const data = outline?.outline;

  async function copyOutline() {
    const text = outlineToText(outline);
    if (!text) return;
    await navigator.clipboard?.writeText(text);
    setCopyStatus("Copied.");
    window.setTimeout(() => setCopyStatus(""), 1600);
  }

  return (
    <div className="text-foreground">
      <div className="border-b border-border pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-md bg-info/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-info">
              <Sparkles className="size-3.5" />
              Personalized Outline
            </div>
            <div className="mt-2 truncate font-display text-lg font-semibold leading-tight">
              {scholarshipName || "Current scholarship"}
            </div>
            {wordLimit && (
              <div className="mt-2 inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                {wordLimit}
              </div>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onRegenerate}
                disabled={loading}
                className="grid size-9 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                aria-label="Regenerate outline"
              >
                <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{loading ? "Generating outline" : "Regenerate outline"}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {loading && (
        <div className="mt-4 rounded-lg border border-info/20 bg-info/5 p-4 text-sm text-foreground/80">
          <div className="flex items-center gap-2">
            <span className="size-3 animate-spin rounded-full border-2 border-info/30 border-t-info" />
            <span className="font-medium">Building your personalized outline...</span>
          </div>
          <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
            {["Reading scholarship requirements", "Matching profile evidence", "Planning essay strategy", "Reviewing outline coverage"].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-info/70" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {status && (
        <div className="mt-3 rounded-md bg-accent px-3 py-2 text-xs text-muted-foreground">
          {status}
        </div>
      )}

      {!loading && !data && (
        <div className="mt-5 rounded-lg border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
          Add a scholarship prompt or requirement details to generate a personalized outline.
        </div>
      )}

      {data &&
        (() => {
          type Pt = { id: string; label: string; detail?: string };
          const corePoints: Pt[] = [
            { id: "p-core", label: data.outline_title || "Core message", detail: data.thesis_or_core_message },
          ];
          const strategyPoints: Pt[] = [];
          if (outline?.strategy?.recommended_strategy) strategyPoints.push({ id: "p-strat", label: outline.strategy.recommended_strategy });
          if (outline?.strategy?.central_message) strategyPoints.push({ id: "p-central", label: outline.strategy.central_message });
          if (outline?.strategy?.tone_guidance) strategyPoints.push({ id: "p-tone", label: `Tone: ${outline.strategy.tone_guidance}` });
          const sections = data.sections ?? [];
          const structurePoints: Pt[] = sections.map((s, i) => ({ id: `p-sec-${i}`, label: s.section_name || `Section ${i + 1}` }));
          let keyPoints: Pt[] = (outline?.coverage_check ?? []).map((c, i) => ({
            id: `p-kp-${i}`,
            label: c.requirement || `Requirement ${i + 1}`,
            detail: c.where_covered || c.notes || undefined,
          }));
          if (!keyPoints.length) keyPoints = (data.questions_for_student ?? []).map((q, i) => ({ id: `p-q-${i}`, label: q }));
          if (!keyPoints.length) {
            const reqs = Array.from(new Set(sections.flatMap((s) => s.scholarship_requirement_addressed ?? [])));
            keyPoints = reqs.map((r, i) => ({ id: `p-req-${i}`, label: r }));
          }
          const allIds = [...corePoints, ...strategyPoints, ...structurePoints, ...keyPoints].map((p) => p.id);
          const total = allIds.length;
          const coveredCount = allIds.filter((id) => covered.has(id)).length;
          const cc = (pts: Pt[]) => pts.filter((p) => covered.has(p.id)).length;
          const pct = total ? Math.round((coveredCount / total) * 100) : 0;

          return (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-border bg-background p-3">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">Coverage</span>
                  <span className="font-semibold tabular-nums text-foreground">{coveredCount}/{total} covered</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                  <div className="h-full rounded-full bg-info transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </div>

              <OutlineGroup id="core" title="Core Message" icon={Target} total={corePoints.length} coveredCount={cc(corePoints)} open={openGroups.has("core")} onToggle={toggleGroup}>
                {corePoints.map((p) => (
                  <OutlineCheckRow key={p.id} id={p.id} label={p.label} detail={p.detail} covered={covered} onToggle={onToggleCovered} />
                ))}
              </OutlineGroup>

              {!!strategyPoints.length && (
                <OutlineGroup id="strategy" title="Strategy Notes" icon={Lightbulb} total={strategyPoints.length} coveredCount={cc(strategyPoints)} open={openGroups.has("strategy")} onToggle={toggleGroup}>
                  {strategyPoints.map((p) => (
                    <OutlineCheckRow key={p.id} id={p.id} label={p.label} covered={covered} onToggle={onToggleCovered} />
                  ))}
                </OutlineGroup>
              )}

              {!!structurePoints.length && (
                <OutlineGroup id="structure" title="Structure" icon={ClipboardList} total={structurePoints.length} coveredCount={cc(structurePoints)} open={openGroups.has("structure")} onToggle={toggleGroup}>
                  {sections.map((s, i) => (
                    <OutlineCheckRow key={`p-sec-${i}`} id={`p-sec-${i}`} label={s.section_name || `Section ${i + 1}`} detail={s.purpose} covered={covered} onToggle={onToggleCovered}>
                      {!!s.scholarship_requirement_addressed?.length && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {s.scholarship_requirement_addressed.map((item) => (
                            <span key={item} className="rounded bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">{item}</span>
                          ))}
                        </div>
                      )}
                      {!!s.suggested_content?.length && (
                        <ul className="mt-2 space-y-1 text-[12px] text-muted-foreground">
                          {s.suggested_content.slice(0, 3).map((c) => (
                            <li key={c} className="flex gap-1.5">
                              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-info/60" />
                              {c}
                            </li>
                          ))}
                        </ul>
                      )}
                      {s.estimated_word_count && <div className="mt-1.5 text-[11px] text-muted-foreground">~{s.estimated_word_count}</div>}
                    </OutlineCheckRow>
                  ))}
                </OutlineGroup>
              )}

              {!!keyPoints.length && (
                <OutlineGroup id="keypoints" title="Key Points to Hit" icon={ListChecks} total={keyPoints.length} coveredCount={cc(keyPoints)} open={openGroups.has("keypoints")} onToggle={toggleGroup}>
                  {keyPoints.map((p) => (
                    <OutlineCheckRow key={p.id} id={p.id} label={p.label} detail={p.detail} covered={covered} onToggle={onToggleCovered} />
                  ))}
                </OutlineGroup>
              )}

              {(data.recommended_opening || data.recommended_conclusion) && (
                <div className="rounded-xl border border-border bg-background p-3">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Opening &amp; Closing</div>
                  {data.recommended_opening && <p className="mt-2 text-[13px] leading-relaxed"><span className="font-medium">Opening:</span> {data.recommended_opening}</p>}
                  {data.recommended_conclusion && <p className="mt-2 text-[13px] leading-relaxed"><span className="font-medium">Conclusion:</span> {data.recommended_conclusion}</p>}
                </div>
              )}

              {!!outline?.warnings?.length && (
                <div className="rounded-xl border border-warning/30 bg-warning/10 p-3">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-warning">Warnings</div>
                  <MiniList items={outline.warnings} />
                </div>
              )}
              {!!outline?.missing_profile_info?.length && (
                <div className="rounded-xl border border-border bg-background p-3">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Missing Profile Information</div>
                  <MiniList items={outline.missing_profile_info} />
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" onClick={copyOutline} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
                  <Copy className="size-3.5" />
                  Copy outline
                </button>
                {copyStatus && <span className="self-center text-xs text-muted-foreground">{copyStatus}</span>}
              </div>
            </div>
          );
        })()}
    </div>
  );
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{children}</div>;
}

function PanelEmpty({ label, message }: { label: string; message: string }) {
  return (
    <div className="space-y-3">
      <PanelLabel>{label}</PanelLabel>
      <div className="rounded-xl border border-dashed border-border bg-background p-4 text-[13px] leading-relaxed text-muted-foreground">
        {message}
      </div>
    </div>
  );
}

function ReadinessRow({ label, value }: { label: string; value: AnalysisScore }) {
  const [open, setOpen] = useState(false);
  const s = typeof value.score === "number" ? value.score : 0;
  const hasDetail = !!value.coaching?.trim();
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5 text-[13px] font-medium">
          {label}
          {hasDetail && <ChevronDown className={`size-3.5 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />}
        </span>
        <span className="text-[12px] font-semibold tabular-nums" style={{ color: scoreColor(s) }}>
          {s}
        </span>
      </button>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${s}%`, background: scoreColor(s) }} />
      </div>
      {value.level && <div className="mt-1.5 text-[11px] text-muted-foreground">{value.level}</div>}
      {open && hasDetail && (
        <div className="mt-2 border-t border-border pt-2 text-[12px] leading-relaxed text-muted-foreground animate-in fade-in slide-in-from-top-1 duration-150">
          {value.coaching}
        </div>
      )}
    </div>
  );
}

function EvaluationSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-16 w-full rounded-xl" />
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}

function HighlightsSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  );
}

function WorkspaceEvaluationTab({ isEvaluating }: { isEvaluating: boolean }) {
  const { user } = useUser();
  const analysis = user?.lastAnalysis;
  const entries = Object.entries(analysis?.readiness_index ?? {});
  const score = overallEssayScore(analysis);

  if (isEvaluating) return <EvaluationSkeleton />;

  if (!entries.length) {
    return (
      <PanelEmpty
        label="Application Evaluation"
        message="Run an evaluation to see your readiness scores, the coach's message, and the essay alignment matrix."
      />
    );
  }

  return (
    <div className="space-y-3">
      <PanelLabel>Application Evaluation</PanelLabel>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
        <ScoreRing score={score} size={52} stroke={4} />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">Overall essay score</div>
          <div className="text-[12px] text-muted-foreground">{score != null ? levelWord(score) : "Not scored yet"}</div>
        </div>
      </div>
      <div className="space-y-2">
        {entries.map(([key, value]) => (
          <ReadinessRow key={key} label={labelize(key)} value={value} />
        ))}
      </div>
      {analysis?.coaching_brief?.coach_message && (
        <div className="rounded-xl border border-info/20 bg-info/5 p-3 text-[13px] leading-relaxed text-foreground/85">
          {analysis.coaching_brief.coach_message}
        </div>
      )}
      <EssayAlignmentMatrixCard matrix={analysis?.essay_alignment_matrix} />
    </div>
  );
}

function SuggestionCard({
  s,
  onAccept,
  onDismiss,
  onReveal,
}: {
  s: Suggestion;
  onAccept: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
  onReveal: (s: Suggestion) => void;
}) {
  const meta = CATEGORY_META[s.category];
  return (
    <div className={`rounded-lg border border-l-4 border-border bg-background p-2.5 ${meta.borderClass}`}>
      <button type="button" onClick={() => onReveal(s)} className="block w-full text-left" title="Jump to this text in the editor">
        <span className={`text-[11px] font-semibold ${meta.textClass}`}>{s.title}</span>
        <div className="mt-1 text-[12px]">
          <span className="text-muted-foreground line-through decoration-muted-foreground/50">{s.original.trim() || "␠"}</span>
          <span className="mx-1 text-muted-foreground">→</span>
          <span className="font-medium text-foreground">{s.replacement.trim() || "(removed)"}</span>
        </div>
      </button>
      <div className="mt-2 flex items-center gap-1.5">
        <button type="button" onClick={() => onAccept(s)} className="flex-1 rounded-md bg-info px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90">
          Accept
        </button>
        <button type="button" onClick={() => onDismiss(s)} className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          Dismiss
        </button>
      </div>
    </div>
  );
}

function WorkspaceHighlightsTab({
  isEvaluating,
  suggestions,
  onAccept,
  onDismiss,
  onReveal,
}: {
  isEvaluating: boolean;
  suggestions: Suggestion[];
  onAccept: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
  onReveal: (s: Suggestion) => void;
}) {
  const { user } = useUser();
  const analysis = user?.lastAnalysis;
  const priorities = analysis?.revision_priorities ?? [];
  const reviewers = analysis?.reviewer_comments ?? [];
  const strengths = analysis?.essay_alignment_matrix?.strengths ?? [];
  const counts = countByCategory(suggestions);
  const hasBackend = priorities.length || reviewers.length || strengths.length;

  if (isEvaluating) return <HighlightsSkeleton />;

  if (!suggestions.length && !hasBackend) {
    return (
      <PanelEmpty
        label="Review Highlights"
        message="As you write, inline suggestions appear here grouped by type. Run an evaluation for deeper coach feedback."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <PanelLabel>Review Highlights</PanelLabel>
        <span className="text-[12px] font-semibold text-muted-foreground">{suggestions.length} open</span>
      </div>

      {!suggestions.length && (
        <div className="rounded-xl border border-success/20 bg-success/5 p-3 text-[13px] text-success">
          No inline writing suggestions — this draft reads clean.
        </div>
      )}

      {CATEGORY_ORDER.filter((cat) => counts[cat] > 0).map((cat) => {
        const meta = CATEGORY_META[cat];
        const items = suggestions.filter((s) => s.category === cat);
        return (
          <div key={cat} className="space-y-2">
            <div className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${meta.dotClass}`} />
              <span className="text-[12px] font-semibold">{meta.label}</span>
              <span className="text-[11px] text-muted-foreground">· {items.length}</span>
            </div>
            {items.map((s) => (
              <SuggestionCard key={s.id} s={s} onAccept={onAccept} onDismiss={onDismiss} onReveal={onReveal} />
            ))}
          </div>
        );
      })}

      {!!hasBackend && (
        <div className="space-y-3 border-t border-border pt-3">
          {!!priorities.length && (
            <div className="rounded-xl border border-warning/25 bg-warning/5 p-3">
              <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-warning">Top revision priorities</div>
              <ol className="mt-2 space-y-1.5 text-[13px] leading-relaxed">
                {priorities.slice(0, 4).map((item, i) => (
                  <li key={item} className="flex gap-2">
                    <span className="font-semibold text-warning">{i + 1}.</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {!!strengths.length && (
            <div className="rounded-xl border border-success/20 bg-success/5 p-3">
              <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-success">Working well</div>
              <MiniList items={strengths} />
            </div>
          )}

          {!!reviewers.length && (
            <div className="space-y-2">
              <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Reviewer reactions</div>
              {reviewers.map((reviewer, i) => (
                <div key={`${reviewer.persona}-${i}`} className="rounded-lg border border-border bg-background p-3">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                    <MessageSquare className="size-3.5 text-info" />
                    {reviewer.persona ?? "Reviewer"}
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/85">{reviewer.comment}</p>
                </div>
              ))}
            </div>
          )}
        </div>
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

      <EssayAlignmentMatrixCard matrix={analysis.essay_alignment_matrix} />
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
