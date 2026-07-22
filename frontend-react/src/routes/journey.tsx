import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import scholarELogoUrl from "../../logo/logoPic.jpeg";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  FileUp,
  FlaskConical,
  Gauge,
  GraduationCap,
  Lightbulb,
  LineChart,
  ListChecks,
  Lock,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Plus,
  Power,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wand2,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { EssayEditor, type EssayEditorHandle, type RewriteAction } from "@/components/EssayEditor";
import {
  analyzeText,
  anchorCoachSuggestions,
  applySuggestion,
  CATEGORY_META,
  CATEGORY_ORDER,
  countByCategory,
  mergeSuggestions,
  type CoachSentenceSuggestion,
  type Suggestion,
} from "@/lib/suggestions";
import { essayDraft as exampleEssayDraft, journeySteps } from "@/lib/persona";
import { getFile, removeFile, storeFile } from "@/lib/fileStore";
import { Spinner } from "@/components/Spinner";
import { AcademicOnboarding } from "@/components/AcademicOnboarding";
import {
  analyzeScholarshipFit,
  autofillProfileFromResume,
  buildCoachingSessionPayload,
  buildEditorCheckPayload,
  buildFitPayload,
  buildOutlinePayload,
  buildOutlinePoints,
  buildWikiPayload,
  discoverScholarshipWiki,
  buildRewritePayload,
  extractPromptWordLimits,
  extractScholarshipOpportunity,
  generatePersonalizedOutline,
  runEditorCheck,
  runSelectionRewrite,
  runWorkspaceCoachingSession,
  normalizeEssayPromptEntries,
  normalizeSelectedEssayPromptEntries,
  serializeEssayPromptEntries,
} from "@/lib/api/scholarE";
import {
  useUser,
  initials as toInitials,
  type EducationLevel,
  type EducationHistoryEntry,
  type ResearchExperienceEntry,
  type WorkExperienceEntry,
  type UserProfile,
  type EssayCriterionReview,
  type EssayDraft,
  type EssayReviewResult,
  type ActiveScholarship,
  type EssayPromptEntry,
  type WikiDiscoveryResult,
  type ApplicationReadinessMatrix,
  type FitAnalysisResult,
  type PersonalizedOutlineResult,
  type ApplicationStatus,
  type TrackedApplication,
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
  DialogFooter,
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

const SIDEBAR_MIN_WIDTH = 232;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 288;
const SIDEBAR_WIDTH_KEY = "scholar-e:sidebarWidth";

function needsAcademicOnboarding(user: UserProfile | null) {
  return !!(
    user &&
    !user.academicOnboardingCompleted &&
    !user.educationLevel &&
    !user.educationHistory?.some((entry) => entry.educationLevel?.trim()) &&
    !user.optional?.resumeFileName
  );
}

function Journey() {
  const { user, isHydrated, updateProfile, resetProfile } = useUser();
  const [stepIdx, setStepIdx] = useState(0);
  const [profileError, setProfileError] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [academicOnboardingActive, setAcademicOnboardingActive] = useState<boolean | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const guidedSidebarExpanded = useRef(false);
  const [journeyTutorialActive, setJourneyTutorialActive] = useState(false);
  const journeyMainRef = useRef<HTMLElement | null>(null);
  const accountIdentity = user?.email || (user ? "guest-profile" : "anonymous");

  useEffect(() => {
    if (!isHydrated) return;
    setAcademicOnboardingActive(needsAcademicOnboarding(user));
    setShowResumePrompt(false);
    // Re-evaluate only when the active account changes, not while its onboarding answers save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountIdentity, isHydrated]);

  // Keep the Journey navigation expanded by default on layouts with room for it.
  // After this initial setup, only the user's collapse/expand controls change it.
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) setIsSidebarOpen(true);
  }, []);

  useEffect(() => {
    if (!isHydrated || !user?.journeyTutorialPending) return;
    if (user.journeyTutorialCompleted || user.journeyTutorialSkipped) return;
    setStepIdx(0);
    setIsSidebarOpen(true);
    setJourneyTutorialActive(true);
  }, [isHydrated, user?.journeyTutorialPending, user?.journeyTutorialCompleted, user?.journeyTutorialSkipped]);

  useEffect(() => {
    if (academicOnboardingActive !== false || !showResumePrompt) return;
    const frame = window.requestAnimationFrame(() => setShowResumePrompt(false));
    return () => window.cancelAnimationFrame(frame);
  }, [academicOnboardingActive, showResumePrompt]);

  // Restore the user's chosen sidebar width (client-only; SSR-safe).
  useEffect(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH) setPanelWidth(saved);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(panelWidth));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [panelWidth]);

  // Resume the last step once the saved profile hydrates from storage.
  const restoredStep = useRef(false);
  useEffect(() => {
    if (restoredStep.current || !user) return;
    restoredStep.current = true;
    if (typeof user.lastStep === "number" && user.lastStep > 0 && user.lastStep < journeySteps.length) {
      setStepIdx(user.lastStep);
    }
  }, [user]);
  useEffect(() => {
    if (!restoredStep.current || !user || user.lastStep === stepIdx) return;
    updateProfile({ lastStep: stepIdx });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx]);

  function handleClearAll() {
    resetProfile();
    setStepIdx(0);
    setProfileError("");
  }

  const guidedProfileSetupActive = !!(
    user?.profileStartChoiceCompleted &&
    !user?.profileSetupCompleted
  );
  const visibleStepIdx = guidedProfileSetupActive ? 0 : stepIdx;
  const step = journeySteps[visibleStepIdx];

  useEffect(() => {
    if (!guidedProfileSetupActive) {
      guidedSidebarExpanded.current = false;
      return;
    }
    if (guidedSidebarExpanded.current) return;
    guidedSidebarExpanded.current = true;
    setStepIdx(0);
    if (window.matchMedia("(min-width: 768px)").matches) setIsSidebarOpen(true);
  }, [guidedProfileSetupActive]);

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
    if (journeyTutorialActive || (guidedProfileSetupActive && idx > 0)) return;
    setStepIdx(idx);
  };
  const goToStep = (slug: string) => {
    const nextIndex = journeySteps.findIndex((item) => item.slug === slug);
    if (nextIndex >= 0) selectStep(nextIndex);
  };

  function startJourneyTutorial() {
    setStepIdx(0);
    setIsSidebarOpen(true);
    setJourneyTutorialActive(true);
  }

  function closeJourneyTutorial(skipped: boolean) {
    updateProfile({
      journeyTutorialPending: false,
      journeyTutorialCompleted: !skipped,
      journeyTutorialSkipped: skipped,
    });
    setJourneyTutorialActive(false);
    setStepIdx(1);
    window.requestAnimationFrame(() => journeyMainRef.current?.focus());
  }

  if (!isHydrated || academicOnboardingActive === null) {
    return <div className="min-h-screen bg-[linear-gradient(180deg,#f9faff_0%,#f3f5fb_100%)]" />;
  }

  if (academicOnboardingActive && user) {
    return (
      <AcademicOnboarding
        open
        user={user}
        updateProfile={updateProfile}
        onComplete={() => {
          setStepIdx(0);
          setAcademicOnboardingActive(false);
          setShowResumePrompt(true);
        }}
      />
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className="flex h-screen overflow-hidden"
        style={{ ["--sw" as string]: `${panelWidth}px` } as React.CSSProperties}
      >
        <SidebarRail
          activeIdx={visibleStepIdx}
          laterStepsLocked={guidedProfileSetupActive}
          onSelect={selectStep}
          onExpand={() => setIsSidebarOpen(true)}
        />
        <Sidebar
          activeIdx={visibleStepIdx}
          laterStepsLocked={guidedProfileSetupActive}
          tutorialActive={journeyTutorialActive}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          onSelect={(idx) => {
            selectStep(idx);
            if (!window.matchMedia("(min-width: 768px)").matches) setIsSidebarOpen(false);
          }}
          onClearAll={handleClearAll}
          onResize={(w) => setPanelWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w)))}
          onResizeActive={setSidebarDragging}
        />
        <div
          className={`flex w-full min-w-0 flex-col ${
            sidebarDragging ? "" : "transition-[padding] duration-300 ease-out"
          } ${isSidebarOpen ? "md:pl-[var(--sw)]" : "md:pl-[65px]"}`}
        >
          <TopBar step={step} stepIdx={visibleStepIdx} guidedProfileSetupActive={guidedProfileSetupActive} />
          <FloatingSidebarToggle
            isOpen={isSidebarOpen}
            onOpen={() => setIsSidebarOpen(true)}
          />
          <main ref={journeyMainRef} tabIndex={-1} className={`min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto outline-none transition-colors duration-500 ${
            step.slug === "discovery"
              ? "bg-[radial-gradient(circle_at_85%_8%,rgba(109,93,246,0.10),transparent_28%),linear-gradient(180deg,#f4f6fb_0%,#ffffff_48%,#f4f2fb_100%)]"
              : ""
          }`}>
            <div
              className={`mx-auto ${
                step.slug === "essay-workspace"
                  ? "w-full max-w-none px-0 py-0"
                  : `px-6 md:px-10 ${
                      ["discovery", "requirements"].includes(step.slug)
                        ? "max-w-7xl py-6"
                        : step.slug === "profile"
                          ? "max-w-7xl py-10"
                          : "max-w-5xl py-10"
                    }`
              }`}
            >
              <div>
              <StepBody
                slug={step.slug}
                goNext={goNext}
                goPrev={goPrev}
                goToProfile={() => setStepIdx(Math.max(0, journeySteps.findIndex((s) => s.slug === "profile")))}
                goToRequirements={() => setStepIdx(Math.max(0, journeySteps.findIndex((s) => s.slug === "requirements")))}
                goToStep={goToStep}
                profileError={profileError}
                startProfilePrompt={showResumePrompt}
                onProfileSetupComplete={startJourneyTutorial}
              />
              </div>
            </div>
          </main>
          {!guidedProfileSetupActive && <footer className="shrink-0 border-t border-border bg-background/95 px-6 backdrop-blur md:px-10">
            <div className="mx-auto max-w-7xl">
              <Nav
                stepIdx={stepIdx}
                onNext={goNext}
                onPrev={goPrev}
                hideNext={step.slug === "discovery"}
              />
            </div>
          </footer>}
        </div>
        {journeyTutorialActive && (
          <JourneyNavigationTutorial
            onFinish={() => closeJourneyTutorial(false)}
            onSkip={() => closeJourneyTutorial(true)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

function isProfileComplete(user: UserProfile | null) {
  return !!(
    isRequiredAboutComplete(user) &&
    (user.educationHistory?.some((entry) => entry.educationLevel?.trim()) || user.educationLevel)
  );
}

function getRequiredAboutCompletion(user: UserProfile | null) {
  const requiredFields = [
    !!user?.gender?.trim(),
    !!user?.location?.trim(),
    !!user?.citizenshipStatus?.trim(),
    !!user?.raceEthnicity,
  ];

  return {
    completed: requiredFields.filter(Boolean).length,
    total: requiredFields.length,
  };
}

function isRequiredAboutComplete(user: UserProfile | null) {
  const completion = getRequiredAboutCompletion(user);
  return completion.completed === completion.total;
}

function Sidebar({
  activeIdx,
  laterStepsLocked,
  tutorialActive,
  isOpen,
  onClose,
  onSelect,
  onClearAll,
  onResize,
  onResizeActive,
}: {
  activeIdx: number;
  laterStepsLocked: boolean;
  tutorialActive: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (i: number) => void;
  onClearAll: () => void;
  onResize: (width: number) => void;
  onResizeActive: (active: boolean) => void;
}) {
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    onResizeActive(true);
    const onMove = (ev: MouseEvent) => onResize(ev.clientX);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      onResizeActive(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

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
        className={`fixed inset-0 z-30 bg-background/60 transition-opacity duration-300 md:hidden ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />
      <aside
        data-journey-sidebar
        className={`fixed inset-y-0 left-0 z-40 flex w-80 max-w-[85vw] shrink-0 flex-col border-r border-border bg-card/95 backdrop-blur transition-transform duration-300 ease-out md:w-[var(--sw)] md:max-w-none ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 px-5 h-14 border-b border-border">
          <Link to="/" className="flex min-w-0 flex-1 items-center gap-2">
            <img src={scholarELogoUrl} alt="" className="size-7 rounded-full object-cover" />
            <div className="text-sm font-display font-semibold tracking-tight">Scholar-E</div>
            <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground">journey</span>
          </Link>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Collapse sidebar"
                aria-disabled={tutorialActive || undefined}
                data-sidebar-collapse
                onClick={() => { if (!tutorialActive) onClose(); }}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-[background-color,color,box-shadow,transform] hover:bg-accent hover:text-foreground data-[tutorial-highlight=true]:ring-2 data-[tutorial-highlight=true]:ring-info/60"
              >
                <PanelLeftClose className="size-5" strokeWidth={2} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Collapse sidebar</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {groups.map(([group, steps]) => (
            <div key={group} data-journey-group={group}>
              <div className="px-3 text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{group}</div>
              <div className="space-y-0.5">
                {steps.map((s) => {
                  const idx = journeySteps.findIndex((x) => x.id === s.id);
                  const isActive = idx === activeIdx;
                  const isDone = idx < activeIdx;
                  const isLocked = laterStepsLocked && idx > 0;
                  return (
                    <Tooltip key={s.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => { if (!isLocked) onSelect(idx); }}
                          aria-disabled={isLocked || undefined}
                          aria-label={isLocked ? `${s.title}. Complete your profile to unlock this step.` : s.title}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-[13px] transition-colors ${
                            isActive
                              ? "bg-info/10 text-info"
                              : isLocked
                                ? "cursor-not-allowed text-muted-foreground opacity-55"
                                : "hover:bg-accent text-foreground/80"
                          }`}
                        >
                          <span
                            className={`relative size-6 shrink-0 rounded-md grid place-items-center ${
                              isActive
                                ? "bg-info text-white"
                                : isDone
                                ? "bg-success/20 text-success"
                                : "bg-secondary text-muted-foreground"
                            }`}
                          >
                            <span className="text-xs font-bold tabular-nums">{idx + 1}</span>
                            {isDone && (
                              <span className="absolute -bottom-0.5 -right-0.5 grid size-3 place-items-center rounded-full bg-success text-white ring-2 ring-card">
                                <Check className="size-2" strokeWidth={4} />
                              </span>
                            )}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{s.title}</span>
                          {isLocked && <Lock className="size-3.5 shrink-0" aria-hidden="true" />}
                        </button>
                      </TooltipTrigger>
                      {isLocked && <TooltipContent side="right">Complete your profile to unlock this step.</TooltipContent>}
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border px-6 py-4">
          <SidebarUser />
        </div>

        <div className="border-t border-border px-6 py-3">
          <button
            type="button"
            onClick={onClearAll}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-destructive"
          >
            <RefreshCw className="size-3.5" />
            Reset all data
          </button>
          <div className="mt-2 text-[11px] text-muted-foreground/60">A coach, not a ghostwriter.</div>
        </div>

        {/* Drag-to-resize handle (desktop). Widens/narrows the panel; width persists. */}
        <div
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          className="group absolute inset-y-0 -right-1 hidden w-2 cursor-col-resize md:block"
        >
          <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-info/60" />
        </div>
      </aside>
    </>
  );
}

const JOURNEY_TUTORIAL_STEPS = [
  {
    group: "Sidebar",
    title: "Your Journey in Scholar-E",
    description: "Use the Journey sidebar to move through each stage of your application process, from discovering opportunities to tracking submissions.",
    tip: "Tip: You can collapse the sidebar anytime to create more workspace.",
  },
  {
    group: "Analyze",
    title: "Understand your fit",
    description: "Review eligibility requirements and see how well each opportunity aligns with your profile.",
    tip: "",
  },
  {
    group: "Apply",
    title: "Build a stronger application",
    description: "Draft, review, and improve your essays while keeping your own voice and experiences at the center.",
    tip: "",
  },
  {
    group: "Track",
    title: "Stay ready and organized",
    description: "Confirm your application materials are complete and keep track of your submissions and progress.",
    tip: "",
  },
] as const;

function JourneyNavigationTutorial({
  onFinish,
  onSkip,
}: {
  onFinish: () => void;
  onSkip: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState({ left: 8, top: 8, width: 240, height: 100 });
  const [compact, setCompact] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const exitTimer = useRef<number | null>(null);
  const collapseAnimationPlayed = useRef(false);
  const step = JOURNEY_TUTORIAL_STEPS[stepIndex];

  useEffect(() => {
    cardRef.current?.focus();
  }, [stepIndex]);

  useEffect(() => {
    if (stepIndex !== 0) return;
    const collapseButton = document.querySelector<HTMLElement>("[data-sidebar-collapse]");
    if (!collapseButton) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) collapseButton.dataset.tutorialHighlight = "true";
    if (!reduceMotion && !collapseAnimationPlayed.current) {
      collapseAnimationPlayed.current = true;
      collapseButton.animate(
        [
          { transform: "scale(1)", boxShadow: "0 0 0 0 rgba(109, 93, 246, 0)", offset: 0 },
          { transform: "scale(1.05)", boxShadow: "0 0 0 6px rgba(109, 93, 246, 0.22)", offset: 0.3 },
          { transform: "scale(1.05)", boxShadow: "0 0 0 6px rgba(109, 93, 246, 0.22)", offset: 0.65 },
          { transform: "scale(1)", boxShadow: "0 0 0 0 rgba(109, 93, 246, 0)", offset: 1 },
        ],
        { duration: 1200, iterations: 1, easing: "ease-in-out" },
      );
    }
    return () => {
      delete collapseButton.dataset.tutorialHighlight;
    };
  }, [stepIndex]);

  useEffect(() => {
    const keepFocusInTutorial = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        return;
      }
      if (event.key !== "Tab" || !cardRef.current) return;
      const focusable = Array.from(
        cardRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"),
      );
      if (!focusable.length) {
        event.preventDefault();
        cardRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keepFocusInTutorial);
    return () => document.removeEventListener("keydown", keepFocusInTutorial);
  }, []);

  useEffect(() => {
    let frame = 0;
    const startedAt = window.performance.now();
    const measure = () => {
      const target = document.querySelector<HTMLElement>(
        stepIndex === 0 ? "[data-journey-sidebar]" : `[data-journey-group="${step.group}"]`,
      );
      if (target) {
        target.scrollIntoView({ block: "nearest" });
        const rect = target.getBoundingClientRect();
        const padding = 12;
        setSpotlight({
          left: Math.max(8, rect.left - padding),
          top: Math.max(8, rect.top - padding),
          width: Math.min(window.innerWidth - 16, rect.width + padding * 2),
          height: Math.min(window.innerHeight - 16, rect.height + padding * 2),
        });
      }
      setCompact(window.innerWidth < 768);
      if (window.performance.now() - startedAt < 400) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step.group, stepIndex]);

  useEffect(() => () => {
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
  }, []);

  function close(callback: () => void) {
    setLeaving(true);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    exitTimer.current = window.setTimeout(callback, reduceMotion ? 0 : 200);
  }

  const cardWidth = compact ? window.innerWidth - 32 : Math.min(352, window.innerWidth - 32);
  const cardStyle: React.CSSProperties = compact
    ? { left: 16, right: 16, bottom: 16 }
    : {
        left: Math.min(spotlight.left + spotlight.width + 20, window.innerWidth - cardWidth - 16),
        top: Math.max(16, Math.min(spotlight.top, window.innerHeight - 300)),
        width: cardWidth,
      };

  return (
    <div className={`fixed inset-0 z-50 transition-opacity duration-200 motion-reduce:transition-none ${leaving ? "opacity-0" : "opacity-100"}`}>
      <div className="absolute inset-0 pointer-events-auto" aria-hidden="true" />
      <div
        className="pointer-events-none fixed rounded-2xl border border-info/60 shadow-[0_0_0_9999px_rgba(20,28,48,0.46),0_10px_30px_rgba(31,42,68,0.22)] transition-[left,top,width,height] duration-300 ease-out motion-reduce:transition-none"
        style={spotlight}
        aria-hidden="true"
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="journey-tutorial-title"
        aria-describedby="journey-tutorial-description"
        tabIndex={-1}
        className="fixed z-10 rounded-2xl border border-border bg-card p-5 shadow-xl outline-none motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
        style={cardStyle}
      >
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-info">
          Step {stepIndex + 1} of {JOURNEY_TUTORIAL_STEPS.length}
        </div>
        <h2 id="journey-tutorial-title" className="mt-2 font-display text-xl font-bold">
          {step.title}
        </h2>
        <p id="journey-tutorial-description" className="mt-2 text-sm leading-6 text-muted-foreground">
          {step.description}
        </p>
        {step.tip && (
          <p className="mt-3 rounded-lg bg-secondary/70 px-3 py-2 text-xs leading-5 text-muted-foreground">
            {step.tip}
          </p>
        )}
        <div className="sr-only" aria-live="polite">
          Tutorial step {stepIndex + 1} of {JOURNEY_TUTORIAL_STEPS.length}: {step.group}
        </div>
        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => close(onSkip)}
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Skip Tutorial
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => setStepIndex((current) => current - 1)}
                className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (stepIndex === JOURNEY_TUTORIAL_STEPS.length - 1) close(onFinish);
                else setStepIndex((current) => current + 1);
              }}
              className="rounded-full bg-info px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              {stepIndex === JOURNEY_TUTORIAL_STEPS.length - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const ESSAY_WORKSPACE_TUTORIAL_KEY = "scholar-e:essay-workspace-tutorial:v1";

const ESSAY_WORKSPACE_TUTORIAL_STEPS = [
  {
    target: "upload",
    title: "Upload an existing draft",
    description: "If you have an existing document of your draft, upload it here.",
  },
  {
    target: "editor",
    title: "Start writing here",
    description: "If you do not have an existing draft, start typing or paste your essay here.",
  },
  {
    target: "evaluate",
    title: "Evaluate your draft",
    description: "Select Evaluate to receive scores and specific feedback for every criterion. After each revision, select it again to see how your criterion and overall scores change.",
  },
] as const;

function EssayWorkspaceTutorial({
  onFinish,
  onSkip,
}: {
  onFinish: () => void;
  onSkip: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState({ left: 8, top: 8, width: 56, height: 56 });
  const [compact, setCompact] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const exitTimer = useRef<number | null>(null);
  const step = ESSAY_WORKSPACE_TUTORIAL_STEPS[stepIndex];

  useEffect(() => {
    cardRef.current?.focus();
  }, [stepIndex]);

  useEffect(() => {
    const keepFocusInTutorial = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        return;
      }
      if (event.key !== "Tab" || !cardRef.current) return;
      const focusable = Array.from(
        cardRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"),
      );
      if (!focusable.length) {
        event.preventDefault();
        cardRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keepFocusInTutorial);
    return () => document.removeEventListener("keydown", keepFocusInTutorial);
  }, []);

  useEffect(() => {
    let frame = 0;
    const target = document.querySelector<HTMLElement>(`[data-essay-workspace-tour="${step.target}"]`);
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const startedAt = window.performance.now();
    const measure = () => {
      const currentTarget = document.querySelector<HTMLElement>(`[data-essay-workspace-tour="${step.target}"]`);
      if (currentTarget) {
        const rect = currentTarget.getBoundingClientRect();
        const padding = step.target === "editor" ? 8 : 12;
        const left = Math.max(8, rect.left - padding);
        const top = Math.max(8, rect.top - padding);
        const right = Math.min(window.innerWidth - 8, rect.right + padding);
        const bottom = Math.min(window.innerHeight - 8, rect.bottom + padding);
        setSpotlight({
          left,
          top,
          width: Math.max(48, right - left),
          height: Math.max(48, bottom - top),
        });
      }
      setCompact(window.innerWidth < 768);
      if (window.performance.now() - startedAt < 450) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step.target]);

  useEffect(() => () => {
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
  }, []);

  function close(callback: () => void) {
    setLeaving(true);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    exitTimer.current = window.setTimeout(callback, reduceMotion ? 0 : 200);
  }

  const cardWidth = compact ? window.innerWidth - 32 : Math.min(352, window.innerWidth - 32);
  const cardHeightEstimate = 260;
  const spaceRight = window.innerWidth - (spotlight.left + spotlight.width);
  const spaceLeft = spotlight.left;
  const cardStyle: React.CSSProperties = compact
    ? { left: 16, right: 16, bottom: 16 }
    : spaceRight >= cardWidth + 32
      ? {
          left: spotlight.left + spotlight.width + 20,
          top: Math.max(16, Math.min(spotlight.top, window.innerHeight - cardHeightEstimate - 16)),
          width: cardWidth,
        }
      : spaceLeft >= cardWidth + 32
        ? {
            left: spotlight.left - cardWidth - 20,
            top: Math.max(16, Math.min(spotlight.top, window.innerHeight - cardHeightEstimate - 16)),
            width: cardWidth,
          }
        : {
            left: Math.max(16, Math.min(spotlight.left, window.innerWidth - cardWidth - 16)),
            top: Math.max(16, Math.min(spotlight.top + spotlight.height + 16, window.innerHeight - cardHeightEstimate - 16)),
            width: cardWidth,
          };

  return (
    <div className={`fixed inset-0 z-[70] transition-opacity duration-200 motion-reduce:transition-none ${leaving ? "opacity-0" : "opacity-100"}`}>
      <div className="absolute inset-0 pointer-events-auto" aria-hidden="true" />
      <div
        className="pointer-events-none fixed rounded-2xl border border-info/60 shadow-[0_0_0_9999px_rgba(20,28,48,0.46),0_10px_30px_rgba(31,42,68,0.22)] transition-[left,top,width,height] duration-300 ease-out motion-reduce:transition-none"
        style={spotlight}
        aria-hidden="true"
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="essay-workspace-tutorial-title"
        aria-describedby="essay-workspace-tutorial-description"
        tabIndex={-1}
        className="fixed z-10 rounded-2xl border border-border bg-card p-5 shadow-xl outline-none motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
        style={cardStyle}
      >
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-info">
          Step {stepIndex + 1} of {ESSAY_WORKSPACE_TUTORIAL_STEPS.length}
        </div>
        <h2 id="essay-workspace-tutorial-title" className="mt-2 font-display text-xl font-bold">
          {step.title}
        </h2>
        <p id="essay-workspace-tutorial-description" className="mt-2 text-sm leading-6 text-muted-foreground">
          {step.description}
        </p>
        <div className="sr-only" aria-live="polite">
          Essay Workspace tutorial step {stepIndex + 1} of {ESSAY_WORKSPACE_TUTORIAL_STEPS.length}
        </div>
        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => close(onSkip)}
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => setStepIndex((current) => current - 1)}
                className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (stepIndex === ESSAY_WORKSPACE_TUTORIAL_STEPS.length - 1) close(onFinish);
                else setStepIndex((current) => current + 1);
              }}
              className="rounded-full bg-info px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              {stepIndex === ESSAY_WORKSPACE_TUTORIAL_STEPS.length - 1 ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopBar({
  step,
  stepIdx,
  guidedProfileSetupActive,
}: {
  step: (typeof journeySteps)[number];
  stepIdx: number;
  guidedProfileSetupActive: boolean;
}) {
  const pct = ((stepIdx + 1) / journeySteps.length) * 100;
  return (
    <div className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex h-14 items-center gap-4 pl-16 pr-6 md:px-10">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate text-sm font-medium text-foreground">{step.title}</span>
              {guidedProfileSetupActive ? (
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">Complete Your Profile</span>
              ) : (
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {step.group} · Step {step.id}/{journeySteps.length}
                </span>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent>Goal: {step.goal}</TooltipContent>
        </Tooltip>
      </div>
      {!guidedProfileSetupActive && (
        <div className="h-1 bg-secondary">
          <div className="h-full bg-info transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
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
      aria-label="Open menu"
      onClick={onOpen}
      className={`fixed left-3 top-3 z-30 grid size-10 place-items-center rounded-lg border border-border bg-card text-foreground shadow-sm transition-opacity duration-200 md:hidden ${
        isOpen ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      <Menu className="size-5" strokeWidth={2.5} />
    </button>
  );
}

/**
 * Persistent slim navigation rail (md+). Replaces the old floating toggle pill:
 * docked to the left edge with the logo (home), a dedicated panel-toggle button,
 * the journey steps as numbered markers (teal = done, purple = current, gray = upcoming),
 * and the user avatar. The toggle and avatar expand the full sidebar panel.
 */
function SidebarRail({
  activeIdx,
  laterStepsLocked,
  onSelect,
  onExpand,
}: {
  activeIdx: number;
  laterStepsLocked: boolean;
  onSelect: (i: number) => void;
  onExpand: () => void;
}) {
  const { user } = useUser();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[65px] flex-col items-center border-r border-border bg-card/95 backdrop-blur md:flex">
      <Link
        to="/"
        aria-label="Scholar-E home"
        className="mt-2.5 grid size-9 place-items-center rounded-lg transition-transform hover:scale-105"
      >
        <img src={scholarELogoUrl} alt="" className="size-8 rounded-full object-cover" />
      </Link>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onExpand}
            aria-label="Expand sidebar"
            className="mt-1.5 grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelLeftOpen className="size-5" strokeWidth={2} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Expand sidebar</TooltipContent>
      </Tooltip>

      <div className="mt-3 flex flex-1 flex-col items-center gap-1.5 overflow-hidden py-1">
        <span className="mb-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Steps
        </span>
        {journeySteps.map((s, idx) => {
          const isActive = idx === activeIdx;
          const isDone = idx < activeIdx;
          const isLocked = laterStepsLocked && idx > 0;
          return (
            <Tooltip key={s.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => { if (!isLocked) onSelect(idx); }}
                  aria-label={isLocked ? `Step ${idx + 1}: ${s.title}. Complete your profile to unlock this step.` : `Step ${idx + 1}: ${s.title}`}
                  aria-disabled={isLocked || undefined}
                  aria-current={isActive ? "step" : undefined}
                  className={`relative grid size-9 shrink-0 place-items-center rounded-full transition-colors ${
                    isActive
                      ? "bg-info text-white"
                      : isLocked
                        ? "cursor-not-allowed text-muted-foreground opacity-45"
                      : isDone
                        ? "bg-success/20 text-success hover:bg-success/30"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <span className="text-sm font-bold tabular-nums">{idx + 1}</span>
                  {isDone && (
                    <span className="absolute -bottom-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full bg-success text-white ring-2 ring-card">
                      <Check className="size-2.5" strokeWidth={3.5} />
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {isLocked ? "Complete your profile to unlock this step." : `${idx + 1} — ${s.title}`}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onExpand}
            aria-label="Your profile"
            className="mb-3 mt-1 grid size-9 place-items-center rounded-full"
          >
            <span className="grid size-8 place-items-center rounded-full bg-primary text-[11px] font-display text-primary-foreground">
              {toInitials(user?.name)}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Your profile</TooltipContent>
      </Tooltip>
    </aside>
  );
}

function Nav({
  stepIdx,
  onNext,
  onPrev,
  hideNext = false,
}: {
  stepIdx: number;
  onNext: () => void;
  onPrev: () => void;
  hideNext?: boolean;
}) {
  return (
    <div className="flex min-h-16 items-center justify-between">
      <button
        onClick={onPrev}
        disabled={stepIdx === 0}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-2 text-sm hover:bg-accent disabled:opacity-40"
      >
        <ArrowLeft className="size-4" />
        Previous
      </button>
      <div className="text-xs text-muted-foreground font-mono">
        {stepIdx + 1} / {journeySteps.length}
      </div>
      <button
        onClick={onNext}
        disabled={stepIdx === journeySteps.length - 1}
        aria-hidden={hideNext}
        tabIndex={hideNext ? -1 : undefined}
        className={`inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-40 ${hideNext ? "invisible" : ""}`}
      >
        Continue
        <ArrowRight className="size-4" />
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
  goToStep,
  profileError,
  startProfilePrompt,
  onProfileSetupComplete,
}: {
  slug: string;
  goNext: () => void;
  goPrev: () => void;
  goToProfile: () => void;
  goToRequirements: () => void;
  goToStep: (slug: string) => void;
  profileError: string;
  startProfilePrompt: boolean;
  onProfileSetupComplete: () => void;
}) {
  switch (slug) {
    case "profile": return <StepProfile error={profileError} onComplete={onProfileSetupComplete} startWithResumePrompt={startProfilePrompt} />;
    case "discovery": return <StepDiscovery onUpdateProfile={goToProfile} onUseSource={goToRequirements} />;
    case "opportunities": return <StepOpportunities onAnalyze={goNext} />;
    case "requirements": return <StepRequirementsAndFit />;
    case "essay-workspace": return <StepEssayWorkspace onBack={goPrev} />;
    case "revise": return <StepRevise />;
    case "final-check": return <StepFinalCheck onNavigate={goToStep} />;
    case "tracker": return <StepTracker onNavigate={goToStep} />;
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
  if (fitAnalysis.application_readiness_matrix?.matrix?.length) {
    // Prefer eligibility-only rows for profile-fit context; materials come later.
    const eligibilityOnly = (fitAnalysis.application_readiness_matrix.matrix ?? []).filter(
      (row) => (row.item_type || "").toLowerCase() !== "application material",
    );
    if (eligibilityOnly.length) {
      const readyCount = eligibilityOnly.filter((row) => row.status === "Ready").length;
      return {
        ...fitAnalysis.application_readiness_matrix,
        matrix: eligibilityOnly,
        ready_count: readyCount,
        total_count: eligibilityOnly.length,
        completion_percent: Math.round((readyCount / eligibilityOnly.length) * 100),
        blockers: eligibilityOnly.filter((row) => row.risk_level === "High") as Array<Record<string, string>>,
        summary: `${readyCount} of ${eligibilityOnly.length} eligibility items look ready.`,
      };
    }
    return fitAnalysis.application_readiness_matrix;
  }

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
    summary: `${readyCount} of ${rows.length} eligibility items look ready.`,
  };
}

function ApplicationReadinessMatrixCard({ matrix }: { matrix?: ApplicationReadinessMatrix }) {
  const rows = matrix?.matrix ?? [];
  return (
    <Card className="md:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Eligibility readiness</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Checks whether stated eligibility requirements look met from the current profile.
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
      <div className="flex items-center gap-2.5">
        <div className="size-8 rounded-full bg-primary text-primary-foreground grid place-items-center text-[11px] font-display">
          {toInitials(user?.name)}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-medium truncate">{user?.name || "Your profile"}</div>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Power className="size-3" strokeWidth={2.5} />
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
const PROFILE_ENTRY_CLASS = "rounded-md border border-border/70 bg-card p-4";

/* ---------------- Step 2: Profile ---------------- */

function StepProfile({
  error,
  onComplete,
  startWithResumePrompt,
}: {
  error: string;
  onComplete: () => void;
  startWithResumePrompt: boolean;
}) {
  const { user, updateProfile } = useUser();
  const level = user?.educationLevel;
  const [showExtended, setShowExtended] = useState(false);
  const [resumeStatus, setResumeStatus] = useState("");
  const [resumeError, setResumeError] = useState("");
  const [profileStartMode, setProfileStartMode] = useState<"resume" | "manual" | null>(
    user?.optional?.resumeFileName ? "resume" : user?.educationLevel ? "manual" : null,
  );
  const [showStartDialog, setShowStartDialog] = useState(
    startWithResumePrompt || !!(
      !user?.profileStartChoiceCompleted &&
      !user?.profileSetupCompleted &&
      !user?.optional?.resumeFileName &&
      (user?.academicOnboardingCompleted || !user?.educationLevel)
    ),
  );
  const [profileSetupStep, setProfileSetupStep] = useState(0);
  const [highestProfileSetupStep, setHighestProfileSetupStep] = useState(0);
  const [showProfileSetupValidation, setShowProfileSetupValidation] = useState(false);
  const [resumeImportedProfileSteps, setResumeImportedProfileSteps] = useState<number[]>([]);
  const volunteerMigrationDone = useRef(false);
  const profileSetupHeadingRef = useRef<HTMLHeadingElement | null>(null);
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
  useEffect(() => {
    if (!user || volunteerMigrationDone.current) return;
    volunteerMigrationDone.current = true;
    const volunteerEntries = (user.workExperience ?? []).filter(isVolunteerExperience);
    const legacyVolunteering = mergeVolunteerText([
      user.highSchool?.volunteer,
      formatVolunteerExperiences(volunteerEntries),
    ]);
    if (!legacyVolunteering) return;
    const { volunteer: _legacyVolunteer, ...highSchool } = user.highSchool ?? {};
    updateProfile({
      highSchool,
      workExperience: (user.workExperience ?? []).filter((entry) => !isVolunteerExperience(entry)),
      optional: {
        ...(user.optional ?? {}),
        volunteering: mergeVolunteerText([user.optional?.volunteering, legacyVolunteering]),
      },
    });
  }, [user, updateProfile]);
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
    const id = newId("edu");
    updateProfile({
      educationHistory: [
        ...educationHistory,
        {
          id,
          source: "manual",
          isCurrent: false,
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
    return id;
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
    const id = newId("research");
    updateProfile({
      researchExperience: [
        ...researchExperience,
        {
          id,
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
    return id;
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
    const id = newId("work");
    updateProfile({
      workExperience: [
        ...workExperience,
        {
          id,
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
    return id;
  }
  function removeWorkEntry(id: string) {
    updateProfile({ workExperience: workExperience.filter((entry) => entry.id !== id) });
  }

  // documents
  const docs = user?.documents ?? [];
  function addDoc(kind: string, file: File) {
    storeFile(file.name, file);
    updateProfile({ documents: [...docs, { name: file.name, kind }] });
  }
  function removeDoc(name: string) {
    removeFile(name);
    updateProfile({ documents: docs.filter((d) => d.name !== name) });
  }

  async function handleResumeUpload(file: File) {
    setResumeStatus("Reading resume...");
    setResumeError("");
    setProfileStartMode("resume");
    storeFile(file.name, file);
    try {
      const profile = await autofillProfileFromResume(file);
      const nextLevel = user?.educationLevel || profile.educationLevel;
      const parsedHighSchool = compactObject(profile.highSchool);
      const { volunteer: parsedHighSchoolVolunteering, ...parsedHighSchoolWithoutVolunteering } =
        parsedHighSchool;
      const parsedUndergrad = compactObject(profile.undergrad);
      const parsedGraduate = compactObject(profile.graduate);
      const parsedProfile: UserProfile = {
        name: profile.name || user?.name || "",
        email: profile.email || user?.email || "",
        educationLevel: (nextLevel || undefined) as EducationLevel | undefined,
        highSchool: parsedHighSchoolWithoutVolunteering,
        undergrad: parsedUndergrad,
        graduate: parsedGraduate,
      };
      const parsedEducationHistory = (profile.educationHistory?.length
        ? profile.educationHistory
        : buildEducationHistoryFromProfile(parsedProfile)
      ).map((entry, index) => ({
        ...entry,
        id: entry.id || `edu-${index + 1}`,
        source: "resume" as const,
        isCurrent: false,
        majorField: entry.majorField || inferMajorField(entry.degreeProgram),
        educationLevel:
          normalizeEducationLevelLabel(entry.educationLevel) ||
          inferEducationLevelLabel(entry) ||
          educationLevelLabelFromCode(nextLevel),
      }));
      const nextEducationHistory = mergeEducationHistory(
        user?.educationHistory ?? [],
        parsedEducationHistory,
      );
      const nextResearchExperience = (profile.researchExperience?.length
        ? profile.researchExperience
        : buildResearchExperienceFromProfile(parsedProfile)
      )
        .filter(hasConcreteResearchEvidence)
        .map((entry, index) => ({ ...entry, id: entry.id || `research-${index + 1}` }));
      const parsedVolunteerExperience = (profile.workExperience ?? []).filter(
        isVolunteerExperience,
      );
      const nextWorkExperience = (profile.workExperience ?? [])
        .filter((entry) => !isVolunteerExperience(entry))
        .map((entry, index) => ({
          ...entry,
          id: entry.id || `work-${index + 1}`,
        }));
      const mergedResearchExperience = mergeStructuredEntries(
        user?.researchExperience ?? [],
        nextResearchExperience,
        (entry) =>
          normalizeEducationIdentity(
            [entry.researchAreas, entry.advisorLabDepartment].filter(Boolean).join(" "),
          ),
        "research-resume",
      );
      const mergedWorkExperience = mergeStructuredEntries(
        user?.workExperience ?? [],
        nextWorkExperience,
        (entry) =>
          normalizeEducationIdentity(
            [entry.roleTitle, entry.organization, entry.startDate, entry.endDate]
              .filter(Boolean)
              .join(" "),
          ),
        "work-resume",
      );
      const parsedOptional = compactObject(profile.optional);
      const importedVolunteering = mergeVolunteerText([
        String(parsedOptional.volunteering ?? ""),
        String(parsedHighSchoolVolunteering ?? ""),
        formatVolunteerExperiences(parsedVolunteerExperience),
      ]);
      const mergedOptional = preferExistingValues(parsedOptional, user?.optional ?? {});
      mergedOptional.volunteering = mergeVolunteerText([
        user?.optional?.volunteering,
        importedVolunteering,
      ]);
      updateProfile({
        name: user?.name || profile.name || "",
        email: user?.email || profile.email || "",
        location: user?.location || profile.location,
        careerGoal: user?.careerGoal || profile.careerGoal,
        educationLevel: (nextLevel || undefined) as EducationLevel | undefined,
        highSchool: {
          ...(user?.highSchool ?? {}),
          ...parsedHighSchoolWithoutVolunteering,
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
        profileStartChoiceCompleted: true,
        researchExperience: mergedResearchExperience,
        workExperience: mergedWorkExperience,
        optional: {
          ...mergedOptional,
          resumeFileName: file.name,
        },
        documents: [...docs, { name: file.name, kind: "Resume" }],
      });
      setResumeImportedProfileSteps([
        ...(parsedEducationHistory.length ? [1] : []),
        ...(nextResearchExperience.length || nextWorkExperience.length ? [2] : []),
        ...(Object.keys(parsedOptional).length || importedVolunteering ? [3] : []),
      ]);
      setProfileSetupStep(0);
      setHighestProfileSetupStep(0);
      setShowProfileSetupValidation(false);
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
  const showRequiredErrors = !!error;
  const aboutYouCompletion = getRequiredAboutCompletion(user);
  const aboutYouComplete = aboutYouCompletion.completed === aboutYouCompletion.total;
  const hasEducationLevel = educationHistory.some((entry) => entry.educationLevel?.trim()) || !!user?.educationLevel;
  const shouldShowProfileSetup = !showStartDialog && !user?.profileSetupCompleted;
  const showSetupErrors = showRequiredErrors || showProfileSetupValidation;
  const importedFromResumeBadge = resumeImportedProfileSteps.includes(profileSetupStep) ? (
    <span className="inline-flex rounded-full bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info">
      Imported from resume
    </span>
  ) : null;
  useEffect(() => {
    if (!shouldShowProfileSetup) return;
    profileSetupHeadingRef.current?.focus();
  }, [shouldShowProfileSetup, profileSetupStep]);

  const uploadedDocsList = (
    <div className="mt-4 divide-y divide-border/70 border-y border-border/70">
      {docs.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          No documents uploaded yet. You can add them now or return later.
        </p>
      ) : docs.map((d) => (
        <div key={`${d.kind}-${d.name}`} className="flex items-center gap-3 py-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-success/10 text-success">
            <FileUp className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <div className="truncate text-sm font-medium text-foreground">{d.name}</div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-success">Uploaded</span>
            </div>
            <div className="text-xs text-muted-foreground">{d.kind}</div>
          </div>
          <button
            type="button"
            onClick={() => removeDoc(d.name)}
            className="rounded px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
  const uploadMaterialsCard = (
    <Card className={PROFILE_SECTION_CLASS}>
      {uploadedDocsList}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {["Transcript", "Letter of Recommendation", "Other documents"].map((k) => (
          <label key={k} className="cursor-pointer rounded-md border border-dashed border-border p-3 text-sm transition-colors hover:border-primary/40 hover:bg-accent/40 focus-within:ring-2 focus-within:ring-primary/20">
            <div className="font-medium text-foreground">{k}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Not uploaded</div>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) addDoc(k, f);
              }}
              className="mt-2 w-full text-xs text-muted-foreground file:mr-2 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:font-medium file:text-foreground"
            />
          </label>
        ))}
      </div>
    </Card>
  );
  const profileSummaryCard = (
    <Card className={PROFILE_SECTION_CLASS}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Full name" value={user?.name ?? ""} onChange={(v) => set("name", v)} placeholder="Maya Rodriguez" />
        <Input label="Email" value={user?.email ?? ""} onChange={(v) => set("email", v)} placeholder="you@school.edu" type="email" />
      </div>
    </Card>
  );
  const aboutYouCard = (
    <Card className={PROFILE_SECTION_CLASS}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Gender"
          value={user?.gender ?? ""}
          onChange={(v) => set("gender", v)}
          options={genderOptions}
          invalid={showSetupErrors && !user?.gender?.trim()}
          errorMessage="Select a gender."
        />
        <Input
          label="Location"
          value={user?.location ?? ""}
          onChange={(v) => set("location", v)}
          placeholder="City, State"
          invalid={showSetupErrors && !user?.location?.trim()}
          errorMessage="Enter your location."
        />
        <Select
          label="Citizenship / Residency Status"
          value={user?.citizenshipStatus ?? ""}
          onChange={(v) => set("citizenshipStatus", v)}
          options={citizenshipOptions}
          invalid={showSetupErrors && !user?.citizenshipStatus?.trim()}
          errorMessage="Select a citizenship or residency status."
        />
        <Select
          label="Please select your Race / Ethnicity"
          value={user?.raceEthnicity ?? ""}
          onChange={(v) => set("raceEthnicity", v)}
          options={raceOptions}
          invalid={showSetupErrors && !user?.raceEthnicity}
          errorMessage="Select a race or ethnicity option."
        />
      </div>

      <button
        type="button"
        onClick={() => setShowExtended((s) => !s)}
        aria-expanded={showExtended}
        className="mt-4 rounded px-1 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        {showExtended ? "− Hide" : "+ Add more personalized context"}
      </button>

      {showExtended && (
        <div className="mt-3 space-y-4 border-l-2 border-primary/15 pl-3 animate-in fade-in duration-150 motion-reduce:animate-none">
          {EXTENDED_CONTEXT_GROUPS.map((grp) => (
            <div key={grp.group}>
              <div className="text-[11px] font-medium uppercase tracking-widest text-primary/80">{grp.group}</div>
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
  );
  const educationCard = (
    <EducationHistorySection
      entries={educationHistory}
      onAdd={addEducationEntry}
      onRemove={removeEducationEntry}
      onChange={updateEducationEntry}
      showMissingEducationLevel={showSetupErrors && !hasEducationLevel}
    />
  );
  const experienceSection = (
    <>
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
    </>
  );
  const hasOptionalContext = [
    user?.optional?.volunteering,
    user?.optional?.societyInvolvement,
    user?.optional?.leadership,
    user?.optional?.sports,
    user?.optional?.articlesPublished,
    user?.optional?.projects,
  ].some((value) => !!value?.trim());
  const optionalContextCard = (
    <Card className={`${PROFILE_SECTION_CLASS}`}>
      <SectionLabel>Optional context</SectionLabel>
      <p className="text-xs text-muted-foreground mt-1">
        All optional — add whatever helps scholarships see who you are.
      </p>
      {!hasOptionalContext && (
        <p className="mt-3 border-y border-border/60 py-2.5 text-sm text-muted-foreground">
          No activities added yet. Add details in any category that is relevant to you.
        </p>
      )}
      <div className="mt-3 grid gap-x-5 gap-y-4 md:grid-cols-2">
        <section aria-labelledby="community-activity-heading" className="space-y-3">
          <h3 id="community-activity-heading" className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
            Community &amp; leadership
          </h3>
          <Textarea label="Volunteering" value={user?.optional?.volunteering ?? ""} onChange={(v) => setOptional({ volunteering: v })} placeholder="Describe any volunteer work, community service, or nonprofit involvement you’d like Scholar-E to consider." />
          <Textarea label="Society / club involvement" value={user?.optional?.societyInvolvement ?? ""} onChange={(v) => setOptional({ societyInvolvement: v })} placeholder="Clubs, organizations, roles…" />
          <Textarea label="Leadership experience" value={user?.optional?.leadership ?? ""} onChange={(v) => setOptional({ leadership: v })} placeholder="Captain, president, lead organizer, founder…" />
        </section>
        <section aria-labelledby="achievement-activity-heading" className="space-y-3 md:border-l md:border-border/60 md:pl-5">
          <h3 id="achievement-activity-heading" className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
            Achievements &amp; interests
          </h3>
          <Textarea label="Sports" value={user?.optional?.sports ?? ""} onChange={(v) => setOptional({ sports: v })} placeholder="Teams, varsity/club, captaincy…" />
          <Textarea label="Articles published" value={user?.optional?.articlesPublished ?? ""} onChange={(v) => setOptional({ articlesPublished: v })} placeholder="Titles, outlets, links…" />
          <Textarea label="Projects" value={user?.optional?.projects ?? ""} onChange={(v) => setOptional({ projects: v })} placeholder="Personal, school, or research projects…" />
        </section>
      </div>
    </Card>
  );
  const profileSetupSteps = [
    {
      title: "About You",
      helper: "Complete these required details so Scholar-E can personalize your profile and improve opportunity matching.",
      required: true,
      complete: aboutYouComplete,
      requiredCompleted: aboutYouCompletion.completed,
      requiredTotal: aboutYouCompletion.total,
      content: (
        <div className="space-y-4">
          {profileSummaryCard}
          {aboutYouCard}
        </div>
      ),
    },
    {
      title: "Education",
      helper: "Review your education information to ensure it is complete and accurate.",
      required: true,
      complete: hasEducationLevel,
      requiredCompleted: hasEducationLevel ? 1 : 0,
      requiredTotal: 1,
      content: educationCard,
    },
    {
      title: "Experience",
      helper: "Review your experiences and add or update anything that best represents your background.",
      required: false,
      complete: true,
      content: <div className="space-y-4">{experienceSection}</div>,
    },
    {
      title: "Skills & Activities",
      helper: "Review your skills, activities, leadership, and achievements to help strengthen your profile.",
      required: false,
      complete: true,
      content: optionalContextCard,
    },
    {
      title: "Upload Materials",
      helper: "Upload supporting documents to strengthen your profile and reuse them across future applications.",
      required: false,
      complete: true,
      content: uploadMaterialsCard,
    },
  ];
  const currentProfileSetupStep = profileSetupSteps[profileSetupStep] ?? profileSetupSteps[0];
  const isCurrentSetupStepOptional = !currentProfileSetupStep.required;
  const currentSetupStepComplete = currentProfileSetupStep.complete;
  function goToProfileSetupStep(index: number) {
    if (index > highestProfileSetupStep) return;
    setProfileSetupStep(index);
    setShowProfileSetupValidation(false);
  }
  function continueProfileSetup() {
    if (!currentSetupStepComplete) {
      setShowProfileSetupValidation(true);
      profileSetupHeadingRef.current?.focus();
      return;
    }
    if (profileSetupStep === profileSetupSteps.length - 1) {
      updateProfile({
        profileSetupCompleted: true,
        journeyTutorialPending: true,
      });
      onComplete();
      return;
    }
    const nextStep = profileSetupStep + 1;
    setProfileSetupStep(nextStep);
    setHighestProfileSetupStep((step) => Math.max(step, nextStep));
    setShowProfileSetupValidation(false);
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Dialog open={showStartDialog}>
        <DialogContent
          className="top-[45%] w-[calc(100%-1.5rem)] max-w-xl gap-0 border-0 bg-transparent p-0 shadow-none motion-reduce:animate-none [&>button]:hidden"
          overlayClassName="bg-[radial-gradient(circle_at_50%_24%,rgba(109,93,246,0.08),transparent_34%),linear-gradient(180deg,#f9faff_0%,#f3f5fb_100%)] data-[state=open]:animate-none data-[state=closed]:animate-none"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="pb-7 text-center sm:text-center">
            <div className="mb-3 flex items-center justify-center gap-2">
              <img src={scholarELogoUrl} alt="" className="size-8 rounded-full object-cover" />
              <span className="font-display text-sm font-semibold tracking-tight text-foreground">Scholar-E</span>
            </div>
            {user?.academicOnboardingCompleted && (
              <div className="mb-3 flex items-center justify-center gap-1.5 text-sm font-medium text-success motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
                <Check className="size-4" aria-hidden="true" />
                <span>Education details saved</span>
              </div>
            )}
            <div
              className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300"
              style={{ animationDelay: "75ms", animationFillMode: "both" }}
            >
              <DialogTitle className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Start your profile</DialogTitle>
              <DialogDescription className="mt-1.5 text-base font-medium leading-6 text-foreground/75 sm:text-lg">
                Upload your resume to automatically fill in many of your profile details. You can
                review and edit everything before continuing.
              </DialogDescription>
            </div>
          </DialogHeader>

          <div
            className="grid gap-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300"
            style={{ animationDelay: "75ms", animationFillMode: "both" }}
          >
            <button
              type="button"
              onClick={() => startResumeInputRef.current?.click()}
              disabled={!!resumeStatus}
              aria-busy={!!resumeStatus && !resumeError}
              className={`flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:opacity-90 ${resumeStatus && !resumeError ? "agent-loading" : ""}`}
            >
              {resumeStatus && !resumeError ? (
                <Spinner className="size-5" />
              ) : (
                <FileUp className="size-5 shrink-0" />
              )}
              <span>{resumeStatus && !resumeError ? "Reading your resume…" : "Autofill with Resume"}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setProfileStartMode("manual");
                updateProfile({ profileStartChoiceCompleted: true });
                setResumeError("");
                setResumeImportedProfileSteps([]);
                setProfileSetupStep(0);
                setHighestProfileSetupStep(0);
                setShowProfileSetupValidation(false);
                setShowStartDialog(false);
              }}
              disabled={!!resumeStatus}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm font-medium shadow-sm transition-colors hover:bg-accent"
            >
              <PencilLine className="size-5 shrink-0" />
              <span>Apply Manually</span>
            </button>
          </div>

          {(resumeStatus || resumeError) && (
            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
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

      {shouldShowProfileSetup ? (
        <GuidedProfileSetup
          steps={profileSetupSteps}
          currentStep={profileSetupStep}
          highestStep={highestProfileSetupStep}
          headingRef={profileSetupHeadingRef}
          importedBadge={importedFromResumeBadge}
          currentComplete={currentSetupStepComplete}
          currentOptional={isCurrentSetupStepOptional}
          showValidation={showProfileSetupValidation}
          onStepSelect={goToProfileSetupStep}
          onBack={() => {
            setProfileSetupStep((step) => Math.max(0, step - 1));
            setShowProfileSetupValidation(false);
          }}
          onContinue={continueProfileSetup}
        />
      ) : (
        <>
          <div className="grid items-start gap-8 xl:grid-cols-2">
            <div className="space-y-8">
              {profileSummaryCard}
              {error && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
                  {error}
                </div>
              )}
              {aboutYouCard}
              {educationCard}
            </div>
            <div className="space-y-8">
              {experienceSection}
              {uploadMaterialsCard}
            </div>
          </div>
          <div className="mt-8">{optionalContextCard}</div>
        </>
      )}
    </div>
  );
}

type GuidedProfileSetupStep = {
  title: string;
  helper: string;
  required: boolean;
  complete: boolean;
  requiredCompleted?: number;
  requiredTotal?: number;
  content: React.ReactNode;
};

function GuidedProfileSetup({
  steps,
  currentStep,
  highestStep,
  headingRef,
  importedBadge,
  currentComplete,
  currentOptional,
  showValidation,
  onStepSelect,
  onBack,
  onContinue,
}: {
  steps: GuidedProfileSetupStep[];
  currentStep: number;
  highestStep: number;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  importedBadge: React.ReactNode;
  currentComplete: boolean;
  currentOptional: boolean;
  showValidation: boolean;
  onStepSelect: (step: number) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const step = steps[currentStep] ?? steps[0];
  const isFinalStep = currentStep === steps.length - 1;
  const overallProgress = ((currentStep + 1) / steps.length) * 100;
  const requiredCompleted = Math.min(step.requiredCompleted ?? 0, step.requiredTotal ?? 0);
  const requiredTotal = step.requiredTotal ?? 0;
  const requiredProgressText = requiredTotal > 0
    ? requiredCompleted === requiredTotal
      ? "Required information complete"
      : `${requiredCompleted} of ${requiredTotal} required fields completed`
    : null;
  const continueLabel = isFinalStep
    ? "Finish Profile Setup"
    : currentOptional
      ? "Continue"
      : "Continue";

  return (
    <section className="mx-auto max-w-6xl" aria-labelledby="profile-setup-title">
      <header className="mb-3 border-b border-border/60 pb-3">
        <div className="flex items-center justify-between gap-4">
          <h1 id="profile-setup-title" className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Complete Your Profile
          </h1>
          <div className="shrink-0 whitespace-nowrap text-xs font-medium text-muted-foreground">
            Step {currentStep + 1} of {steps.length}
          </div>
        </div>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          Review and complete your information before continuing.
        </p>
        <div
          className="mt-2 h-1 overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-label="Overall profile setup progress"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={currentStep + 1}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
        <div className="mt-3 grid grid-cols-5 gap-1 md:hidden" aria-label="Profile setup progress">
          {steps.map((item, index) => (
            <button
              key={item.title}
              type="button"
              onClick={() => onStepSelect(index)}
              disabled={index > highestStep}
              aria-current={index === currentStep ? "step" : undefined}
              aria-label={`${item.title}, ${index === currentStep ? "current" : index < highestStep ? "completed" : "upcoming"}`}
              className={`min-w-0 border-b-2 px-1 py-1.5 text-center text-xs font-medium transition-colors ${
                index === currentStep
                  ? "border-primary text-primary"
                  : index <= highestStep
                    ? "border-transparent text-foreground"
                    : "border-transparent text-muted-foreground opacity-50"
              }`}
            >
              <span className="block">{index < highestStep && index !== currentStep ? "✓" : index + 1}</span>
              <span className="mt-0.5 hidden truncate text-[10px] font-normal sm:block">{item.title}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-[192px_minmax(0,1fr)] lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="hidden md:block">
          <nav className="sticky top-20 space-y-px border-r border-border/60 pr-3" aria-label="Profile setup steps">
            {steps.map((item, index) => {
              const isActive = index === currentStep;
              const isReachable = index <= highestStep;
              const isComplete = index < highestStep && !isActive;
              return (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => onStepSelect(index)}
                  disabled={!isReachable}
                  aria-label={`${item.title}, ${isActive ? "current" : isComplete ? "completed" : "upcoming"}, ${item.required ? "required" : "optional"}`}
                  className={`flex w-full items-center gap-2 border-l-2 px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                    isActive
                      ? "border-primary bg-primary/[0.035] text-foreground"
                      : isReachable
                        ? "border-transparent text-foreground/80 hover:bg-accent/45 hover:text-foreground"
                        : "cursor-not-allowed border-transparent text-muted-foreground opacity-60"
                  }`}
                  aria-current={isActive ? "step" : undefined}
                >
                  <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isComplete
                        ? "bg-success/20 text-success"
                        : "bg-secondary text-secondary-foreground"
                  }`}>
                    {isComplete ? "✓" : index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium leading-4">{item.title}</span>
                    <span className="block text-[10px] leading-4 text-muted-foreground">{item.required ? "Required" : "Optional"}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 border-t border-border/60 bg-card px-4 py-3 md:border-t-0 md:px-5 md:py-2">
          <div className="sr-only" aria-live="polite">
            Step {currentStep + 1} of {steps.length}: {step.title}
          </div>
          <div className="mb-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="text-xl font-semibold tracking-tight outline-none"
              >
                {step.title}
              </h2>
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {step.required ? "Required information" : "Optional"}
              </span>
              {importedBadge}
            </div>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{step.helper}</p>
            {requiredProgressText && (
              <p
                className={`mt-1.5 flex items-center gap-1.5 text-xs font-medium ${
                  currentComplete ? "text-success" : "text-muted-foreground"
                }`}
                role="status"
                aria-live="polite"
              >
                {currentComplete && <Check className="size-3.5" aria-hidden="true" />}
                {requiredProgressText}
              </p>
            )}
            {showValidation && !currentComplete && (
              <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                Complete the required fields in this step before continuing.
              </p>
            )}
          </div>

          <div
            key={step.title}
            className="animate-in fade-in slide-in-from-bottom-1 duration-150 motion-reduce:animate-none"
          >
            {step.content}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-3 border-t border-border/50 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={onBack}
              disabled={currentStep === 0}
              className="min-h-9 rounded-md border border-transparent px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-border hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={onContinue}
              disabled={!currentComplete && !currentOptional}
              className="min-h-9 rounded-md border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-[background-color,border-color,box-shadow,opacity] duration-150 hover:bg-primary/90 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none"
            >
              {continueLabel}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* form atoms */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs uppercase tracking-widest text-muted-foreground">{children}</div>;
}
function Input({
  label, value, onChange, placeholder, className = "", controlClassName = "", type = "text", invalid = false, errorMessage,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string; controlClassName?: string; type?: string; invalid?: boolean; errorMessage?: string }) {
  const errorId = useId();
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-medium text-foreground/75">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        className={`mt-1 w-full rounded-md border bg-card px-3 py-1.5 text-sm text-foreground outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/60 focus:border-primary/70 focus:ring-2 focus:ring-primary/15 ${controlClassName} ${
          invalid ? "border-destructive ring-2 ring-destructive/15" : "border-border"
        }`}
      />
      {invalid && (
        <span id={errorId} className="mt-1 block text-xs font-medium text-destructive">
          {errorMessage ?? `${label} is required.`}
        </span>
      )}
    </label>
  );
}
function Textarea({
  label, value, onChange, placeholder, rows = 3, className = "", controlClassName = "",
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; className?: string; controlClassName?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-medium text-foreground/75">{label}</span>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm leading-relaxed text-foreground outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/60 focus:border-primary/70 focus:ring-2 focus:ring-primary/15 ${controlClassName}`}
      />
    </label>
  );
}
function Select({
  label, value, onChange, options, className = "", invalid = false, errorMessage,
}: { label: string; value: string; onChange: (v: string) => void; options: string[]; className?: string; invalid?: boolean; errorMessage?: string }) {
  const errorId = useId();
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-medium text-foreground/75">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        className={`mt-1 w-full rounded-md border bg-card px-3 py-1.5 text-sm text-foreground outline-none transition-[border-color,box-shadow,background-color] focus:border-primary/70 focus:ring-2 focus:ring-primary/15 ${
          invalid ? "border-destructive ring-2 ring-destructive/15" : "border-border"
        }`}
      >
        <option value="">Select…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {invalid && (
        <span id={errorId} className="mt-1 block text-xs font-medium text-destructive">
          {errorMessage ?? `${label} is required.`}
        </span>
      )}
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
        {fileName && <span className="inline-flex items-center gap-1 text-xs text-success"><Check className="size-3.5" strokeWidth={2.5} /> {fileName}</span>}
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
      institution: user.highSchool.institution ?? "",
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

function normalizeEducationIdentity(value?: string) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\buniversity\b/g, "univ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function educationIdentityLevel(entry: Partial<EducationHistoryEntry>) {
  return normalizeEducationLevelLabel(entry.educationLevel) || inferEducationLevelLabel(entry);
}

function educationYears(entry: Partial<EducationHistoryEntry>) {
  return new Set(
    [entry.startDate, entry.endDate]
      .flatMap((value) => String(value ?? "").match(/\b(?:19|20)\d{2}\b/g) ?? []),
  );
}

function isLikelySameEducation(
  existing: EducationHistoryEntry,
  imported: EducationHistoryEntry,
) {
  if (existing.source === "resume" && existing.id === imported.id) return true;
  const existingInstitution = normalizeEducationIdentity(existing.institution);
  const importedInstitution = normalizeEducationIdentity(imported.institution);
  const institutionMatches =
    !!existingInstitution &&
    !!importedInstitution &&
    existingInstitution === importedInstitution;
  const existingLevel = educationIdentityLevel(existing);
  const importedLevel = educationIdentityLevel(imported);
  const levelMatches = !!existingLevel && !!importedLevel && existingLevel === importedLevel;
  const existingMajor = normalizeEducationIdentity(
    existing.majorField || inferMajorField(existing.degreeProgram),
  );
  const importedMajor = normalizeEducationIdentity(
    imported.majorField || inferMajorField(imported.degreeProgram),
  );
  const majorMatches = !!existingMajor && !!importedMajor && existingMajor === importedMajor;
  const existingYears = educationYears(existing);
  const importedYears = educationYears(imported);
  const datesOverlap = [...importedYears].some((year) => existingYears.has(year));

  if (institutionMatches && levelMatches) {
    if (
      existingMajor &&
      importedMajor &&
      !majorMatches &&
      existingYears.size &&
      importedYears.size &&
      !datesOverlap
    ) {
      return false;
    }
    return true;
  }
  if (institutionMatches && (majorMatches || datesOverlap)) return true;
  return !existingInstitution && !importedInstitution && levelMatches && majorMatches && datesOverlap;
}

function fillEducationBlanks(
  existing: EducationHistoryEntry,
  imported: EducationHistoryEntry,
) {
  const merged = { ...imported } as EducationHistoryEntry;
  for (const [key, value] of Object.entries(existing)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  merged.id = existing.id;
  merged.source = existing.source ?? "manual";
  merged.isCurrent = existing.isCurrent ?? false;
  return merged;
}

function mergeEducationHistory(
  existingEntries: EducationHistoryEntry[],
  importedEntries: EducationHistoryEntry[],
) {
  const merged = existingEntries.map((entry) => ({ ...entry }));
  const usedIds = new Set(merged.map((entry) => entry.id));

  importedEntries.forEach((imported, importedIndex) => {
    const matchIndex = merged.findIndex((existing) => isLikelySameEducation(existing, imported));
    if (matchIndex >= 0) {
      merged[matchIndex] = fillEducationBlanks(merged[matchIndex], imported);
      return;
    }
    let id = imported.id || `edu-resume-${importedIndex + 1}`;
    if (usedIds.has(id)) id = `edu-resume-${importedIndex + 1}`;
    while (usedIds.has(id)) id = `${id}-imported`;
    usedIds.add(id);
    merged.push({ ...imported, id, source: "resume", isCurrent: imported.isCurrent ?? false });
  });

  return merged;
}

function preferExistingValues<T extends Record<string, unknown>>(
  imported: T,
  existing: Partial<T>,
) {
  const merged = { ...imported };
  for (const [key, value] of Object.entries(existing)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

function mergeStructuredEntries<T extends { id: string }>(
  existingEntries: T[],
  importedEntries: T[],
  identity: (entry: T) => string,
  idPrefix: string,
) {
  const merged = existingEntries.map((entry) => ({ ...entry }));
  const usedIds = new Set(merged.map((entry) => entry.id));
  importedEntries.forEach((imported, index) => {
    const importedIdentity = identity(imported);
    const matchIndex = importedIdentity
      ? merged.findIndex((existing) => identity(existing) === importedIdentity)
      : -1;
    if (matchIndex >= 0) {
      merged[matchIndex] = preferExistingValues(imported, merged[matchIndex]);
      return;
    }
    let id = imported.id || `${idPrefix}-${index + 1}`;
    if (usedIds.has(id)) id = `${idPrefix}-${index + 1}`;
    while (usedIds.has(id)) id = `${id}-imported`;
    usedIds.add(id);
    merged.push({ ...imported, id });
  });
  return merged;
}

function isVolunteerExperience(entry: Partial<WorkExperienceEntry>) {
  return /\b(volunteer|community service|nonprofit)\b/i.test(entry.experienceType ?? "");
}

function formatVolunteerExperiences(entries: Partial<WorkExperienceEntry>[]) {
  return entries
    .map((entry) => {
      const heading = [entry.roleTitle, entry.organization].filter(Boolean).join(" — ");
      const dates = [entry.startDate, entry.endDate].filter(Boolean).join(" – ");
      return [heading, dates, entry.description, entry.skillsTechnologies]
        .filter((value) => String(value ?? "").trim())
        .join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function mergeVolunteerText(values: Array<string | undefined>) {
  const unique = new Set<string>();
  const sections: string[] = [];
  values.forEach((value) => {
    const text = value?.trim();
    if (!text) return;
    const normalized = text.toLowerCase().replace(/\s+/g, " ");
    if (unique.has(normalized)) return;
    unique.add(normalized);
    sections.push(text);
  });
  return sections.join("\n\n");
}

function normalizeEducationLevelLabel(value?: string) {
  const text = value?.trim() ?? "";
  if (!text) return "";
  if (/^high school$/i.test(text)) return "High School";
  if (/^(associate'?s?|associate of (arts|science)|a\.?a\.?|a\.?s\.?)\s*(degree)?$/i.test(text)) return "Associate Degree";
  if (/^undergrad(uate)?$/i.test(text)) return "Bachelor's Degree";
  if (/^(bachelor'?s?|bachelor of (arts|science)|b\.?a\.?|b\.?s\.?|bba)\s*(degree)?$/i.test(text)) return "Bachelor's Degree";
  if (/^(master'?s?|master of (arts|science)|m\.?a\.?|m\.?s\.?|mba|mfa|mph)\s*(degree)?$/i.test(text)) return "Master's Degree";
  if (/^masters?\b/i.test(text)) return "Master's Degree";
  if (/^(phd|ph\.d\.?|doctoral|doctorate)( degree)?$/i.test(text)) return "Doctoral Degree";
  if (/^(professional degree|j\.?d\.?|m\.?d\.?|d\.?d\.?s\.?|dvm|pharm\.?d\.?)$/i.test(text)) return "Professional Degree (JD, MD, DDS, etc.)";
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

function compactSummary(value?: string, maxLength = 140) {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function EditableProfileRecord({
  title,
  subtitle,
  details,
  preview,
  status,
  icon,
  expanded,
  collapseDisabled = false,
  onEdit,
  onCollapse,
  onRemove,
  children,
}: {
  title: string;
  subtitle?: string;
  details?: string[];
  preview?: string;
  status?: React.ReactNode;
  icon: React.ReactNode;
  expanded: boolean;
  collapseDisabled?: boolean;
  onEdit: () => void;
  onCollapse: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <article className={PROFILE_ENTRY_CLASS}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-primary/[0.07] text-primary" aria-hidden="true">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
              {status}
            </div>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {expanded ? (
            <button
              type="button"
              onClick={onCollapse}
              disabled={collapseDisabled}
              aria-expanded="true"
              title={collapseDisabled ? "Complete the required fields before closing this record." : undefined}
              className="rounded px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-transparent"
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={onEdit}
              aria-expanded="false"
              className="rounded px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              Edit
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            Remove
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 border-t border-border/60 pt-4 animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none">
          {children}
        </div>
      ) : (
        <div className="mt-3 pl-9">
          {!!details?.length && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/75">
              {details.map((detail) => <span key={detail}>{detail}</span>)}
            </div>
          )}
          {preview && <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{preview}</p>}
        </div>
      )}
    </article>
  );
}

function initialExpandedEducationIds(
  entries: EducationHistoryEntry[],
  showMissingEducationLevel: boolean,
) {
  if (entries.length <= 3) return new Set(entries.map((entry) => entry.id));

  return new Set(
    entries
      .filter((entry) => entry.isCurrent || (showMissingEducationLevel && !entry.educationLevel?.trim()))
      .map((entry) => entry.id),
  );
}

function EducationHistorySection({
  entries,
  onAdd,
  onRemove,
  onChange,
  showMissingEducationLevel = false,
}: {
  entries: EducationHistoryEntry[];
  onAdd: () => string;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<EducationHistoryEntry>) => void;
  showMissingEducationLevel?: boolean;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => initialExpandedEducationIds(entries, showMissingEducationLevel),
  );
  const knownEducationIdsRef = useRef(new Set(entries.map((entry) => entry.id)));

  useEffect(() => {
    const existingIds = new Set(entries.map((entry) => entry.id));
    const newlySeenEntries = entries.filter((entry) => !knownEducationIdsRef.current.has(entry.id));
    knownEducationIdsRef.current = existingIds;

    setExpandedIds((current) => {
      const next = new Set([...current].filter((id) => existingIds.has(id)));

      newlySeenEntries.forEach((entry) => {
        if (entries.length <= 3 || entry.isCurrent) next.add(entry.id);
      });

      if (showMissingEducationLevel) {
        entries.forEach((entry) => {
          if (!entry.educationLevel?.trim()) next.add(entry.id);
        });
      }

      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [entries, showMissingEducationLevel]);

  function editEntry(id: string) {
    setExpandedIds((current) => new Set(current).add(id));
  }

  function collapseEntry(entry: EducationHistoryEntry) {
    if (showMissingEducationLevel && !entry.educationLevel?.trim()) return;
    setExpandedIds((current) => {
      const next = new Set(current);
      next.delete(entry.id);
      return next;
    });
  }

  function addEntry() {
    const id = onAdd();
    setExpandedIds((current) => new Set(current).add(id));
  }

  return (
    <Card className={PROFILE_SECTION_CLASS}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionLabel>Education History *</SectionLabel>
          <p className="text-xs text-muted-foreground mt-1">
            Review every school or program parsed from your resume in one place.
          </p>
        </div>
        <button type="button" onClick={addEntry} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
          + Add education
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {entries.length === 0 && (
          <div
            className={`rounded-lg border border-dashed p-3 text-sm ${
              showMissingEducationLevel
                ? "border-destructive bg-destructive/10 text-destructive"
                : "border-border text-muted-foreground"
            }`}
          >
            No education entries yet. Add an education entry or upload a resume to autofill this section.
          </div>
        )}
        {entries.map((entry, index) => {
          const expanded = expandedIds.has(entry.id);
          const title = entry.institution?.trim()
            || entry.degreeProgram?.trim()
            || entry.educationLevel?.trim()
            || `Education ${index + 1}`;
          const subtitle = [entry.educationLevel, entry.majorField].filter(Boolean).join(" · ");
          const dates = entry.isCurrent
            ? entry.endDate?.trim() ? `Expected ${entry.endDate}` : "Current education"
            : [entry.startDate, entry.endDate].filter(Boolean).join(" – ");
          const details = [dates, entry.gpa?.trim() ? `GPA ${entry.gpa}` : ""].filter(Boolean);

          return (
            <EditableProfileRecord
              key={entry.id}
              title={title}
              subtitle={subtitle}
              details={details}
              status={entry.isCurrent ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  <Check className="size-3" aria-hidden="true" /> Current
                </span>
              ) : undefined}
              icon={<GraduationCap className="size-4" />}
              expanded={expanded}
              collapseDisabled={showMissingEducationLevel && !entry.educationLevel?.trim()}
              onEdit={() => editEntry(entry.id)}
              onCollapse={() => collapseEntry(entry)}
              onRemove={() => onRemove(entry.id)}
            >
              <div className="space-y-4">
                <fieldset>
                  <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/60">Program</legend>
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
                      invalid={showMissingEducationLevel && !entry.educationLevel?.trim()}
                      errorMessage="Select an education level."
                    />
                    <Input label="Institution" value={entry.institution ?? ""} onChange={(value) => onChange(entry.id, { institution: value })} />
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/60">Academic details</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label="Major / field" value={entry.majorField ?? ""} onChange={(value) => onChange(entry.id, { majorField: value })} />
                    <Input label="GPA" value={entry.gpa ?? ""} onChange={(value) => onChange(entry.id, { gpa: value })} placeholder="3.85" />
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/60">Dates</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label="Start date" value={entry.startDate ?? ""} onChange={(value) => onChange(entry.id, { startDate: value })} placeholder="August 2022" />
                    <Input label="End date / expected graduation" value={entry.endDate ?? ""} onChange={(value) => onChange(entry.id, { endDate: value })} placeholder="May 2026" />
                  </div>
                </fieldset>
              </div>
            </EditableProfileRecord>
          );
        })}
      </div>
    </Card>
  );
}

function initialExpandedExperienceIds(entries: Array<{ id: string }>) {
  const initiallyVisible = entries.length <= 3 ? entries : entries.slice(0, 1);
  return new Set(initiallyVisible.map((entry) => entry.id));
}

function useExpandedExperienceIds(entries: Array<{ id: string }>) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => initialExpandedExperienceIds(entries),
  );
  const knownIdsRef = useRef(new Set(entries.map((entry) => entry.id)));

  useEffect(() => {
    const previousKnownCount = knownIdsRef.current.size;
    const existingIds = new Set(entries.map((entry) => entry.id));
    const newlySeenEntries = entries.filter((entry) => !knownIdsRef.current.has(entry.id));
    knownIdsRef.current = existingIds;

    setExpandedIds((current) => {
      const next = new Set([...current].filter((id) => existingIds.has(id)));

      if (entries.length <= 3) {
        newlySeenEntries.forEach((entry) => next.add(entry.id));
      } else if (previousKnownCount === 0 && next.size === 0 && entries[0]) {
        next.add(entries[0].id);
      }

      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [entries]);

  function expand(id: string) {
    setExpandedIds((current) => new Set(current).add(id));
  }

  function collapse(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  return { expandedIds, expand, collapse };
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
  onAdd: () => string;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<ResearchExperienceEntry>) => void;
}) {
  const { expandedIds, expand, collapse } = useExpandedExperienceIds(entries);

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
          <button type="button" onClick={onToggle} aria-expanded={isOpen} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
            {isOpen ? "Collapse" : "Expand"}
          </button>
          <button type="button" onClick={() => expand(onAdd())} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/30 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
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
          {entries.map((entry, index) => {
            const title = compactSummary(entry.researchAreas, 70)
              || compactSummary(entry.researchProjects, 70)
              || `Research entry ${index + 1}`;
            const subtitle = [entry.advisorLabDepartment, entry.thesisStatus].filter(Boolean).join(" · ");
            const preview = compactSummary(entry.researchProjects || entry.publications);
            return (
              <EditableProfileRecord
                key={entry.id}
                title={title}
                subtitle={subtitle}
                preview={preview}
                icon={<FlaskConical className="size-4" />}
                expanded={expandedIds.has(entry.id)}
                onEdit={() => expand(entry.id)}
                onCollapse={() => collapse(entry.id)}
                onRemove={() => onRemove(entry.id)}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Textarea label="Research areas / concentration" value={entry.researchAreas ?? ""} onChange={(value) => onChange(entry.id, { researchAreas: value })} />
                  <Textarea label="Research projects" value={entry.researchProjects ?? ""} onChange={(value) => onChange(entry.id, { researchProjects: value })} />
                  <Textarea label="Publications" value={entry.publications ?? ""} onChange={(value) => onChange(entry.id, { publications: value })} />
                  <Textarea label="Conferences / presentations / posters" value={entry.conferences ?? ""} onChange={(value) => onChange(entry.id, { conferences: value })} />
                  <Input label="Thesis / dissertation status" value={entry.thesisStatus ?? ""} onChange={(value) => onChange(entry.id, { thesisStatus: value })} />
                  <Input label="Assistantship / fellowship status" value={entry.assistantshipStatus ?? ""} onChange={(value) => onChange(entry.id, { assistantshipStatus: value })} />
                  <Input label="Advisor / lab / department" value={entry.advisorLabDepartment ?? ""} onChange={(value) => onChange(entry.id, { advisorLabDepartment: value })} className="sm:col-span-2" />
                </div>
              </EditableProfileRecord>
            );
          })}
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
  onAdd: () => string;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<WorkExperienceEntry>) => void;
}) {
  const { expandedIds, expand, collapse } = useExpandedExperienceIds(entries);

  return (
    <Card className={PROFILE_SECTION_CLASS}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionLabel>Work & Internship Experience</SectionLabel>
          <p className="text-xs text-muted-foreground mt-1">
            Work, internships, research assistantships, teaching assistantships, and leadership experience.
          </p>
        </div>
        <button type="button" onClick={() => expand(onAdd())} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/30 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
          + Add experience
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {entries.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
            No experience added yet. Add work, internship, research, or project experience when relevant.
          </div>
        )}
        {entries.map((entry, index) => {
          const title = entry.roleTitle?.trim() || entry.organization?.trim() || `Experience ${index + 1}`;
          const subtitle = [entry.organization, entry.experienceType].filter((value) => value && value !== title).join(" · ");
          const dates = [entry.startDate, entry.endDate].filter(Boolean).join(" – ");
          return (
            <EditableProfileRecord
              key={entry.id}
              title={title}
              subtitle={subtitle}
              details={[dates, entry.skillsTechnologies?.trim() || ""].filter(Boolean)}
              preview={compactSummary(entry.description)}
              icon={<BriefcaseBusiness className="size-4" />}
              expanded={expandedIds.has(entry.id)}
              onEdit={() => expand(entry.id)}
              onCollapse={() => collapse(entry.id)}
              onRemove={() => onRemove(entry.id)}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Role / title" value={entry.roleTitle ?? ""} onChange={(value) => onChange(entry.id, { roleTitle: value })} />
                <Input label="Organization / company" value={entry.organization ?? ""} onChange={(value) => onChange(entry.id, { organization: value })} />
                <Select
                  label="Experience type"
                  value={entry.experienceType ?? ""}
                  onChange={(value) => onChange(entry.id, { experienceType: value })}
                  options={["Work", "Internship", "Research Assistant", "Teaching Assistant", "Leadership", "Other"]}
                />
                <Input label="Start date" value={entry.startDate ?? ""} onChange={(value) => onChange(entry.id, { startDate: value })} />
                <Input label="End date" value={entry.endDate ?? ""} onChange={(value) => onChange(entry.id, { endDate: value })} />
                <Input label="Skills / technologies" value={entry.skillsTechnologies ?? ""} onChange={(value) => onChange(entry.id, { skillsTechnologies: value })} />
                <Textarea label="Description / responsibilities" value={entry.description ?? ""} onChange={(value) => onChange(entry.id, { description: value })} className="sm:col-span-2" />
              </div>
            </EditableProfileRecord>
          );
        })}
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

/* ---------------- Step 2: Scholarship Discovery ---------------- */

type DiscoverySource = NonNullable<WikiDiscoveryResult["specific_opportunities"]>[number] & {
  access_note?: string;
  source_authority?: string;
};

type TrustedPlatformGuide = DiscoverySource & {
  description: string;
  bestFor: string;
  matchTerms: string[];
};

const TRUSTED_PLATFORM_GUIDES: TrustedPlatformGuide[] = [
  {
    name: "Bold.org",
    url: "https://bold.org/scholarships/",
    category: "Scholarship platform",
    description: "Smaller donor-funded awards across specific identities, interests, majors, and experiences.",
    bestFor: "Targeted opportunities and no-essay scholarships.",
    matchTerms: ["bold.org", "bold"],
  },
  {
    name: "BigFuture",
    url: "https://bigfuture.collegeboard.org/scholarship-search",
    category: "Scholarship database",
    description: "College Board’s scholarship search alongside college-planning and financial-aid resources.",
    bestFor: "Broad discovery and college financial planning.",
    matchTerms: ["bigfuture", "college board"],
  },
  {
    name: "Fastweb",
    url: "https://www.fastweb.com/",
    category: "Scholarship platform",
    description: "A large scholarship directory that builds recommendations from a student profile.",
    bestFor: "Profile-based lists and monitoring recurring opportunities.",
    matchTerms: ["fastweb"],
  },
  {
    name: "Scholarships.com",
    url: "https://www.scholarships.com/",
    category: "Scholarship directory",
    description: "A large directory organized across academic, personal, geographic, and eligibility categories.",
    bestFor: "Browsing by major, academic level, background, or location.",
    matchTerms: ["scholarships.com"],
  },
];

function discoveryEducationLabel(entry?: EducationHistoryEntry, fallback?: EducationLevel) {
  const normalized = normalizeEducationLevelLabel(entry?.educationLevel)
    || inferEducationLevelLabel(entry ?? {});
  if (/high school/i.test(normalized)) return "High school student";
  if (/associate/i.test(normalized)) return "Associate degree student";
  if (/bachelor/i.test(normalized)) return "Undergraduate student";
  if (/master/i.test(normalized)) return "Graduate student";
  if (/doctoral|doctor|phd/i.test(normalized)) return "Doctoral student";
  if (/professional/i.test(normalized)) return "Professional degree student";
  return fallback ? eduLevelLabel(fallback) : "";
}

function discoveryCitizenshipLabel(value?: string) {
  const citizenship = value?.trim() ?? "";
  if (!citizenship) return "";
  if (/u\.s\. citizen|us citizen|permanent resident/i.test(citizenship)) return "Domestic student";
  if (/international/i.test(citizenship)) return "International student";
  return citizenship;
}

function buildDiscoveryProfileContext(user: UserProfile | null) {
  if (!user) return [];
  const currentEducation = user.educationHistory?.find((entry) => entry.isCurrent);
  const alignedBranch = user.educationLevel === "high_school"
    ? user.highSchool
    : user.educationLevel === "undergrad"
      ? user.undergrad
      : user.graduate;
  const branchMajor = user.educationLevel === "undergrad"
    ? user.undergrad?.major?.trim()
    : user.educationLevel === "grad" || user.educationLevel === "phd"
      ? (user.graduate?.program || user.graduate?.researchArea)?.trim()
      : "";
  const currentLevel = educationLevelCode(currentEducation?.educationLevel);
  const currentMatchesSelectedLevel = !currentEducation
    || !currentLevel
    || currentLevel === user.educationLevel;
  const major = currentEducation?.majorField?.trim()
    || (currentMatchesSelectedLevel ? branchMajor : "");
  const gpa = currentEducation?.gpa?.trim()
    || ("gpa" in (alignedBranch ?? {}) ? String(alignedBranch?.gpa ?? "").trim() : "");
  const values = [
    discoveryEducationLabel(currentEducation, user.educationLevel),
    major,
    discoveryCitizenshipLabel(user.citizenshipStatus),
    user.location?.trim(),
    gpa ? `GPA ${gpa}` : "",
  ].filter((value): value is string => !!value);
  return values.filter(
    (value, index) => values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index,
  );
}

function StepDiscovery({
  onUpdateProfile,
  onUseSource,
}: {
  onUpdateProfile: () => void;
  onUseSource: () => void;
}) {
  const { user, updateProfile } = useUser();
  const wiki = user?.wikiDiscovery;
  const [loading, setLoading] = useState(!wiki);
  const [showResults, setShowResults] = useState(!!wiki);
  const [status, setStatus] = useState<string | null>(
    wiki ? null : "Reviewing your verified profile...",
  );
  const [searchError, setSearchError] = useState("");
  const discoveryRequestStartedRef = useRef(false);
  const [bringValue, setBringValue] = useState("");
  const [bringError, setBringError] = useState("");
  const [platformContext, setPlatformContext] = useState("");

  useEffect(() => {
    if (wiki || discoveryRequestStartedRef.current) return;
    discoveryRequestStartedRef.current = true;
    void refreshWiki();
    // Discovery starts once when this page opens without cached results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshWiki() {
    setLoading(true);
    setShowResults(false);
    setSearchError("");
    setStatus("Looking for scholarships related to your profile...");
    const progressTimer = window.setTimeout(
      () => setStatus("Checking trusted sources and organizing useful places to search..."),
      5000,
    );
    try {
      const result = await discoverScholarshipWiki({
        ...buildWikiPayload(user),
        selected_intents: [],
        free_text_intent: "",
      });
      updateProfile({ wikiDiscovery: result, discoveryFocus: "", discoveryIntents: [] });
      setStatus(result.result_note || "Your discovery results are ready.");
      setShowResults(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "We couldn't complete this search. Please try again.";
      setStatus(message);
      setSearchError(message);
      setShowResults(false);
    } finally {
      window.clearTimeout(progressTimer);
      setLoading(false);
    }
  }

  function selectSourceForExtraction(source: DiscoverySource) {
    const sourceUrl = source.url ?? "";
    const deadlineStatus = source.deadline_status === "open"
      ? "Applications open"
      : source.deadline_status === "upcoming"
        ? "Upcoming application cycle"
        : "Current deadline needs confirmation";
    const transferNotes = [
      source.category && `Source category: ${source.category}`,
      source.source_authority && `Source authority: ${source.source_authority}`,
      source.award_amount && `Award amount: ${source.award_amount}`,
      source.deadline_window && `Deadline: ${source.deadline_window}`,
      `Discovery deadline status: ${deadlineStatus}`,
      source.why_recommended && `Why this appeared in discovery: ${source.why_recommended}`,
      source.status_note,
    ].filter(Boolean).join("\n");
    updateProfile({
      activeScholarship: {
        name: source.name ?? "",
        url: sourceUrl,
        officialWebsite: sourceUrl,
        awardAmount: source.award_amount ?? "",
        applicationDeadline: source.deadline_window ?? "",
        currentStatus: deadlineStatus,
        description: source.why_recommended ?? "",
        importantNotes: source.status_note ? [source.status_note] : [],
        sourceUrls: sourceUrl ? [sourceUrl] : [],
        discoverySource: "Scholar-E discovery",
        discoverySourceKind: "scholarship",
        additionalNotes: transferNotes,
      },
      fitAnalysis: undefined,
      personalizedOutline: undefined,
    });
    onUseSource();
  }

  function toggleSaved(source: DiscoverySource, kind: "scholarship" | "platform") {
    const id = (source.url || source.name || "").toLowerCase();
    if (!id) return;
    const saved = user?.savedWikiSources ?? [];
    const exists = saved.some((item) => item.id === id);
    updateProfile({
      savedWikiSources: exists
        ? saved.filter((item) => item.id !== id)
        : [...saved, {
            id,
            name: source.name || "Saved discovery source",
            url: source.url,
            category: source.category || kind,
            notes: source.why_recommended,
            saved_at: new Date().toISOString(),
          }],
    });
    setStatus(exists ? "Removed from saved opportunities." : "Saved for later.");
  }

  function rememberPlatform(source: DiscoverySource) {
    setPlatformContext(source.name || "the platform");
  }

  function resizeScholarshipInput(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 168), 360)}px`;
  }

  function continueWithOwnOpportunity() {
    const raw = bringValue.trim();
    if (!raw) {
      setBringError("Paste a scholarship URL, description, or listing details first.");
      return;
    }
    const platformOnly = platformSources.some(
      (platform) => (platform.name || "").trim().toLowerCase() === raw.toLowerCase(),
    );
    if (platformOnly) {
      setPlatformContext(raw);
      setBringError(`${raw} is a search platform. Paste a particular scholarship name, listing, or link from it.`);
      return;
    }
    setBringError("");
    const url = raw.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.;]+$/, "") ?? "";
    const withoutUrl = raw.replace(url, "").replace(/^\s*(found on [^:]+:)?\s*/i, "").trim();
    const name = withoutUrl.length <= 180 ? withoutUrl : withoutUrl.split(/\r?\n|[.!?]/)[0].slice(0, 180);
    updateProfile({
      activeScholarship: {
        name,
        url,
        additionalNotes: [platformContext && `Discovered on platform: ${platformContext}`, raw].filter(Boolean).join("\n"),
        discoverySource: platformContext || "User-provided discovery",
        discoverySourceKind: "user_entry",
      },
      fitAnalysis: undefined,
      personalizedOutline: undefined,
    });
    onUseSource();
  }

  const hasWiki = !!wiki;
  const dismissedUrls = new Set(user?.dismissedDiscoveryUrls ?? []);
  const directSources = (wiki?.specific_opportunities ?? []).filter((source) => !dismissedUrls.has(source.url ?? "")).slice(0, 3);
  const apiPlatforms = (wiki?.top_free_platforms ?? []).filter((source) => source.name && source.url);
  const returnedPlatforms = [...apiPlatforms, ...(user?.discoveryPlatformDefaults ?? [])]
    .filter((source, index, sources) => sources.findIndex((candidate) => candidate.url === source.url) === index);
  const platformSources = TRUSTED_PLATFORM_GUIDES.map((guide) => {
    const existing = returnedPlatforms.find((source) => {
      const identity = `${source.name ?? ""} ${source.url ?? ""}`.toLowerCase();
      return guide.matchTerms.some((term) => identity.includes(term));
    });
    return {
      ...guide,
      ...existing,
      name: guide.name,
      url: existing?.url || guide.url,
      description: guide.description,
      bestFor: guide.bestFor,
      matchTerms: guide.matchTerms,
    };
  });
  const savedIds = new Set((user?.savedWikiSources ?? []).map((item) => item.id));
  const resultsVisible = showResults && hasWiki;
  const profileContext = buildDiscoveryProfileContext(user);

  return (
    <div className="space-y-5 pb-5">
      <header className="border-b border-info/10 pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight">Scholarship Discovery</h2>
            <p className="mt-1.5 max-w-2xl text-[15px] leading-6 text-foreground/75">
              Paste a scholarship you found, or use one of the trusted sources below to find one.
            </p>
          </div>
          {hasWiki && (
            <button
              type="button"
              onClick={refreshWiki}
              disabled={loading}
              className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-info/15 bg-card px-3 py-2 text-xs font-semibold text-foreground/70 transition-colors hover:border-info/30 hover:bg-accent/70 hover:text-foreground disabled:cursor-wait disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35"
            >
              {loading ? "Refreshing…" : "Refresh results"}
            </button>
          )}
        </div>
      </header>

      <section
        aria-labelledby="verified-profile-heading"
        className="flex flex-col gap-2 border-b border-success/25 pb-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-success/12 text-success">
            <Check className="size-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 id="verified-profile-heading" className="text-sm font-semibold text-foreground">
              Using your verified profile
            </h3>
          {profileContext.length ? (
            <ul className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Profile details used for analysis">
              {profileContext.map((item, index) => (
                <li key={item} className="inline-flex items-center gap-2 text-sm text-foreground/75">
                  {index > 0 && <span className="text-success/70" aria-hidden="true">·</span>}
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-foreground/70">
              Add profile details to improve the comparison in Step 3.
            </p>
          )}
          </div>
        </div>
        <button
          type="button"
          onClick={onUpdateProfile}
          className="shrink-0 self-start text-xs font-semibold text-info underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35 sm:self-center"
        >
          Edit profile
        </button>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.9fr)_minmax(280px,1fr)] lg:items-start">
        <section
          className="border-l-2 border-info/65 py-1 pl-4 pr-0 sm:pl-5"
          aria-labelledby="analyze-scholarship-heading"
        >
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-info/10 text-info">
              <ClipboardList className="size-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold uppercase tracking-[0.14em] text-info">
                Already found a scholarship?
              </div>
              <h3 id="analyze-scholarship-heading" className="mt-1 font-display text-[1.75rem] font-bold leading-tight">
                Paste a scholarship
              </h3>
            </div>
          </div>
          <p className="mt-2.5 max-w-2xl text-[15px] leading-6 text-foreground/80">
            Paste a scholarship URL or copied listing. Scholar-E will extract the requirements and compare them with your student profile.
          </p>

          <div className="mt-3.5">
          <label htmlFor="bring-opportunity" className="text-sm font-semibold text-foreground">
            Scholarship link or details
          </label>
          <textarea
            id="bring-opportunity"
            rows={4}
            value={bringValue}
            onChange={(event) => {
              setBringValue(event.target.value);
              resizeScholarshipInput(event.currentTarget);
              if (bringError) setBringError("");
            }}
            aria-invalid={!!bringError || undefined}
            aria-describedby={bringError ? "bring-opportunity-help bring-opportunity-error" : "bring-opportunity-help"}
            placeholder="Paste a scholarship link or copied scholarship details…"
            className="mt-1.5 min-h-[168px] w-full resize-y overflow-y-auto rounded-lg border border-info/20 bg-accent/20 px-4 py-3 text-sm leading-6 text-foreground shadow-inner shadow-info/[0.02] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-foreground/55 focus:border-info/70 focus:bg-white focus:ring-3 focus:ring-info/20"
          />
          {bringError && (
            <p id="bring-opportunity-error" role="alert" className="mt-2 text-xs font-medium text-destructive">
              {bringError}
            </p>
          )}
          <div id="bring-opportunity-help" className="mt-4 rounded-lg bg-success/[0.035] px-3 py-2.5 text-sm leading-6 text-foreground/80">
            <div className="font-semibold text-foreground">Supported inputs</div>
            <ul className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-2" aria-label="Accepted scholarship input formats">
              {["Scholarship URL", "Scholarship page or listing", "Copied eligibility requirements", "Application description"].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Check className="mt-1 size-3.5 shrink-0 text-success" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={continueWithOwnOpportunity}
              disabled={!bringValue.trim()}
              className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-[background-color,opacity,box-shadow] hover:bg-primary/90 hover:shadow-md disabled:cursor-not-allowed disabled:bg-accent disabled:text-muted-foreground disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/45 focus-visible:ring-offset-2 sm:w-auto"
            >
              Analyze Scholarship <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          </div>
          </div>
        </section>

        <section
          aria-labelledby="find-scholarship-heading"
          className="rounded-lg border border-info/10 bg-accent/35 p-4"
        >
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.14em] text-info">
              Need help finding one?
            </div>
            <h3 id="find-scholarship-heading" className="mt-1 font-display text-2xl font-bold leading-tight">
              Trusted scholarship platforms
            </h3>
            <p className="mt-1.5 text-[15px] leading-6 text-foreground/80">
              Browse a trusted platform, choose a scholarship, then return and paste it here.
            </p>
          </div>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
            {platformSources.map((source, index) => (
              <a
                key={`platform-${source.url || source.name}`}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => rememberPlatform(source)}
                aria-label={`Open ${source.name} in a new tab`}
                className="group rounded-lg border border-info/10 bg-white/80 p-3 transition-[border-color,background-color,box-shadow,transform] motion-safe:hover:-translate-y-0.5 hover:border-info/35 hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35"
              >
                <div className="flex items-start gap-3">
                  <div className={`grid size-8 shrink-0 place-items-center rounded-full font-display text-sm font-bold ${index === 2 ? "bg-success/12 text-success" : index === 1 ? "bg-secondary text-info" : index === 3 ? "bg-success/10 text-success" : "bg-info/10 text-info"}`}>
                    {source.name?.charAt(0) || "P"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-display text-base font-bold leading-tight">{source.name}</div>
                      <ArrowRight className="size-3.5 shrink-0 -rotate-45 text-info/65 transition-colors group-hover:text-info" aria-hidden="true" />
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-4 text-foreground/70">{source.description}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-4 text-foreground/75">
                      <span className="font-semibold text-success">Best used for:</span> {source.bestFor}
                    </p>
                  </div>
                </div>
              </a>
            ))}
          </div>

          {resultsVisible && !directSources.length && !loading && (
            <p className="mt-3 text-xs leading-5 text-foreground/65">
              Scholar-E did not find a recommendation it could verify confidently, so these trusted sources are the best places to continue.
            </p>
          )}
        </section>
      </div>

      {loading && (
        <section className="border-t border-border/70 pt-6" aria-labelledby="recommendation-search-heading">
          <div className="flex items-start gap-3">
            <Spinner className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <h3 id="recommendation-search-heading" className="text-sm font-semibold">
                Looking for additional Scholar-E suggestions
              </h3>
              <p role="status" aria-live="polite" className="mt-1 text-sm leading-5 text-foreground/70">
                {status}
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[0, 1].map((item) => <Skeleton key={item} className="h-24 rounded-xl" />)}
          </div>
        </section>
      )}

      {!resultsVisible && !loading && (
        <section className="flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p role="alert" className="max-w-2xl text-sm leading-6 text-foreground/70">
            {searchError || "Scholar-E couldn’t refresh suggestions right now. You can still paste a scholarship above or use one of the trusted sources."}
          </p>
          <button
            type="button"
            onClick={refreshWiki}
            className="shrink-0 self-start rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:self-center"
          >
            Retry suggestions
          </button>
        </section>
      )}

      {resultsVisible && !loading && directSources.length > 0 && (
        <section aria-labelledby="scholar-e-suggestions-heading" className="border-t border-border/70 pt-7">
          <div className="mb-4">
            <h3 id="scholar-e-suggestions-heading" className="font-display text-2xl font-bold">
              Scholar-E suggestions
            </h3>
            <p className="mt-1 text-[15px] leading-6 text-foreground/70">
              These are discovery leads only. Eligibility and current deadlines are checked in the next step.
            </p>
          </div>
          <div className="space-y-3">
            {directSources.map((source) => (
              <DiscoverySourceCard
                key={`direct-${source.url || source.name}`}
                source={source}
                mode="scholarship"
                saved={savedIds.has((source.url || source.name || "").toLowerCase())}
                onExplore={() => selectSourceForExtraction(source)}
                onSave={() => toggleSaved(source, "scholarship")}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DiscoverySourceCard({
  source,
  saved,
  onExplore,
  onSave,
}: {
  source: DiscoverySource;
  mode: "scholarship";
  saved: boolean;
  onExplore: () => void;
  onSave: () => void;
}) {
  const deadlineLabel = source.deadline_status === "open"
    ? "Applications open"
    : source.deadline_status === "upcoming"
      ? "Upcoming application cycle"
      : "Confirm current deadline";
  const deadlineTone = source.deadline_status === "open"
    ? "bg-success/10 text-success"
    : source.deadline_status === "upcoming"
      ? "bg-primary/10 text-primary"
      : "bg-amber-100 text-amber-800";
  return (
    <article className="group rounded-2xl border border-white/90 bg-white/90 p-5 shadow-sm transition hover:border-primary/20 hover:shadow-md">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-primary/[0.07] font-display text-sm font-bold text-primary">
              {source.name?.charAt(0) || "S"}
            </div>
            <div className="min-w-0">
              <h4 className="font-display text-xl font-bold leading-tight">{source.name}</h4>
              {source.category && <p className="mt-1 text-xs text-muted-foreground">{source.category}</p>}
              {source.why_recommended && <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground/70">{source.why_recommended}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${deadlineTone}`}>{deadlineLabel}</span>
                {source.status_note && <span className="text-xs text-muted-foreground">{source.status_note}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
          {(source.deadline_window || source.award_amount) && (
            <div className="mr-1 hidden max-w-52 text-right lg:block">
              {source.deadline_window && <div className="text-xs font-medium text-foreground">{source.deadline_window}</div>}
              {source.award_amount && <div className="mt-1 truncate text-xs text-muted-foreground">{source.award_amount}</div>}
            </div>
          )}
          <button onClick={onSave} aria-label={saved ? "Remove from saved" : "Save for later"} className={`rounded-full border p-2.5 ${saved ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-white text-muted-foreground hover:bg-accent"}`}>
            {saved ? <Check className="size-4" /> : <Save className="size-4" />}
          </button>
          {source.url && (
            <button onClick={() => window.open(source.url, "_blank", "noopener,noreferrer")} className="rounded-xl border border-border bg-white px-3 py-2.5 text-xs font-medium hover:bg-accent">
              Official site
            </button>
          )}
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-border/70 bg-secondary/35 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-4.5" />
          </span>
          <div>
            <h5 className="font-display text-base font-bold">Worth a closer look?</h5>
            <p className="mt-1 text-sm leading-5 text-foreground/70">
              Select this opportunity to collect its official requirements and evaluate how well it aligns with your profile.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onExplore}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-primary/30 bg-white px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          Use this scholarship <ArrowRight className="size-4" />
        </button>
      </div>
    </article>
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
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:opacity-90"
              >
                Paste real opportunity
                <ArrowRight className="size-3.5" />
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

function WorkflowStep({
  number,
  title,
  description,
  complete,
  active,
  locked = false,
  lockedMessage,
  headingId,
  isLast = false,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  complete?: boolean;
  active?: boolean;
  locked?: boolean;
  lockedMessage?: string;
  headingId?: string;
  isLast?: boolean;
  children: React.ReactNode;
}) {
  const stepTone = number === 1
    ? {
        marker: "border-success bg-success text-white shadow-sm shadow-success/20",
        accent: "bg-success",
        line: "border-success/35",
        label: "text-success",
        panel: "border-success/25 bg-success/[0.025]",
        lockedPanel: "border-success/15 bg-success/[0.018]",
      }
    : number === 2
      ? {
          marker: "border-info bg-info text-white shadow-sm shadow-info/20",
          accent: "bg-info",
          line: "border-info/35",
          label: "text-info",
          panel: "border-info/25 bg-info/[0.018]",
          lockedPanel: "border-info/15 bg-accent/20",
        }
      : {
          marker: "border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/20",
          accent: "bg-primary",
          line: "border-primary/30",
          label: "text-primary",
          panel: "border-primary/20 bg-secondary/25",
          lockedPanel: "border-primary/12 bg-secondary/20",
        };
  const showCompleteMarker = !!complete && !active;
  const markerClass = active
    ? stepTone.marker
    : showCompleteMarker
      ? "border-success bg-success text-white shadow-sm shadow-success/20"
      : "border-border/80 bg-background text-muted-foreground";
  const connectorClass = showCompleteMarker
    ? "border-success/45"
    : active
      ? stepTone.line
      : "border-border/65";
  const panelClass = locked
    ? `border-dashed shadow-none ${stepTone.lockedPanel}`
    : active
      ? `shadow-sm ${stepTone.panel}`
      : showCompleteMarker
        ? "border-success/15 bg-white shadow-sm"
        : "border-border/70 bg-white shadow-sm";
  const accentClass = locked
    ? "bg-border/70"
    : active
      ? stepTone.accent
      : showCompleteMarker
        ? "bg-success"
        : "bg-border";

  return (
    <section
      className={`group relative grid gap-4 transition-[opacity,transform] duration-200 motion-reduce:transform-none motion-reduce:transition-none md:grid-cols-[76px_1fr] ${locked ? "translate-y-1 opacity-80" : "translate-y-0 opacity-100"}`}
      aria-disabled={locked || undefined}
      aria-labelledby={headingId}
      aria-describedby={locked && lockedMessage ? `${headingId ?? `workflow-step-${number}`}-locked-message` : undefined}
      tabIndex={locked ? 0 : undefined}
    >
      <div className="relative hidden md:flex justify-center">
        <div className={`relative z-10 grid size-12 place-items-center rounded-full border-2 text-sm font-semibold transition-[background-color,border-color,color,box-shadow] duration-200 motion-reduce:transition-none ${markerClass}`}>
          {showCompleteMarker ? <Check className="size-5" strokeWidth={3} /> : number}
        </div>
        {!isLast && <div className={`absolute left-1/2 top-12 h-[calc(100%+2rem)] -translate-x-1/2 border-l-2 border-dashed transition-colors duration-200 motion-reduce:transition-none ${connectorClass}`} />}
      </div>
      <div className="min-w-0">
        <div className="relative pb-4">
          <div className="pointer-events-none absolute right-0 top-[-18px] hidden select-none font-display text-8xl font-bold leading-none text-primary/5 md:block">
            {String(number).padStart(2, "0")}
          </div>
          <div className="flex items-center gap-3 md:hidden">
            <div className={`grid size-10 place-items-center rounded-full border-2 text-sm font-semibold transition-[background-color,border-color,color,box-shadow] duration-200 motion-reduce:transition-none ${markerClass}`}>
              {showCompleteMarker ? <Check className="size-4" strokeWidth={3} /> : number}
            </div>
            <div className={`text-xs font-semibold uppercase tracking-widest ${active ? stepTone.label : "text-muted-foreground"}`}>Step {number}</div>
          </div>
          <div className={`hidden text-sm font-semibold uppercase tracking-widest md:block ${active ? stepTone.label : "text-muted-foreground"}`}>Step {number}</div>
          <h3 id={headingId} tabIndex={headingId && !locked ? -1 : undefined} className="mt-1 scroll-mt-20 font-display text-2xl font-bold leading-tight text-foreground">{title}</h3>
          {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground/65">{description}</p>}
          {locked && lockedMessage && (
            <p id={`${headingId ?? `workflow-step-${number}`}-locked-message`} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Lock className="size-3.5" aria-hidden="true" />
              {lockedMessage}
            </p>
          )}
        </div>
        <div className={`overflow-hidden rounded-xl border transition-[border-color,background-color,box-shadow] duration-200 motion-reduce:transition-none ${panelClass}`}>
          <div className={`h-1 ${accentClass}`} />
          <div inert={locked ? true : undefined} className={locked ? "pointer-events-none select-none p-4 md:p-5" : "p-5 md:p-6"}>{children}</div>
        </div>
      </div>
    </section>
  );
}

function ScholarshipDetailsCard({
  scholarship,
  updateScholarship,
  onExtract,
  extracting,
  extractionStatus,
  extractionError,
  complete,
  active,
}: {
  scholarship: ActiveScholarship;
  updateScholarship: (patch: ActiveScholarship) => void;
  onExtract: () => void;
  extracting: boolean;
  extractionStatus: string | null;
  extractionError: string | null;
  complete?: boolean;
  active?: boolean;
}) {
  return (
    <WorkflowStep
      number={1}
      title="Confirm scholarship details"
      description="We carried over the scholarship you entered during discovery. Review or correct the details, then extract the available requirements."
      complete={complete}
      active={active}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Scholarship name"
          value={scholarship.name ?? ""}
          onChange={(name) => updateScholarship({ name })}
          placeholder="Coca-Cola Scholars Program, Gates Scholarship..."
          className="sm:col-span-2"
          controlClassName="focus:!border-info/70 focus:!ring-info/20"
        />
        <Input
          label="Scholarship URL"
          value={scholarship.url ?? ""}
          onChange={(url) => updateScholarship({ url })}
          placeholder="https://... or source name"
          className="sm:col-span-2"
          controlClassName="focus:!border-info/70 focus:!ring-info/20"
        />
      </div>
      <Textarea
        label="Additional Notes (Optional)"
        value={scholarship.additionalNotes ?? ""}
        onChange={(additionalNotes) => updateScholarship({ additionalNotes })}
        placeholder="Paste copied scholarship text, eligibility details, award amount, deadlines, essay prompts, or anything else that may help Scholar-E extract requirements."
        rows={3}
        controlClassName="focus:!border-info/70 focus:!ring-info/20"
      />
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onExtract}
          disabled={extracting}
          aria-busy={extracting}
          className={`group inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-[background-color,box-shadow,opacity] duration-150 hover:bg-primary/90 hover:shadow-md active:shadow-none disabled:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/40 focus-visible:ring-offset-2 ${extracting ? "agent-loading" : ""}`}
        >
          {extracting && <Spinner className="size-4" />}
          {extracting ? "Extracting requirements…" : <>Extract Requirements <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5 group-disabled:translate-x-0 motion-reduce:transform-none motion-reduce:transition-none" aria-hidden="true" /></>}
        </button>
      </div>
      {extractionStatus && <p className="mt-3 text-xs text-muted-foreground text-right">{extractionStatus}</p>}
      {extractionError && <p className="mt-3 text-xs text-destructive text-right">{extractionError}</p>}
    </WorkflowStep>
  );
}

function isReviewFieldMissing(value?: string) {
  const text = String(value ?? "").trim();
  return !text || /^(not found|n\/a|none|unknown|unclear)$/i.test(text);
}

type ReviewedWordCount = { value: number | null; reviewed: boolean; valid: boolean };

function parseReviewedWordCount(value: string): ReviewedWordCount {
  const normalized = value.trim().toLocaleUpperCase();
  if (!normalized) return { value: null, reviewed: false, valid: false };
  if (["N/A", "NA", "—", "-"].includes(normalized)) return { value: null, reviewed: true, valid: true };
  if (!/^\d+$/.test(normalized)) return { value: null, reviewed: false, valid: false };
  const numeric = Number(normalized);
  return { value: numeric, reviewed: true, valid: Number.isSafeInteger(numeric) && numeric >= 0 };
}

function wordCountDraft(value: number | null, reviewed?: boolean) {
  if (!reviewed) return "";
  return value === null ? "N/A" : String(value);
}

function PromptReviewRow({
  entry,
  index,
  selected,
  onToggle,
  onSave,
  onRemove,
}: {
  entry: EssayPromptEntry;
  index: number;
  selected: boolean;
  onToggle: () => void;
  onSave: (patch: Partial<EssayPromptEntry>) => void;
  onRemove: () => void;
}) {
  const validationId = useId();
  const [editing, setEditing] = useState(() => !entry.promptText.trim());
  const [promptText, setPromptText] = useState(entry.promptText);
  const [minimumWords, setMinimumWords] = useState(() => wordCountDraft(entry.minimumWords, entry.minimumWordsReviewed));
  const [maximumWords, setMaximumWords] = useState(() => wordCountDraft(entry.maximumWords, entry.maximumWordsReviewed));

  useEffect(() => {
    if (editing) return;
    setPromptText(entry.promptText);
    setMinimumWords(wordCountDraft(entry.minimumWords, entry.minimumWordsReviewed));
    setMaximumWords(wordCountDraft(entry.maximumWords, entry.maximumWordsReviewed));
  }, [editing, entry]);

  const parsedMinimum = parseReviewedWordCount(minimumWords);
  const parsedMaximum = parseReviewedWordCount(maximumWords);
  const rangeInvalid = parsedMinimum.valid
    && parsedMaximum.valid
    && parsedMinimum.value !== null
    && parsedMaximum.value !== null
    && parsedMinimum.value > parsedMaximum.value;
  const canSave = !!promptText.trim() && parsedMinimum.valid && parsedMaximum.valid && !rangeInvalid;
  const inferredLimits = extractPromptWordLimits(entry.promptText);
  const minimumIsUnambiguouslyAbsent = entry.minimumWords === null
    && inferredLimits.minimumWords === null
    && inferredLimits.maximumWords !== null;
  const maximumIsUnambiguouslyAbsent = entry.maximumWords === null
    && inferredLimits.maximumWords === null
    && inferredLimits.minimumWords !== null;
  const minimumResolved = entry.minimumWordsReviewed === true || minimumIsUnambiguouslyAbsent;
  const maximumResolved = entry.maximumWordsReviewed === true || maximumIsUnambiguouslyAbsent;
  const minimumDisplay = minimumResolved ? entry.minimumWords ?? "N/A" : "Needs review";
  const maximumDisplay = maximumResolved ? entry.maximumWords ?? "N/A" : "Needs review";

  function cancelEditing() {
    setPromptText(entry.promptText);
    setMinimumWords(wordCountDraft(entry.minimumWords, entry.minimumWordsReviewed));
    setMaximumWords(wordCountDraft(entry.maximumWords, entry.maximumWordsReviewed));
    setEditing(false);
  }

  function saveEditing() {
    if (!canSave) return;
    onSave({
      promptText: promptText.trim(),
      minimumWords: parsedMinimum.value,
      maximumWords: parsedMaximum.value,
      minimumWordsReviewed: parsedMinimum.reviewed,
      maximumWordsReviewed: parsedMaximum.reviewed,
    });
    setEditing(false);
  }

  return (
    <article className={`my-2 rounded-lg border px-3 py-3 transition-[border-color,background-color,box-shadow,transform] duration-150 motion-safe:hover:-translate-y-px motion-reduce:transform-none motion-reduce:transition-none ${selected ? "border-info/65 bg-info/[0.10] shadow-sm hover:border-info/75 hover:bg-info/[0.12] focus-within:border-info/75 focus-within:bg-info/[0.12]" : "border-info/15 bg-white/85 hover:border-info/35 hover:bg-info/[0.035] hover:shadow-sm focus-within:border-info/40 focus-within:bg-info/[0.035]"}`}>
      <div className="flex items-start gap-3">
        <label className="mt-0.5 inline-flex min-h-8 min-w-8 cursor-pointer items-start justify-center pt-1" aria-label={`Select Prompt ${index + 1}`}>
          <input type="checkbox" checked={selected} onChange={onToggle} className="size-4 rounded border-border text-info focus:ring-2 focus:ring-info/30" />
        </label>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground">Prompt {index + 1}</h4>
            {!editing && (
              <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-8 items-center gap-1 rounded px-1 text-[11px] font-medium text-info/65 transition-colors hover:text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35 focus-visible:ring-offset-1">
                <PencilLine className="size-3.5" aria-hidden="true" />
                Edit
              </button>
            )}
          </div>

          {editing ? (
            <div className="mt-3 space-y-3">
              <SnapshotEditField label="Prompt text" value={promptText} onChange={setPromptText} multiline />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-foreground/75">Minimum words</span>
                  <input value={minimumWords} onChange={(event) => setMinimumWords(event.target.value)} inputMode="numeric" placeholder="Enter a number or N/A" aria-invalid={!parsedMinimum.valid || rangeInvalid} aria-describedby={!parsedMinimum.valid || rangeInvalid ? validationId : undefined} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-info focus:ring-2 focus:ring-info/15" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-foreground/75">Maximum words</span>
                  <input value={maximumWords} onChange={(event) => setMaximumWords(event.target.value)} inputMode="numeric" placeholder="Enter a number or N/A" aria-invalid={!parsedMaximum.valid || rangeInvalid} aria-describedby={!parsedMaximum.valid || rangeInvalid ? validationId : undefined} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-info focus:ring-2 focus:ring-info/15" />
                </label>
              </div>
              {(!parsedMinimum.valid || !parsedMaximum.valid || rangeInvalid || !promptText.trim()) && (
                <p id={validationId} role="alert" className="text-xs text-warning">
                  {!promptText.trim() ? "Enter prompt text." : rangeInvalid ? "Minimum words cannot be greater than maximum words." : "Enter a nonnegative number or N/A for both word-count fields."}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={saveEditing} disabled={!canSave} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40">Save</button>
                <button type="button" onClick={cancelEditing} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
                <button type="button" onClick={onRemove} className="ml-auto text-xs font-medium text-muted-foreground hover:text-destructive">Remove prompt</button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{entry.promptText || "Prompt text needs review."}</p>
              <dl className="mt-2 flex flex-col gap-1 text-xs sm:flex-row sm:gap-x-6">
                <div className="flex gap-1"><dt className="text-muted-foreground">Minimum words:</dt><dd className={`font-semibold ${minimumResolved ? "text-foreground" : "text-warning"}`}>{minimumDisplay}</dd></div>
                <div className="flex gap-1"><dt className="text-muted-foreground">Maximum words:</dt><dd className={`font-semibold ${maximumResolved ? "text-foreground" : "text-warning"}`}>{maximumDisplay}</dd></div>
              </dl>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function SnapshotValue({
  label,
  value,
  tone = "default",
  className = "",
}: {
  label: string;
  value?: string;
  tone?: "default" | "success" | "warning" | "info";
  className?: string;
}) {
  if (isReviewFieldMissing(value)) return null;
  const toneClass = tone === "success"
    ? "border-success/15 bg-success/[0.035]"
    : tone === "warning"
      ? "border-warning/15 bg-warning/[0.035]"
      : tone === "info"
        ? "border-info/15 bg-info/[0.035]"
        : "border-border/60 bg-secondary/20";
  const labelClass = tone === "success"
    ? "text-success"
    : tone === "warning"
      ? "text-warning"
      : tone === "info"
        ? "text-info"
        : "text-muted-foreground";
  return (
    <div className={`min-w-0 rounded-lg border px-3 py-2.5 transition-[border-color,box-shadow,transform] duration-150 motion-safe:hover:-translate-y-px hover:border-current/25 hover:shadow-sm motion-reduce:transform-none motion-reduce:transition-none ${toneClass} ${className}`}>
      <div className={`text-[10px] font-semibold uppercase tracking-wide ${labelClass}`}>{label}</div>
      <div className="mt-1 text-sm font-medium leading-5 text-foreground">{value}</div>
    </div>
  );
}

function SnapshotEditField({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-[11px] font-semibold text-foreground/75">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          rows={3}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 focus:border-info focus:ring-2 focus:ring-info/15"
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 focus:border-info focus:ring-2 focus:ring-info/15"
        />
      )}
    </label>
  );
}

function EditableScholarshipFields({
  scholarship,
  updateScholarship,
  onAnalyze,
  analyzing,
  analysisStatus,
  complete,
  active,
  locked,
}: {
  scholarship: ActiveScholarship;
  updateScholarship: (patch: ActiveScholarship) => void;
  onAnalyze: () => void;
  analyzing: boolean;
  analysisStatus: string | null;
  complete?: boolean;
  active?: boolean;
  locked?: boolean;
}) {
  const docsValue = (scholarship.requiredDocumentTypes ?? []).join(", ");
  const hasExtractedDetails = !!scholarship.extractionCompletedAt;
  const listValue = (items?: string[]) => (items ?? []).join("\n");
  const parseList = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
  const requiredMaterialsValue = listValue(scholarship.requiredApplicationMaterials);
  const [editingSnapshot, setEditingSnapshot] = useState(false);
  const [pendingNoEssayConfirmation, setPendingNoEssayConfirmation] = useState(false);
  const promptEntries = normalizeEssayPromptEntries(scholarship);
  const promptTexts = promptEntries.map((entry) => entry.promptText.trim().toLocaleLowerCase()).filter(Boolean);
  const materialCandidates = [
    ...(scholarship.requiredDocumentTypes ?? []),
    ...(scholarship.requiredApplicationMaterials ?? []),
    scholarship.otherRequiredMaterials ?? "",
  ].flatMap((item) => String(item).split(/\n|,|;/));
  const requiredMaterials = Array.from(new Set(materialCandidates.flatMap((item) => {
    const value = item.replace(/\s+/g, " ").trim();
    const normalizedValue = value.toLocaleLowerCase();
    if (!value || promptTexts.includes(normalizedValue)) return [];
    const recognized: string[] = [];
    if (/\b(?:essays?|personal statements?|short[- ]answers?)\b/i.test(value)) recognized.push("Essay");
    if (/\bresumes?\b|curriculum vitae|\bcvs?\b/i.test(value)) recognized.push("Resume");
    if (/\btranscripts?\b/i.test(value)) recognized.push("Transcript");
    if (/\b(?:recommendation|reference) letters?\b|letters? of (?:recommendation|reference)/i.test(value)) recognized.push("Recommendation letter");
    if (/\bportfolios?\b/i.test(value)) recognized.push("Portfolio");
    if (/\bproof of (?:enrollment|eligibility|residency|citizenship)\b/i.test(value)) recognized.push(value);
    if (/\b(?:fafsa|financial aid form)\b/i.test(value)) recognized.push("Financial aid information");
    if (/\bapplication form\b/i.test(value)) recognized.push("Application form");
    if (recognized.length > 0) return recognized;
    const appearsInsidePrompt = promptTexts.some((prompt) => normalizedValue.length > 10 && prompt.includes(normalizedValue));
    const looksLikePromptFragment = appearsInsidePrompt
      || /\b\d{1,5}\s*(?:words?|characters?)\b/i.test(value)
      || /^(?:describe|explain|discuss|tell us|in \d+ words?|equity|and inclusion centric|inclusion centric)\b/i.test(value)
      || value.endsWith("?")
      || value.length > 80;
    return looksLikePromptFragment ? [] : [value];
  }))).filter((material, index, materials) => (
    materials.findIndex((candidate) => candidate.toLocaleLowerCase() === material.toLocaleLowerCase()) === index
  ));
  const essayRequiredByMaterials = requiredMaterials.some((item) => /\bessay|personal statement|short[- ]answer\b/i.test(item));
  const validPromptIds = new Set(promptEntries.map((entry) => entry.id));
  const noEssayPromptSelected = !!scholarship.noEssayPromptSelected;
  const selectedPromptIds = noEssayPromptSelected
    ? []
    : (scholarship.selectedEssayPromptIds ?? []).filter((id) => validPromptIds.has(id));
  const selectedPromptIdSet = new Set(selectedPromptIds);
  const selectedPromptEntries = promptEntries.filter((entry) => selectedPromptIdSet.has(entry.id));
  const promptEntryIsValid = (entry: EssayPromptEntry) => {
    const rangeValid = entry.minimumWords === null || entry.maximumWords === null || entry.minimumWords <= entry.maximumWords;
    return !!entry.promptText.trim() && entry.minimumWordsReviewed === true && entry.maximumWordsReviewed === true && rangeValid;
  };
  const promptDecisionMade = noEssayPromptSelected || selectedPromptEntries.length > 0;
  const noEssayDecisionValid = noEssayPromptSelected
    && (!essayRequiredByMaterials || !!scholarship.noEssayPromptConflictConfirmed);
  const selectedPromptDecisionValid = selectedPromptEntries.length > 0 && selectedPromptEntries.every(promptEntryIsValid);
  const promptDecisionValid = noEssayDecisionValid || selectedPromptDecisionValid;
  const essentialValues = [
    scholarship.name,
    scholarship.organization,
    scholarship.awardAmount,
    scholarship.applicationDeadline,
    scholarship.officialWebsite ?? scholarship.url,
    scholarship.enrollmentLevel,
    requiredMaterials.join(", "),
  ];
  const hasMissingEssentialDetails = essentialValues.some((value) => isReviewFieldMissing(value));
  const sourceUrl = scholarship.officialWebsite || scholarship.url;

  function updatePromptEntries(entries: EssayPromptEntry[]) {
    const normalized = entries.map((entry, index) => ({ ...entry, promptNumber: index + 1 }));
    const remainingIds = new Set(normalized.map((entry) => entry.id));
    updateScholarship({
      essayPromptEntries: normalized,
      essayPrompts: serializeEssayPromptEntries(normalized),
      selectedEssayPromptIds: selectedPromptIds.filter((id) => remainingIds.has(id)),
    });
  }

  function updatePrompt(promptId: string, patch: Partial<EssayPromptEntry>) {
    updatePromptEntries(promptEntries.map((entry) => entry.id === promptId ? { ...entry, ...patch } : entry));
  }

  function togglePrompt(promptId: string) {
    const next = new Set(selectedPromptIds);
    if (next.has(promptId)) next.delete(promptId);
    else next.add(promptId);
    setPendingNoEssayConfirmation(false);
    updateScholarship({
      selectedEssayPromptIds: promptEntries.filter((entry) => next.has(entry.id)).map((entry) => entry.id),
      noEssayPromptSelected: false,
      noEssayPromptConflictConfirmed: false,
    });
  }

  function chooseNoEssayPrompt() {
    if (noEssayPromptSelected) {
      updateScholarship({ noEssayPromptSelected: false, noEssayPromptConflictConfirmed: false });
      return;
    }
    if (essayRequiredByMaterials) {
      setPendingNoEssayConfirmation(true);
      return;
    }
    updateScholarship({ selectedEssayPromptIds: [], noEssayPromptSelected: true, noEssayPromptConflictConfirmed: false });
  }

  function confirmNoEssayPrompt() {
    setPendingNoEssayConfirmation(false);
    updateScholarship({
      selectedEssayPromptIds: [],
      noEssayPromptSelected: true,
      noEssayPromptConflictConfirmed: true,
    });
  }

  if (!hasExtractedDetails) {
    return (
      <WorkflowStep
        number={2}
        title="Review extracted requirements"
        description="Review and correct the scholarship details before analyzing your profile fit."
        complete={complete}
        active={active}
        locked={locked}
        lockedMessage="Extract the scholarship requirements to unlock this step."
        headingId="extracted-requirements-heading"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-info/10 text-info">
            <ClipboardList className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Requirements will appear here</p>
            <p className="mt-1 text-sm leading-5 text-foreground/65">Extract the scholarship requirements to review and edit them.</p>
          </div>
        </div>
      </WorkflowStep>
    );
  }

  return (
    <WorkflowStep
      number={2}
      title="Review extracted requirements"
      description="Review and correct the scholarship details before analyzing your profile fit."
      complete={complete}
      active={active}
      locked={locked}
      lockedMessage="Extract the scholarship requirements to unlock this step."
      headingId="extracted-requirements-heading"
    >
      <section className="mt-2" aria-labelledby="scholarship-snapshot-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-info/15 pb-3">
          <div>
            <h3 id="scholarship-snapshot-heading" className="text-base font-semibold text-foreground">Scholarship Snapshot</h3>
            <p className="mt-1 text-xs text-muted-foreground">Review the extracted details before analyzing your fit.</p>
          </div>
          <button
            type="button"
            onClick={() => setEditingSnapshot((current) => !current)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-info transition-colors hover:text-info/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30"
          >
            <PencilLine className="size-3.5" aria-hidden="true" />
            {editingSnapshot ? "Done editing" : "Edit extracted information"}
          </button>
        </div>

        {hasMissingEssentialDetails && !editingSnapshot && (
          <div className="mt-4 flex flex-col gap-2 border-l-2 border-warning/50 bg-warning/[0.035] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-foreground">Some important details need review.</p>
            <button type="button" onClick={() => setEditingSnapshot(true)} className="w-fit text-xs font-semibold text-primary hover:underline">Review missing details</button>
          </div>
        )}

        <div className="py-5">
          {editingSnapshot ? (
            <div className="space-y-4" aria-label="Edit scholarship snapshot">
              <div className="grid gap-3 sm:grid-cols-2">
                <SnapshotEditField label="Scholarship name" value={scholarship.name ?? ""} onChange={(name) => updateScholarship({ name })} />
                <SnapshotEditField label="Sponsoring organization" value={scholarship.organization ?? ""} onChange={(organization) => updateScholarship({ organization })} />
                <SnapshotEditField label="Award amount" value={scholarship.awardAmount ?? ""} onChange={(awardAmount) => updateScholarship({ awardAmount })} />
                <SnapshotEditField label="Application deadline" value={scholarship.applicationDeadline ?? ""} onChange={(applicationDeadline) => updateScholarship({ applicationDeadline })} />
                <SnapshotEditField label="Education level" value={scholarship.enrollmentLevel ?? ""} onChange={(enrollmentLevel) => updateScholarship({ enrollmentLevel })} />
                <SnapshotEditField label="Official scholarship page" value={sourceUrl ?? ""} onChange={(officialWebsite) => updateScholarship({ officialWebsite, url: officialWebsite })} />
                <SnapshotEditField label="Required document types" value={docsValue} placeholder="Essay, resume, transcript..." onChange={(value) => updateScholarship({ requiredDocumentTypes: value.split(",").map((item) => item.trim()).filter(Boolean) })} />
                <SnapshotEditField label="Other required materials" value={scholarship.otherRequiredMaterials ?? ""} onChange={(otherRequiredMaterials) => updateScholarship({ otherRequiredMaterials })} />
                <SnapshotEditField label="Required materials list" value={requiredMaterialsValue} onChange={(value) => updateScholarship({ requiredApplicationMaterials: parseList(value) })} multiline className="sm:col-span-2" />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {(!isReviewFieldMissing(scholarship.name) || !isReviewFieldMissing(scholarship.organization)) && (
                <div>
                  {!isReviewFieldMissing(scholarship.name) && <h4 className="text-lg font-semibold leading-6 text-foreground">{scholarship.name}</h4>}
                  {!isReviewFieldMissing(scholarship.organization) && <p className="mt-0.5 text-sm text-muted-foreground">{scholarship.organization}</p>}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <SnapshotValue label="Award" value={scholarship.awardAmount} tone="success" />
                <SnapshotValue label="Deadline" value={scholarship.applicationDeadline} tone="warning" />
                <SnapshotValue label="Education" value={scholarship.enrollmentLevel} tone="info" />
              </div>
              {sourceUrl && (
                <a
                  href={sourceUrl.startsWith("http") ? sourceUrl : `https://${sourceUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Official scholarship page (opens in a new tab)"
                  className="group inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-info transition-colors hover:text-info/80 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35 focus-visible:ring-offset-2"
                >
                  Official scholarship page
                  <ExternalLink className="size-3.5 transition-transform duration-150 group-hover:-translate-y-px group-hover:translate-x-px motion-reduce:transform-none motion-reduce:transition-none" aria-hidden="true" />
                </a>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-info/10 py-5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground/75">Required materials</h3>
          {requiredMaterials.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2 text-sm text-foreground">
              {requiredMaterials.map((material) => <li key={material} className="inline-flex items-center rounded-md border border-success/15 bg-success/[0.035] px-2.5 py-1.5">{material}</li>)}
            </ul>
          ) : <p className="mt-2 text-sm text-muted-foreground">No required materials were identified.</p>}
        </div>

        <section aria-labelledby="essay-requirements-heading" className="border-l-2 border-info/55 bg-accent/20 px-3 py-4 sm:px-4">
          <h3 id="essay-requirements-heading" className="text-base font-semibold text-foreground">Essay requirements</h3>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-foreground/70">Review the prompts and word limits, then choose the prompt or prompts you want to use.</p>
          <p className="mt-1 text-xs text-muted-foreground">Use N/A when the scholarship does not specify a limit.</p>

          <div className="mt-3">
            {promptEntries.map((entry, index) => (
              <PromptReviewRow
                key={entry.id}
                entry={entry}
                index={index}
                selected={selectedPromptIdSet.has(entry.id)}
                onToggle={() => togglePrompt(entry.id)}
                onSave={(patch) => updatePrompt(entry.id, patch)}
                onRemove={() => updatePromptEntries(promptEntries.filter((candidate) => candidate.id !== entry.id))}
              />
            ))}
            {promptEntries.length === 0 && <p className="py-4 text-sm text-muted-foreground">No essay prompt was extracted. Add one or explicitly choose No essay prompt.</p>}
          </div>

          <button
            type="button"
            onClick={() => updatePromptEntries([...promptEntries, { id: `prompt-${Date.now()}`, promptNumber: promptEntries.length + 1, promptText: "", minimumWords: null, maximumWords: null, minimumWordsReviewed: false, maximumWordsReviewed: false }])}
            className="mt-2 text-xs font-semibold text-primary hover:underline"
          >
            + Add prompt
          </button>

          <div className="mt-4 border-t border-info/10 pt-4">
            <label className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition-colors ${noEssayPromptSelected ? "border-info/40 bg-accent/50" : "border-info/10 bg-white/65 hover:border-info/25"}`}>
              <input type="checkbox" checked={noEssayPromptSelected} onChange={chooseNoEssayPrompt} className="mt-0.5 size-4 rounded border-border text-info focus:ring-2 focus:ring-info/30" />
              <span>
                <span className="block text-sm font-semibold text-foreground">No essay prompt</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">Choose this only when the scholarship does not require a written response.</span>
              </span>
            </label>
            {(pendingNoEssayConfirmation || (noEssayPromptSelected && essayRequiredByMaterials && !scholarship.noEssayPromptConflictConfirmed)) && (
              <div className="mt-3 border-l-2 border-warning/60 bg-warning/[0.04] px-3 py-2.5">
                <p className="text-sm text-foreground">This scholarship appears to require an essay. Confirm that no prompt applies.</p>
                <div className="mt-2 flex gap-3">
                  <button type="button" onClick={confirmNoEssayPrompt} className="text-xs font-semibold text-primary hover:underline">Confirm no essay prompt</button>
                  <button type="button" onClick={() => setPendingNoEssayConfirmation(false)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </section>
      </section>

      <div className="mt-6 flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={onAnalyze}
          disabled={analyzing || !promptDecisionValid}
          aria-busy={analyzing}
          className={`group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-[background-color,box-shadow,opacity] duration-150 hover:bg-primary/90 hover:shadow-md active:shadow-none disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/40 focus-visible:ring-offset-2 sm:w-auto ${analyzing ? "agent-loading" : ""}`}
        >
          {analyzing && <Spinner className="size-4" />}
          {analyzing ? "Analyzing fit…" : <>Accept and Analyze Fit <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5 group-disabled:translate-x-0 motion-reduce:transform-none motion-reduce:transition-none" aria-hidden="true" /></>}
        </button>
        {!promptDecisionValid && (
          <p role="status" aria-live="polite" className="text-right text-sm font-medium text-warning">
            {!promptDecisionMade
              ? "Select at least one prompt or choose No essay prompt."
              : noEssayPromptSelected
                ? "Confirm that no essay prompt applies to continue."
                : "Review the selected prompt text and enter a number or N/A for both word limits."}
          </p>
        )}
        {analysisStatus && <p className="mt-2 text-right text-xs text-muted-foreground">{analysisStatus}</p>}
      </div>
    </WorkflowStep>
  );
}

/* ---------------- Step 3: Requirements + Fit combined ---------------- */

function StepRequirementsAndFit() {
  const { user, updateProfile } = useUser();
  const scholarship = user?.activeScholarship ?? {};
  const [fitStatus, setFitStatus] = useState<string | null>(null);
  const [fitAnalyzing, setFitAnalyzing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractionStatus, setExtractionStatus] = useState<string | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [workflowAnnouncement, setWorkflowAnnouncement] = useState("");
  const [rubricOpen, setRubricOpen] = useState(false);
  const sourceRevisionRef = useRef(0);
  function updateExtractedScholarship(patch: ActiveScholarship) {
    updateProfile({
      activeScholarship: { ...scholarship, ...patch },
      fitAnalysis: undefined,
      personalizedOutline: undefined,
    });
    setFitStatus(null);
  }
  function moveToWorkflowStep(headingId: string) {
    window.setTimeout(() => {
      const heading = document.getElementById(headingId);
      heading?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
      heading?.focus({ preventScroll: true });
    }, 100);
  }
  function replaceScholarshipSource(patch: ActiveScholarship) {
    sourceRevisionRef.current += 1;
    const nextSource: ActiveScholarship = {
      name: patch.name ?? scholarship.name ?? "",
      url: patch.url ?? scholarship.url ?? "",
      additionalNotes: patch.additionalNotes ?? scholarship.additionalNotes ?? "",
    };
    updateProfile({
      activeScholarship: nextSource,
      fitAnalysis: undefined,
      personalizedOutline: undefined,
    });
    setFitStatus(null);
    setExtractionStatus(null);
    setExtractionError(null);
  }
  async function runScholarshipExtraction() {
    const extractionRevision = sourceRevisionRef.current;
    setExtracting(true);
    setExtractionStatus("Looking up scholarship details and extracting requirements...");
    setExtractionError(null);
    try {
      const extracted = await extractScholarshipOpportunity({
        scholarship_name: scholarship.name ?? "",
        scholarship_url: scholarship.url ?? "",
        additional_notes: scholarship.additionalNotes ?? "",
      });
      if (sourceRevisionRef.current !== extractionRevision) {
        setExtractionStatus("The scholarship source changed while extraction was running. Run extraction again for the current source.");
        return;
      }
      updateProfile({
        activeScholarship: {
          ...scholarship,
          ...extracted,
          additionalNotes: scholarship.additionalNotes,
          url: extracted.url || scholarship.url,
          name: extracted.name || scholarship.name,
          discoverySource: scholarship.discoverySource,
          discoverySourceKind: scholarship.discoverySourceKind,
          extractionCompletedAt: new Date().toISOString(),
        },
        fitAnalysis: undefined,
        personalizedOutline: undefined,
      });
      setExtractionStatus("Requirements extracted. Review and edit the fields below.");
      setWorkflowAnnouncement("Extracted requirements are ready for review.");
      moveToWorkflowStep("extracted-requirements-heading");
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
    updateProfile({ fitAnalysis: undefined });
    try {
      const result = await analyzeScholarshipFit(buildFitPayload(user));
      updateProfile({ fitAnalysis: result });
      setFitStatus("Fit analysis complete. Review the results below.");
      setWorkflowAnnouncement("Profile fit analysis is ready for review.");
      moveToWorkflowStep("profile-fit-analysis-heading");
    } catch (err) {
      setFitStatus(err instanceof Error ? err.message : "Scholarship fit analysis failed.");
    } finally {
      setFitAnalyzing(false);
    }
  }
  const fitAnalysis = user?.fitAnalysis;
  const hasExtractedDetails = !!scholarship.extractionCompletedAt;
  const stepTwoLocked = !hasExtractedDetails || extracting;
  const stepThreeLocked = !fitAnalysis || fitAnalyzing || extracting;

  return (
    <div className="space-y-8">
      <p className="sr-only" aria-live="polite">{workflowAnnouncement}</p>
      <ScholarshipDetailsCard
        scholarship={scholarship}
        updateScholarship={replaceScholarshipSource}
        onExtract={runScholarshipExtraction}
        extracting={extracting}
        extractionStatus={extractionStatus}
        extractionError={extractionError}
        complete={hasExtractedDetails}
        active={!hasExtractedDetails}
      />

      <div id="extracted-requirements-review" className="scroll-mt-6">
        <EditableScholarshipFields
          scholarship={scholarship}
          updateScholarship={updateExtractedScholarship}
          onAnalyze={runFitAnalysis}
          analyzing={fitAnalyzing}
          analysisStatus={fitStatus}
          complete={!!fitAnalysis}
          active={hasExtractedDetails && !fitAnalysis && !fitAnalyzing}
          locked={stepTwoLocked}
        />
      </div>

      <WorkflowStep
        number={3}
        title="Analyze profile fit"
        description={
          fitAnalysis
            ? "This score answers whether your current profile fits this scholarship."
            : "Accept the extracted requirements to compare them with your student profile."
        }
        complete={!!fitAnalysis}
        active={!!fitAnalysis && !fitAnalyzing}
        locked={stepThreeLocked}
        lockedMessage="Accept the extracted requirements and analyze your fit to unlock this step."
        headingId="profile-fit-analysis-heading"
        isLast
      >
        <div className="space-y-6">
          {!fitAnalysis && (
            <section className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Lock className="size-4" aria-hidden="true" />
              </span>
              <div>
                <div className="text-sm font-semibold text-foreground">Fit analysis will appear here</div>
                <p className="mt-1 text-sm leading-5 text-foreground/65">
                  Accept the extracted requirements to compare them with your student profile.
                </p>
              </div>
            </section>
          )}

          {!!fitAnalysis && (
            <div className="grid md:grid-cols-3 gap-6">
              <Card className="md:col-span-1 flex flex-col items-center justify-center px-4 py-5 text-center">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Fit score
                </div>
                <div className="relative mt-3 size-36">
                  <svg viewBox="0 0 100 100" className="size-36 -rotate-90">
                    <circle cx="50" cy="50" r="42" stroke="var(--border)" strokeWidth="7" fill="none" />
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      stroke={fitScoreStroke(fitAnalysis.fit_score ?? 0, fitAnalysis.fit_label)}
                      strokeWidth="7"
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray={`${((fitAnalysis.fit_score ?? 0) / 100) * 2 * Math.PI * 42} 999`}
                    />
                  </svg>
                  <div className="absolute inset-0 grid place-items-center">
                    <div>
                      <div className="font-display text-4xl tracking-tight">{fitAnalysis.fit_score ?? 0}</div>
                      <div className="text-[11px] text-muted-foreground">out of 100</div>
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <Pill tone={fitLabelTone(fitAnalysis.fit_label, fitAnalysis.likely_eligible)}>
                    {fitAnalysis.fit_label || "Insufficient Information"}
                  </Pill>
                </div>
                <div className="mt-1.5 text-[12px] text-muted-foreground">
                  Likely eligible: {fitAnalysis.likely_eligible || "Unclear"}
                </div>
                <p className="mt-3 max-w-[14rem] text-[12px] leading-snug text-muted-foreground">
                  Based on your profile versus this scholarship’s requirements.
                </p>
                <button
                  type="button"
                  onClick={() => setRubricOpen(true)}
                  className="mt-2.5 rounded-lg border border-border bg-background px-3 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
                >
                  What does this score mean?
                </button>
                <FitRubricDialog open={rubricOpen} onOpenChange={setRubricOpen} />
              </Card>

              <Card className="md:col-span-2">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Fit summary</div>
                <p className="mt-3 text-sm leading-relaxed">{fitAnalysis.summary}</p>

                {!!fitAnalysis.eligibility_analysis?.length && (
                  <div className="mt-5">
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">
                      Hard requirements
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      If any of these clearly fail, the score stays below 40 as Not Eligible.
                    </p>
                    <div className="mt-3 space-y-3">
                      {fitAnalysis.eligibility_analysis.map((item, index) => (
                        <div key={`${item.requirement}-${index}`} className="rounded-lg border border-border p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium">{item.requirement}</div>
                            <Pill tone={eligibilityStatusTone(item.status)}>
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

              {!!fitAnalysis.selection_criteria_alignment?.length && (
                <Card className="md:col-span-3">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    Scholarship priorities
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    How well your profile matches what the scholarship says it values. These cannot
                    override a failed hard requirement.
                  </p>
                  <div className="mt-3 grid md:grid-cols-2 gap-3">
                    {fitAnalysis.selection_criteria_alignment.map((item, index) => (
                      <div key={`${item.criterion}-${index}`} className="rounded-lg border border-border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium">{item.criterion}</div>
                          <Pill tone={criteriaAlignmentTone(item.alignment)}>
                            {item.alignment || "Unclear"}
                          </Pill>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">{item.student_evidence}</div>
                        {item.notes && <div className="mt-1 text-xs">{item.notes}</div>}
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      </WorkflowStep>
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
      range: "90–100",
      label: "Strong Fit",
      description: "You appear to meet the hard requirements and match the scholarship’s priorities well.",
      tone: "success" as const,
    },
    {
      range: "75–89",
      label: "Good Fit",
      description: "Mostly eligible and well aligned; a few details may need confirmation.",
      tone: "gold" as const,
    },
    {
      range: "55–74",
      label: "Possible Fit",
      description: "Some match, but missing info or mixed alignment lowers confidence.",
      tone: "info" as const,
    },
    {
      range: "40–54",
      label: "Weak Fit",
      description: "You may still be eligible, but there are important gaps or weak alignment.",
      tone: "warn" as const,
    },
  ];

  const scoringSteps = [
    "Check each hard requirement against your profile",
    "Check stated priorities like leadership, goals, or academic fit",
    "A clear hard fail always stays below 40",
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(88vh,640px)] w-[calc(100%-1.5rem)] max-w-2xl gap-0 overflow-hidden rounded-2xl border-border/80 p-0 shadow-xl">
        <div className="border-b border-border/70 bg-secondary/25 px-4 py-3 pr-10 sm:px-5">
          <DialogHeader className="space-y-0.5 text-left">
            <DialogTitle className="font-display text-lg tracking-tight">
              What this score means
            </DialogTitle>
            <DialogDescription className="max-w-xl text-[12px] leading-snug">
              Does your current profile fit this scholarship? Document readiness is not included.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-3 overflow-y-auto px-4 py-3 sm:px-5">
          <section>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Score meaning
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {scoreBands.map((band) => (
                <div
                  key={band.label}
                  className="flex flex-col rounded-lg border border-border/70 bg-card px-2.5 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[13px] font-medium tracking-tight">{band.label}</div>
                    <Pill tone={band.tone}>{band.range}</Pill>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    {band.description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Below 40
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              <div className="rounded-lg border border-destructive/20 bg-destructive/[0.04] px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[13px] font-medium tracking-tight">Not Eligible</div>
                  <Pill tone="danger">0–39</Pill>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  A hard requirement clearly fails — for example degree level, citizenship, or GPA.
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-secondary/30 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[13px] font-medium tracking-tight">Insufficient Information</div>
                  <Pill tone="gold">0–39</Pill>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  Your profile is incomplete, so we can’t score higher yet. Missing info is not a fail.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2">
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              How we score
            </div>
            <ol className="grid gap-1.5 sm:grid-cols-3">
              {scoringSteps.map((step, index) => (
                <li key={step} className="flex gap-1.5 sm:block">
                  <div className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary sm:mb-1">
                    {index + 1}
                  </div>
                  <p className="text-[11px] leading-snug text-foreground/80">{step}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function fitScoreStroke(score: number, label?: string) {
  const normalized = (label || "").toLowerCase();
  if (normalized.includes("not eligible") || score < 40) return "var(--destructive)";
  if (score >= 90) return "var(--success, #16a34a)";
  if (score >= 75) return "var(--gold)";
  if (score >= 55) return "var(--warning, #d97706)";
  return "var(--warning, #d97706)";
}

function fitLabelTone(
  label?: string,
  likelyEligible?: string,
): "default" | "gold" | "success" | "warn" | "info" | "danger" {
  const value = (label || "").toLowerCase();
  if (value.includes("not eligible") || likelyEligible === "No") return "danger";
  if (value.includes("insufficient")) return "gold";
  if (value.includes("strong") || value.includes("good")) return "success";
  if (value.includes("weak")) return "warn";
  return "gold";
}

function eligibilityStatusTone(status?: string): "default" | "gold" | "success" | "warn" | "info" | "danger" {
  const value = (status || "").toLowerCase();
  if (value === "met") return "success";
  if (value === "not met") return "danger";
  return "gold";
}

function criteriaAlignmentTone(alignment?: string): "default" | "gold" | "success" | "warn" | "info" | "danger" {
  const value = (alignment || "").toLowerCase();
  if (value === "strong") return "success";
  if (value === "moderate") return "info";
  if (value === "weak") return "warn";
  return "gold";
}

/* ---------------- Step 5: Essay Workspace ---------------- */

type WorkspaceTab = "outline" | "coach" | "highlights";

const ESSAY_REVIEW_DIMENSIONS = [
  "alignment",
  "evidence_strength",
  "insight",
  "narrative_structure_flow_coherence",
  "tone_authenticity",
  "clarity_concision",
  "grammar",
] as const;

type EssayReviewDimension = (typeof ESSAY_REVIEW_DIMENSIONS)[number];

const ESSAY_REVIEW_SCORE_GROUPS: ReadonlyArray<{
  label: string;
  criteria: readonly EssayReviewDimension[];
  columnClass: string;
}> = [
  {
    label: "Content",
    criteria: ["alignment", "evidence_strength", "insight"],
    columnClass: "md:col-span-3",
  },
  {
    label: "Structure",
    criteria: ["narrative_structure_flow_coherence"],
    columnClass: "md:col-span-1",
  },
  {
    label: "Voice",
    criteria: ["tone_authenticity", "clarity_concision"],
    columnClass: "md:col-span-2",
  },
];

function normalizePdfDraftText(pages: string[]) {
  return pages
    .map((page) => page.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Pull the largest 2–5 digit number out of a word-limit string (e.g. "400-500 words" → 500). */
function parseWordTarget(limit?: string): number | null {
  const nums = (limit ?? "").match(/\d{2,5}/g);
  if (!nums?.length) return null;
  return Math.max(...nums.map(Number));
}

function scoreColor(score: number): string {
  if (score >= 80) return "var(--success)";
  if (score >= 60) return "var(--warning)";
  return "var(--destructive)";
}

function labelize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function relativeTimeLabel(timestamp: number | null, now: number): string {
  if (!timestamp) return "Not run yet";
  const mins = Math.floor((now - timestamp) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
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

function OutlineWorkspaceLoadingOverlay({ loading }: { loading: boolean }) {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const [region, setRegion] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const wasLoading = useRef(false);

  useEffect(() => {
    let progressTimer: number | undefined;
    let completionTimer: number | undefined;

    if (loading) {
      wasLoading.current = true;
      setVisible(true);
      setProgress(10);
      const startedAt = Date.now();
      progressTimer = window.setInterval(() => {
        const elapsedSeconds = (Date.now() - startedAt) / 1000;
        let nextProgress: number;
        if (elapsedSeconds < 2) nextProgress = 10 + (elapsedSeconds / 2) * 20;
        else if (elapsedSeconds < 5) nextProgress = 30 + ((elapsedSeconds - 2) / 3) * 25;
        else if (elapsedSeconds < 10) nextProgress = 55 + ((elapsedSeconds - 5) / 5) * 30;
        else nextProgress = Math.min(95, 85 + (elapsedSeconds - 10));
        setProgress(Math.round(nextProgress));
      }, 250);
    } else if (wasLoading.current) {
      setProgress(100);
      completionTimer = window.setTimeout(() => {
        wasLoading.current = false;
        setVisible(false);
        setRegion(null);
      }, 300);
    } else {
      setProgress(0);
      setVisible(false);
      setRegion(null);
    }

    return () => {
      if (progressTimer !== undefined) window.clearInterval(progressTimer);
      if (completionTimer !== undefined) window.clearTimeout(completionTimer);
    };
  }, [loading]);

  useEffect(() => {
    if (!visible) return;
    let frame = 0;
    const startedAt = window.performance.now();
    const measure = () => {
      const target = document.querySelector<HTMLElement>("[data-outline-loading-region]");
      if (target) {
        const rect = target.getBoundingClientRect();
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        setRegion({
          left,
          top,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        });
      }
      if (window.performance.now() - startedAt < 600) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [visible]);

  if (!visible) return null;

  const activeStep = progress < 30 ? 0 : progress < 55 ? 1 : progress < 85 ? 2 : 3;
  const cardWidth = region ? Math.max(280, Math.min(576, region.width - 32)) : 576;
  const cardLeft = region
    ? region.left + Math.max(16, (region.width - cardWidth) / 2)
    : Math.max(16, (window.innerWidth - cardWidth) / 2);
  const requestedTop = (region?.top ?? 0) + 120;
  const cardTop = region
    ? Math.max(region.top + 16, Math.min(requestedTop, region.top + region.height - 300))
    : 120;

  return (
    <div
      className="fixed inset-0 z-[60] cursor-wait bg-black/20 backdrop-grayscale"
      role="status"
      aria-live="polite"
      aria-label={`Building your personalized outline, ${progress}% complete`}
    >
      {region && (
        <div
          className="fixed bg-[#cccccc]"
          style={{ left: region.left, top: region.top, width: region.width, height: region.height }}
          aria-hidden="true"
        />
      )}
      <div
        className="fixed z-10 rounded-xl border border-info/25 bg-background p-5 shadow-lg"
        style={{ left: cardLeft, top: cardTop, width: cardWidth }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-info/25 border-t-info" />
            <span className="truncate text-[15px] font-semibold text-foreground">Building your personalized outline…</span>
          </div>
          <span className="shrink-0 text-[14px] font-semibold tabular-nums text-info">{progress}%</span>
        </div>

        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-info/10"
          role="progressbar"
          aria-label="Personalized outline generation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div
            className="h-full rounded-full bg-info transition-[width] duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-5 space-y-2.5">
          {[
            "Reading scholarship and essay requirements",
            "Matching profile evidence",
            "Planning essay sections",
            "Verifying complete coverage of requirements",
          ].map((item, index) => {
            const completed = progress === 100 || index < activeStep;
            const active = progress < 100 && index === activeStep;
            return (
              <div key={item} className={`flex items-center gap-2.5 text-[13px] ${completed || active ? "text-foreground" : "text-muted-foreground"}`}>
                {completed ? (
                  <span className="grid size-4 shrink-0 place-items-center rounded-full bg-success text-white">
                    <Check className="size-3" aria-hidden="true" />
                  </span>
                ) : active ? (
                  <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-info/25 border-t-info" />
                ) : (
                  <span className="size-4 shrink-0 rounded-full border border-border bg-background" />
                )}
                <span className={active ? "font-semibold" : ""}>{item}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EssayReviewWorkspaceLoadingOverlay({
  loading,
  progress,
}: {
  loading: boolean;
  progress: number;
}) {
  const [region, setRegion] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (!loading) {
      setRegion(null);
      return;
    }
    let frame = 0;
    const startedAt = window.performance.now();
    const measure = () => {
      const target = document.querySelector<HTMLElement>("[data-essay-review-loading-region]");
      if (target) {
        const rect = target.getBoundingClientRect();
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        setRegion({
          left,
          top,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        });
      }
      if (window.performance.now() - startedAt < 600) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [loading]);

  if (!loading) return null;

  const displayedProgress = Math.max(1, Math.min(100, Math.round(progress)));
  const evaluationSteps = [
    {
      title: "Alignment",
      description: "Evaluating how directly your essay answers the prompt and connects with the scholarship’s values and priorities.",
    },
    {
      title: "Evidence Strength",
      description: "Evaluating whether your essay uses the strongest relevant experiences from your profile and supports them with explicit details, examples, achievements, and measurable outcomes.",
    },
    {
      title: "Insight",
      description: "Evaluating the depth of your writing, including the meaning of your experiences and what you learned, realized, questioned, or changed.",
    },
    {
      title: "Narrative Structure, Flow & Coherence",
      description: "Evaluating your essay’s organization, progression, transitions, timeline, and logical consistency.",
    },
    {
      title: "Tone & Authenticity",
      description: "Evaluating whether your voice sounds sincere, confident, respectful, and authentic.",
    },
    {
      title: "Clarity & Concision",
      description: "Evaluating whether your sentences are direct, easy to understand, and free from unnecessary wording or convoluted phrasing.",
    },
    {
      title: "Grammar",
      description: "Evaluating spelling, punctuation, capitalization, verb tense, agreement, and sentence-level correctness.",
    },
    {
      title: "Preparing specific revision guidance",
      description: "Preparing one clear, specific revision action for each criterion based on its score and feedback.",
    },
    {
      title: "Your essay review is ready",
      description: "",
    },
  ];
  const activeStep = displayedProgress < 15
    ? 0
    : displayedProgress < 25
      ? 1
      : displayedProgress < 35
        ? 2
        : displayedProgress < 50
          ? 3
          : displayedProgress < 60
            ? 4
            : displayedProgress < 70
              ? 5
              : displayedProgress < 85
                ? 6
                : displayedProgress < 100
                  ? 7
                  : 8;
  const cardWidth = region ? Math.max(280, Math.min(576, region.width - 32)) : 576;
  const cardLeft = region
    ? region.left + Math.max(16, (region.width - cardWidth) / 2)
    : Math.max(16, (window.innerWidth - cardWidth) / 2);
  const requestedTop = (region?.top ?? 0) + 120;
  const cardTop = region
    ? Math.max(region.top + 16, Math.min(requestedTop, window.innerHeight - 536))
    : 120;

  return (
    <div
      className="fixed inset-0 z-[60] cursor-wait bg-black/20 backdrop-grayscale"
      role="status"
      aria-live="polite"
      aria-label={`Reviewing your essay, ${displayedProgress}% complete`}
    >
      {region && (
        <div
          className="fixed bg-[#cccccc]"
          style={{ left: region.left, top: region.top, width: region.width, height: region.height }}
          aria-hidden="true"
        />
      )}
      <div
        className="fixed z-10 max-h-[calc(100vh-32px)] overflow-y-auto rounded-xl border border-info/25 bg-background p-5 shadow-lg"
        style={{
          left: cardLeft,
          top: cardTop,
          width: cardWidth,
          maxHeight: Math.max(240, window.innerHeight - cardTop - 16),
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-info/25 border-t-info" />
            <span className="truncate text-[15px] font-semibold text-foreground">Reviewing your essay…</span>
          </div>
          <span className="shrink-0 text-[14px] font-semibold tabular-nums text-info">{displayedProgress}%</span>
        </div>

        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-info/10"
          role="progressbar"
          aria-label="Essay evaluation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={displayedProgress}
        >
          <div
            className="h-full rounded-full bg-info transition-[width] duration-500 ease-out"
            style={{ width: `${displayedProgress}%` }}
          />
        </div>

        <div className="mt-5 space-y-2.5">
          {evaluationSteps.map((step, index) => {
            const completed = index < activeStep || (displayedProgress === 100 && index === activeStep);
            const active = index === activeStep;
            return (
              <div key={step.title} className={`flex items-start gap-2.5 text-[13px] ${completed || active ? "text-foreground" : "text-muted-foreground"}`}>
                {completed ? (
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-success text-white">
                    <Check className="size-3" aria-hidden="true" />
                  </span>
                ) : active ? (
                  <span className="mt-0.5 size-4 shrink-0 animate-spin rounded-full border-2 border-info/25 border-t-info" />
                ) : (
                  <span className="mt-0.5 size-4 shrink-0 rounded-full border border-border bg-background" />
                )}
                <div className="min-w-0">
                  <div className={active ? "font-semibold" : ""}>{step.title}</div>
                  {active && step.description && (
                    <p className="mt-1 leading-relaxed text-muted-foreground">{step.description}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StepEssayWorkspace({ onBack }: { onBack?: () => void }) {
  const { user, updateProfile } = useUser();
  const editorApiRef = useRef<EssayEditorHandle | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [coachRaw, setCoachRaw] = useState<CoachSentenceSuggestion[]>([]);
  const [coachLoading, setCoachLoading] = useState(false);
  const [reviewResult, setReviewResult] = useState<EssayReviewResult | null>(
    () => user?.essayReviewResult?.schema_version === 3 ? user.essayReviewResult : null,
  );
  const [reviewUpdatedAt, setReviewUpdatedAt] = useState<number | null>(() => user?.essayReviewUpdatedAt ?? null);
  const [reviewDraftAtRun, setReviewDraftAtRun] = useState<string>(() => user?.essayReviewDraftAtRun ?? "");
  // Outline coverage is layered: `autoCovered` comes from the AI coverage agent;
  // `manualChecked`/`manualUnchecked` are the student's overrides, which persist
  // across auto-runs. Displayed = (auto ∪ manualChecked) − manualUnchecked.
  const [autoCovered, setAutoCovered] = useState<Set<string>>(() => new Set());
  const [manualChecked, setManualChecked] = useState<Set<string>>(() => new Set());
  const [manualUnchecked, setManualUnchecked] = useState<Set<string>>(() => new Set());
  const essayTitle = user?.essayTitle ?? "";
  const activeScholarshipName = user?.activeScholarship?.name?.trim() ?? "";
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("outline");
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 420;
    const saved = Number(window.localStorage.getItem("scholar-e:essay-panel-width"));
    const minimum = Math.max(300, Math.round(window.innerWidth * 0.4));
    return Number.isFinite(saved) && saved >= 300
      ? saved
      : Math.min(Math.max(420, minimum), Math.round(window.innerWidth * 0.55));
  });

  useEffect(() => {
    if (!user || essayTitle.trim() || !activeScholarshipName) return;
    updateProfile({ essayTitle: activeScholarshipName });
  }, [activeScholarshipName, essayTitle, updateProfile, user]);
  const [panelResizing, setPanelResizing] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [sessionProgress, setSessionProgress] = useState(0);
  const [reviewReady, setReviewReady] = useState(false);
  const [mechanicsNote, setMechanicsNote] = useState<string | null>(null);
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);
  const [bgStatus, setBgStatus] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineStatus, setOutlineStatus] = useState<string | null>(null);
  const [promptConfirmed, setPromptConfirmed] = useState(false);
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [pendingPromptIndex, setPendingPromptIndex] = useState(0);
  const [workspaceTutorialActive, setWorkspaceTutorialActive] = useState(false);
  const workspaceTutorialHandled = useRef(false);

  const legacyPromptBlob =
    user?.activeScholarship?.essayPrompts
    || user?.activeScholarship?.otherRequiredMaterials
    || user?.activeScholarship?.requirementsPreview
    || "";
  const hasPromptDecisionState = Array.isArray(user?.activeScholarship?.selectedEssayPromptIds)
    || typeof user?.activeScholarship?.noEssayPromptSelected === "boolean";
  const availablePromptEntries = useMemo(() => {
    const selected = normalizeSelectedEssayPromptEntries(user?.activeScholarship);
    if (selected.length > 0 || hasPromptDecisionState) return selected;
    return normalizeEssayPromptEntries({ essayPrompts: legacyPromptBlob });
  }, [hasPromptDecisionState, legacyPromptBlob, user?.activeScholarship]);
  const availablePrompts = useMemo(() => availablePromptEntries.map((entry) => entry.promptText), [availablePromptEntries]);
  const promptDataKey = useMemo(() => JSON.stringify(availablePromptEntries), [availablePromptEntries]);
  const [selectedPromptIndex, setSelectedPromptIndex] = useState(0);
  const activePromptEntry = availablePromptEntries[Math.min(selectedPromptIndex, Math.max(0, availablePromptEntries.length - 1))];
  const activePromptId = activePromptEntry?.id ?? "no-essay-prompt";
  const essayPrompt =
    activePromptEntry?.promptText || (hasPromptDecisionState ? "" : legacyPromptBlob);
  const draft = user?.essayDraftsByPromptId?.[activePromptId]
    ?? (selectedPromptIndex === 0 && activePromptId !== "no-essay-prompt" ? user?.essayDraft ?? "" : "");
  const draftHtml = user?.essayDraftHtmlByPromptId?.[activePromptId]
    ?? (selectedPromptIndex === 0 && activePromptId !== "no-essay-prompt" ? user?.essayDraftHtml ?? "" : "");
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).filter(Boolean).length : 0;
  const characterCount = draft.length;
  const hasMultiplePrompts = availablePrompts.length > 1;

  useEffect(() => {
    if (selectedPromptIndex >= availablePrompts.length) {
      setSelectedPromptIndex(0);
    }
  }, [availablePrompts.length, selectedPromptIndex]);

  const wordTarget = useMemo(
    () => parseWordTarget(buildOutlinePayload(user, essayPrompt).word_limit),
    [user, essayPrompt],
  );
  const score = typeof reviewResult?.overall_score === "number" ? reviewResult.overall_score : null;
  const suggestions = useMemo(() => {
    const auto = analyzeText(draft);
    const coach = anchorCoachSuggestions(coachRaw, draft);
    return mergeSuggestions(coach, auto).filter((s) => !dismissed.has(s.id));
  }, [draft, coachRaw, dismissed]);

  function updateEssayPrompt(value: string, index = hasMultiplePrompts ? pendingPromptIndex : selectedPromptIndex) {
    if (!user) return;
    const allEntries = normalizeEssayPromptEntries(user.activeScholarship);
    const selectedEntry = availablePromptEntries[Math.min(index, Math.max(0, availablePromptEntries.length - 1))];
    const nextEntries = selectedEntry
      ? allEntries.map((entry) => entry.id === selectedEntry.id ? { ...entry, promptText: value } : entry)
      : [...allEntries, { id: `prompt-${Date.now()}`, promptNumber: allEntries.length + 1, promptText: value, minimumWords: null, maximumWords: null, minimumWordsReviewed: false, maximumWordsReviewed: false }];
    updateProfile({
      activeScholarship: {
        ...(user.activeScholarship ?? {}),
        essayPromptEntries: nextEntries,
        essayPrompts: serializeEssayPromptEntries(nextEntries),
      },
      personalizedOutline: undefined,
    });
    setPromptConfirmed(false);
    setPromptPickerOpen(true);
    setOutlineStatus(null);
  }

  function selectEssayPrompt(index: number) {
    if (index === selectedPromptIndex && promptConfirmed) return;
    setSelectedPromptIndex(index);
    setPendingPromptIndex(index);
    setPromptConfirmed(false);
    const nextPromptId = availablePromptEntries[index]?.id ?? "no-essay-prompt";
    const nextDraft = user?.essayDraftsByPromptId?.[nextPromptId] ?? "";
    const nextDraftHtml = user?.essayDraftHtmlByPromptId?.[nextPromptId] ?? "";
    updateProfile({ essayDraft: nextDraft, essayDraftHtml: nextDraftHtml, personalizedOutline: undefined });
    setOutlineStatus("Prompt changed — confirm the new prompt to build its outline.");
    setActiveTab("outline");
    setPanelOpen(true);
    setPromptPickerOpen(true);
  }

  function updateActiveDraft(value: string) {
    updateProfile({
      essayDraft: value,
      essayDraftsByPromptId: { ...(user?.essayDraftsByPromptId ?? {}), [activePromptId]: value },
    });
  }

  function updateActiveDraftHtml(value: string) {
    updateProfile({
      essayDraftHtml: value,
      essayDraftHtmlByPromptId: { ...(user?.essayDraftHtmlByPromptId ?? {}), [activePromptId]: value },
    });
  }

  const outlineKey = useMemo(() => {
    const scholarship = user?.activeScholarship ?? {};
    return JSON.stringify({
      scholarshipName: scholarship.name ?? "",
      scholarshipUrl: scholarship.url ?? scholarship.officialWebsite ?? "",
      prompt: essayPrompt,
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
  }, [essayPrompt, user]);

  // Landing: after profile hydration, open the prompt popup unless this visit
  // already confirmed a writing focus. Re-open when the prompt blob changes.
  useEffect(() => {
    if (!user) return;
    if (promptConfirmed) return;
    if (user.activeScholarship?.noEssayPromptSelected) {
      setPromptConfirmed(true);
      setPromptPickerOpen(false);
      return;
    }
    // Resume silently only when the stored outline was generated for this exact focus.
    if (user.personalizedOutline?.generatedForKey === outlineKey) {
      setPromptConfirmed(true);
      setPromptPickerOpen(false);
      return;
    }
    setPendingPromptIndex(Math.min(selectedPromptIndex, Math.max(0, availablePrompts.length - 1)));
    setPromptPickerOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, promptDataKey, outlineKey]);

  useEffect(() => {
    if (
      workspaceTutorialHandled.current
      || outlineLoading
      || promptPickerOpen
      || !promptConfirmed
      || !user?.personalizedOutline?.outline
    ) return;
    try {
      if (window.localStorage.getItem(ESSAY_WORKSPACE_TUTORIAL_KEY) === "complete") {
        workspaceTutorialHandled.current = true;
        return;
      }
    } catch {
      // The tour can still run once in this visit when storage is unavailable.
    }
    const timer = window.setTimeout(() => {
      workspaceTutorialHandled.current = true;
      setWorkspaceTutorialActive(true);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [outlineLoading, promptConfirmed, promptPickerOpen, user?.personalizedOutline?.generatedForKey, user?.personalizedOutline?.outline]);

  function closeWorkspaceTutorial() {
    workspaceTutorialHandled.current = true;
    try {
      window.localStorage.setItem(ESSAY_WORKSPACE_TUTORIAL_KEY, "complete");
    } catch {
      // Dismissing the tour should still work when storage is unavailable.
    }
    setWorkspaceTutorialActive(false);
  }

  async function runOutlineGeneration(promptOverride?: string) {
    if (!user || outlineLoading) return;
    const promptForOutline = (promptOverride ?? essayPrompt).trim();
    setOutlineLoading(true);
    setOutlineStatus("Building an outline adapted to your selected essay prompt…");
    setPanelOpen(true);
    setActiveTab("outline");
    const scholarship = user.activeScholarship ?? {};
    const keyForOutline = JSON.stringify({
      scholarshipName: scholarship.name ?? "",
      scholarshipUrl: scholarship.url ?? scholarship.officialWebsite ?? "",
      prompt: promptForOutline,
      requirementsPreview: scholarship.requirementsPreview ?? "",
      updatedAt: scholarship.extractionCompletedAt ?? "",
      profileName: user.name ?? "",
      educationLevel: user.educationLevel ?? "",
      careerGoal: user.careerGoal ?? "",
      highSchool: user.highSchool ?? {},
      undergrad: user.undergrad ?? {},
      graduate: user.graduate ?? {},
      researchExperience: user.researchExperience ?? [],
      workExperience: user.workExperience ?? [],
      optional: user.optional ?? {},
      prompts: user.prompts ?? {},
    });
    try {
      const result = await generatePersonalizedOutline(buildOutlinePayload(user, promptForOutline));
      updateProfile({ personalizedOutline: { ...result, generatedForKey: keyForOutline } });
      setOutlineStatus(result.status === "error" ? "A fallback outline is ready." : "Personalized outline ready. Start drafting against it.");
      setActiveTab("outline");
    } catch (error) {
      setOutlineStatus(error instanceof Error ? error.message : "Could not generate the outline.");
    } finally {
      setOutlineLoading(false);
    }
  }

  async function confirmEssayPrompt(index?: number) {
    const nextIndex = typeof index === "number" ? index : pendingPromptIndex;
    const nextPrompt = (availablePrompts[nextIndex] || legacyPromptBlob).trim();
    if (!nextPrompt) {
      setOutlineStatus("Add an essay prompt, or continue without a formal prompt.");
      return;
    }
    setSelectedPromptIndex(nextIndex);
    setPendingPromptIndex(nextIndex);
    const nextPromptId = availablePromptEntries[nextIndex]?.id ?? "no-essay-prompt";
    updateProfile({
      essayDraft: user?.essayDraftsByPromptId?.[nextPromptId] ?? "",
      essayDraftHtml: user?.essayDraftHtmlByPromptId?.[nextPromptId] ?? "",
    });
    setPromptConfirmed(true);
    setPromptPickerOpen(false);
    setPanelOpen(true);
    setActiveTab("outline");
    setOutlineStatus("Prompt confirmed — generating an outline adapted to this prompt…");
    await runOutlineGeneration(nextPrompt);
  }

  function continueWithoutFormalPrompt() {
    // Clear any stale pasted materials masquerading as a prompt so evaluation
    // uses scholarship-guided adaptation without generating an outline.
    if (!user) return;
    updateProfile({
      activeScholarship: {
        ...(user.activeScholarship ?? {}),
        selectedEssayPromptIds: [],
        noEssayPromptSelected: true,
      },
      essayDraft: user.essayDraftsByPromptId?.["no-essay-prompt"] ?? "",
      essayDraftHtml: user.essayDraftHtmlByPromptId?.["no-essay-prompt"] ?? "",
      personalizedOutline: undefined,
    });
    setSelectedPromptIndex(0);
    setPendingPromptIndex(0);
    setPromptConfirmed(true);
    setPromptPickerOpen(false);
    setPanelOpen(true);
    setActiveTab("outline");
    setOutlineStatus("No formal prompt selected. Evaluation will use the scholarship mission and selection criteria.");
  }

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

  // Restore only schema-v3 Essay Review data. Older coach/evaluation payloads
  // are intentionally ignored and render as an empty Evaluate state.
  useEffect(() => {
    const restored = user?.essayReviewResult;
    setReviewResult(restored?.schema_version === 3 ? restored : null);
    setReviewUpdatedAt(restored?.schema_version === 3 ? user?.essayReviewUpdatedAt ?? null : null);
    setReviewDraftAtRun(restored?.schema_version === 3 ? user?.essayReviewDraftAtRun ?? "" : "");
  }, [user?.email, user?.essayReviewResult, user?.essayReviewUpdatedAt, user?.essayReviewDraftAtRun]);

  useEffect(() => {
    if (!panelResizing) return;
    const resize = (event: PointerEvent) => {
      const minimum = Math.max(300, Math.round(window.innerWidth * 0.4));
      const maximum = Math.round(window.innerWidth * 0.7);
      setPanelWidth(Math.max(minimum, Math.min(maximum, window.innerWidth - event.clientX)));
    };
    const stop = () => setPanelResizing(false);
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop, { once: true });
    return () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
    };
  }, [panelResizing]);

  useEffect(() => {
    if (panelResizing) return;
    window.localStorage.setItem("scholar-e:essay-panel-width", String(Math.round(panelWidth)));
  }, [panelWidth, panelResizing]);

  useEffect(() => {
    const clamp = () => {
      const minimum = Math.max(300, Math.round(window.innerWidth * 0.4));
      const maximum = Math.round(window.innerWidth * 0.7);
      setPanelWidth((width) => Math.max(minimum, Math.min(maximum, width)));
    };
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);

  const savedLabel = (() => {
    if (!savedAt) return "Not saved yet";
    const mins = Math.floor((nowTick - savedAt) / 60000);
    if (mins < 1) return "Saved · just now";
    if (mins === 1) return "Saved · 1m ago";
    if (mins < 60) return `Saved · ${mins}m ago`;
    return `Saved · ${Math.floor(mins / 60)}h ago`;
  })();

  function acceptSuggestion(s: Suggestion) {
    editorApiRef.current?.accept(s);
  }

  // "Quick fixes" = the low-risk mechanical corrections (grammar, spelling,
  // spacing, capitalization). Stylistic/specificity rewrites are left for
  // individual review to preserve the student's voice.
  const quickFixSuggestions = suggestions.filter((s) => s.category === "correctness");

  function acceptAllQuickFixes() {
    if (!quickFixSuggestions.length) return;
    // Apply right-to-left so earlier offsets stay valid (suggestions never overlap).
    let text = draft;
    for (const s of [...quickFixSuggestions].sort((a, b) => b.start - a.start)) {
      text = applySuggestion(text, s);
    }
    updateActiveDraft(text);
  }

  const coveredPoints = useMemo(() => {
    const set = new Set(autoCovered);
    manualChecked.forEach((id) => set.add(id));
    manualUnchecked.forEach((id) => set.delete(id));
    return set;
  }, [autoCovered, manualChecked, manualUnchecked]);

  function toggleCovered(id: string) {
    if (coveredPoints.has(id)) {
      setManualChecked((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setManualUnchecked((prev) => new Set(prev).add(id));
    } else {
      setManualUnchecked((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setManualChecked((prev) => new Set(prev).add(id));
    }
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

  function persistEssayReview(result: EssayReviewResult, draftForRun: string) {
    const updatedAt = Date.now();
    setReviewResult(result);
    setReviewUpdatedAt(updatedAt);
    setReviewDraftAtRun(draftForRun);
    updateProfile({
      essayReviewResult: result,
      essayReviewUpdatedAt: updatedAt,
      essayReviewDraftAtRun: draftForRun,
    });
  }

  async function runAutoCheck() {
    if (coachLoading) return;
    if (draft === lastAutoCheckRef.current || wordCount < 20) return;
    setCoachLoading(true);
    lastAutoCheckRef.current = draft;
    setBgStatus("Checking grammar and outline coverage…");
    try {
      const result = await runEditorCheck(buildEditorCheckPayload(user));
      const coveredIds = result.outline_coverage?.covered_point_ids;
      if (coveredIds) {
        // Intersect with known point ids so a hallucinated id can never tick a box.
        const known = new Set(buildOutlinePoints(user?.personalizedOutline).map((p) => p.id));
        setAutoCovered(new Set(coveredIds.filter((id) => known.has(id))));
      }
      setCoachRaw(result.sentence_suggestions ?? []);
    } catch {
      // Background checks fail silently; the main session remains authoritative.
    } finally {
      setCoachLoading(false);
      setBgStatus(null);
    }
  }

  async function runCoachingSession() {
    if (coachLoading || isEvaluating || !user) return;
    if (!promptConfirmed) {
      setAnalysisStatus("Confirm your writing focus first, then select Evaluate.");
      setPromptPickerOpen(true);
      setActiveTab("outline");
      setPanelOpen(true);
      return;
    }
    if (wordCount < 30) {
      setAnalysisStatus("Write at least 30 words, then select Evaluate.");
      return;
    }

    setIsEvaluating(true);
    setCoachLoading(true);
    setReviewReady(false);
    setSessionProgress(6);
    setMechanicsNote(null);
    setAnalysisStatus(null);
    setPanelOpen(true);
    setActiveTab("coach");

    try {
      // One backend request owns mechanics and one Manager-led review graph.
      // Seven criterion agents evaluate, simulate the reviewer, score, and
      // propose one aligned action in parallel.
      const session = await runWorkspaceCoachingSession(buildCoachingSessionPayload(user, essayPrompt));
      const workingDraft = session.cleaned_draft || draft;
      const appliedCount = session.mechanics?.applied_count ?? 0;

      if (workingDraft !== draft) updateActiveDraft(workingDraft);
      setMechanicsNote(
        appliedCount > 0
          ? `${appliedCount} spelling/mechanics fix${appliedCount === 1 ? "" : "es"} applied before coaching.`
          : null,
      );

      const review = session.review ?? null;
      const gotReview = !!review && review.schema_version === 3 && review.status !== "error";
      const coveredIds = session.outline_coverage?.covered_point_ids;
      if (coveredIds) {
        const known = new Set(buildOutlinePoints(user.personalizedOutline).map((p) => p.id));
        setAutoCovered(new Set(coveredIds.filter((id) => known.has(id))));
      }

      const combinedWarnings = session.warnings ?? [];

      if (!gotReview) throw new Error(combinedWarnings[0] || "The coaching session could not review your draft.");
      persistEssayReview(review, workingDraft);
      setReviewReady(true);

      setSessionProgress(100);
      setActiveTab("coach");
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    } catch (error) {
      console.error("Scholar-E coaching session failed.", error);
      const message = error instanceof Error ? error.message : "The coaching session could not review your draft.";
      setAnalysisStatus(message);
    } finally {
      setIsEvaluating(false);
      setCoachLoading(false);
      setSessionProgress(0);
    }
  }

  useEffect(() => {
    if (!isEvaluating) return;
    const interval = window.setInterval(() => {
      setSessionProgress((progress) => {
        if (progress >= 90) return progress;
        const increment = progress < 35 ? 3 : progress < 70 ? 2 : 1;
        return Math.min(90, progress + increment);
      });
    }, 700);
    return () => window.clearInterval(interval);
  }, [isEvaluating]);

  // Paste/upload auto-check: a paste bumps `pasteNonce`, and a debounced effect runs
  // the cheap `auto_check` (grammar + outline coverage) once the draft has settled.
  // `runAutoCheckRef` keeps the latest closure so the timeout sees the post-paste draft.
  const runAutoCheckRef = useRef(runAutoCheck);
  useEffect(() => {
    runAutoCheckRef.current = runAutoCheck;
  });
  const lastAutoCheckRef = useRef("");
  const [pasteNonce, setPasteNonce] = useState(0);
  useEffect(() => {
    if (pasteNonce === 0) return;
    const id = window.setTimeout(() => void runAutoCheckRef.current(), 800);
    return () => window.clearTimeout(id);
  }, [pasteNonce]);
  function triggerAutoCheck() {
    setPasteNonce((n) => n + 1);
  }

  async function requestRewrite(action: RewriteAction, text: string, surrounding: string) {
    const res = await runSelectionRewrite(buildRewritePayload(user, action, text, surrounding, essayPrompt));
    if (res.status === "error" || !res.rewritten_text) {
      throw new Error(res.note || "The rewrite could not be generated.");
    }
    return { rewritten_text: res.rewritten_text, note: res.note ?? "" };
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
      const pages: string[] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        pages.push(tc.items.map((i) => i.str ?? "").join(" "));
      }
      updateActiveDraft(normalizePdfDraftText(pages));
      setPdfStatus(`Imported ${pdf.numPages} pages from ${file.name}.`);
      triggerAutoCheck();
    } catch (e) {
      setPdfStatus(`Could not parse PDF: ${(e as Error).message}`);
    }
  }

  // Record/update a draft version snapshot. Dedupes on draft text so re-running
  // the coach without editing merges scores into the current version instead of
  // creating a duplicate.
  function upsertVersion(patch: Partial<EssayDraft> = {}, contentOverride?: string) {
    const content = contentOverride ?? draft;
    if (!content.trim()) return;
    const contentWordCount = content.trim().split(/\s+/).filter(Boolean).length;
    const prev = user?.drafts ?? [];
    const last = prev[prev.length - 1];
    const scholarshipName = user?.activeScholarship?.name || last?.scholarshipName;
    if (last && last.content === content) {
      const merged = [...prev];
      merged[merged.length - 1] = { ...last, ...patch, scholarshipName, wordCount: contentWordCount, savedAt: new Date().toISOString() };
      updateProfile({ drafts: merged });
    } else {
      const newVersion: EssayDraft = {
        id: crypto.randomUUID(),
        version: (last?.version ?? 0) + 1,
        content,
        wordCount: contentWordCount,
        savedAt: new Date().toISOString(),
        scholarshipName,
        ...patch,
      };
      updateProfile({ drafts: [...prev, newVersion] });
    }
    setSavedAt(Date.now());
  }

  function saveAsDraft() {
    if (wordCount < 1) return;
    upsertVersion({ reviewOverall: score ?? undefined });
  }

  function loadExampleEssay() {
    updateActiveDraft(exampleEssayDraft);
    setSavedAt(Date.now());
    triggerAutoCheck();
  }

  // Attach the canonical criterion scores to the current draft version.
  useEffect(() => {
    if (!reviewResult?.criteria) return;
    const reviewScores: Record<string, number> = {};
    for (const [key, value] of Object.entries(reviewResult.criteria)) {
      if (typeof value?.score === "number") reviewScores[key] = value.score;
    }
    if (!Object.keys(reviewScores).length) return;
    upsertVersion({ reviewScores, reviewOverall: reviewResult.overall_score ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewResult]);

  return (
    <div className="relative w-full border-t border-border bg-background" aria-busy={outlineLoading || isEvaluating}>
      <div inert={outlineLoading || isEvaluating || workspaceTutorialActive ? true : undefined}>
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
                <button
                  type="button"
                  onClick={loadExampleEssay}
                  className="hidden rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-accent sm:inline-flex"
                >
                  Load example
                </button>
              </TooltipTrigger>
              <TooltipContent>Load only the example essay draft</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <label
                  data-essay-workspace-tour="upload"
                  aria-label="Upload PDF draft"
                  className="grid size-9 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
                >
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

            <button
              data-essay-workspace-tour="evaluate"
              type="button"
              onClick={() => void runCoachingSession()}
              disabled={wordCount < 30 || !promptConfirmed || coachLoading || isEvaluating}
              aria-busy={coachLoading || isEvaluating}
              className={`ml-0.5 inline-flex items-center gap-1.5 rounded-lg bg-info px-3 py-2 text-[13px] font-medium text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-60 ${coachLoading || isEvaluating ? "agent-loading" : ""}`}
            >
              {coachLoading || isEvaluating ? <Spinner className="size-4" /> : <Wand2 className="size-4" />}
              {coachLoading || isEvaluating ? "Evaluating…" : "Evaluate"}
            </button>

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="ml-1 hidden md:block">
                  <ScoreRing score={score} />
                </div>
              </TooltipTrigger>
              <TooltipContent>{score == null ? "Run a coaching session to get your essay score" : `Essay score: ${score}/100`}</TooltipContent>
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

        {(pdfStatus || analysisStatus || bgStatus || mechanicsNote) && (
          <div className="flex items-center gap-1.5 border-t border-border bg-accent/40 px-4 py-1.5 text-[11px] text-muted-foreground">
            {bgStatus && <span className="size-2.5 shrink-0 animate-spin rounded-full border-2 border-info/30 border-t-info" />}
            <span className={mechanicsNote && !bgStatus && !pdfStatus && !analysisStatus ? "text-success" : undefined}>
              {bgStatus ?? pdfStatus ?? analysisStatus ?? mechanicsNote}
            </span>
          </div>
        )}
      </header>

      <Dialog open={promptPickerOpen} onOpenChange={(open) => {
        // Keep the landing chooser intentional — only close via Confirm.
        if (!open && !promptConfirmed) return;
        setPromptPickerOpen(open);
      }}>
        <DialogContent className="max-w-xl gap-0 p-0 sm:max-w-xl" onPointerDownOutside={(event) => {
          if (!promptConfirmed) event.preventDefault();
        }} onEscapeKeyDown={(event) => {
          if (!promptConfirmed) event.preventDefault();
        }}>
          <DialogHeader className="space-y-2 border-b border-border px-5 py-4 text-left">
            <DialogTitle className="text-[18px]">
              {availablePrompts.length > 0 ? "Which essay are you writing?" : "Set your writing focus"}
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              {availablePrompts.length > 0
                ? "Outline and coaching adapt to the prompt you confirm. You can also edit the prompt if it looks wrong."
                : "Some scholarships do not publish a formal essay prompt. Add one if you have it, or continue with a scholarship-guided outline."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-3 overflow-y-auto px-5 py-4">
            {availablePrompts.length > 0 && (
              availablePrompts.map((prompt, index) => {
                const active = index === pendingPromptIndex;
                return (
                  <button
                    key={`landing-prompt-${index}`}
                    type="button"
                    onClick={() => setPendingPromptIndex(index)}
                    aria-pressed={active}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                      active
                        ? "border-info bg-info/5 shadow-sm"
                        : "border-border bg-background hover:border-info/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {availablePrompts.length > 1 ? `Prompt ${index + 1}` : "Essay prompt"}
                      </span>
                      {active && <span className="text-[11px] font-semibold text-info">Selected</span>}
                    </div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/90">{prompt}</p>
                  </button>
                );
              })
            )}

            <div className="space-y-2 rounded-xl border border-dashed border-border bg-background p-3">
              <label htmlFor="landing-essay-prompt" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {availablePrompts.length > 0 ? "Edit or correct the prompt" : "Add an essay prompt (optional)"}
              </label>
              <textarea
                id="landing-essay-prompt"
                value={availablePrompts[pendingPromptIndex] ?? ""}
                onChange={(event) => updateEssayPrompt(event.target.value, pendingPromptIndex)}
                rows={4}
                placeholder={
                  availablePrompts.length > 0
                    ? "Correct the prompt text if extraction missed something…"
                    : "Paste an official prompt if you have one. Leave blank to continue without a formal prompt."
                }
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-info focus:ring-2 focus:ring-info/10"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Outline and coaching agents adapt dynamically to whatever prompt text you confirm here.
              </p>
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 border-t border-border px-5 py-4 sm:flex-col sm:space-x-0">
            <button
              type="button"
              onClick={() => void confirmEssayPrompt()}
              disabled={!(availablePrompts[pendingPromptIndex] || legacyPromptBlob).trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Sparkles className="size-4" />
              Use this prompt & build outline
            </button>
            <button
              type="button"
              onClick={continueWithoutFormalPrompt}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
            >
              Continue without a formal prompt
            </button>
            <p className="text-center text-[12px] text-muted-foreground">
              Without a prompt, evaluation adapts to the scholarship mission and selection criteria; no outline is generated.
            </p>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="border-b border-border bg-card">
        <div className="mx-auto max-w-[1440px] space-y-3 px-4 py-3 md:px-6">
          {promptConfirmed && (
            <div className="rounded-xl border border-info/20 bg-info/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-info">
                  {essayPrompt.trim()
                    ? hasMultiplePrompts
                      ? `Working on prompt ${selectedPromptIndex + 1}`
                      : "Working on essay prompt"
                    : "Scholarship-guided writing focus"}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPendingPromptIndex(selectedPromptIndex);
                    setPromptPickerOpen(true);
                  }}
                  className="text-[12px] font-semibold text-info hover:underline"
                >
                  Change prompt
                </button>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground line-clamp-2">
                {essayPrompt || "No formal prompt selected; evaluation uses the scholarship mission and selection criteria."}
              </p>
            </div>
          )}
          {!promptConfirmed && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-info/30 bg-info/10 px-3 py-2.5">
              <p className="text-[12px] font-medium text-foreground">
                Step 1 of 5 — confirm your essay prompt (or continue without one) to unlock outline and coaching.
              </p>
              <button
                type="button"
                onClick={() => {
                  setPendingPromptIndex(selectedPromptIndex);
                  setPromptPickerOpen(true);
                }}
                className="shrink-0 rounded-lg bg-info px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90"
              >
                Open prompt picker
              </button>
            </div>
          )}
          {promptConfirmed && !essayPrompt.trim() && (
            <p className="text-xs text-muted-foreground">
              Scholarship-guided mode: evaluation adapts to the mission and selection criteria. Use Change prompt to add a formal prompt and build an outline.
            </p>
          )}
        </div>
      </section>

      {/* Zone 2 (editor) + Zone 3 (sidebar) */}
      <div className="mx-auto flex max-w-[1440px] flex-col items-stretch lg:flex-row lg:items-start">
        <div className="flex min-h-[60vh] min-w-0 flex-1 flex-col lg:h-[calc(100vh-120px)] lg:min-h-0">
          <div
            data-essay-workspace-tour="editor"
            className={`mx-auto flex min-h-0 w-full flex-1 flex-col transition-[max-width] duration-300 ${panelOpen ? "max-w-[760px]" : "max-w-[960px]"}`}
          >
            <EssayEditor
              ref={editorApiRef}
              value={draft}
              onChange={updateActiveDraft}
              richValue={draftHtml}
              onRichChange={updateActiveDraftHtml}
              suggestions={suggestions}
              onDismiss={dismissSuggestion}
              onOpenHighlights={openHighlights}
              onAutoCheck={triggerAutoCheck}
              onRequestRewrite={requestRewrite}
              className="flex-1"
            />
          </div>
        </div>

        {panelOpen ? (
          <div
            style={{ "--essay-panel-width": `${panelWidth}px` } as React.CSSProperties}
            className={`relative max-h-[1200px] w-full overflow-visible lg:w-[var(--essay-panel-width)] lg:min-w-[40vw] lg:shrink-0 ${
              panelResizing ? "transition-none" : "transition-[width] duration-300 ease-out"
            }`}
          >
            <div
              role="separator"
              aria-label="Resize coaching sidebar"
              aria-orientation="vertical"
              aria-valuemin={300}
              aria-valuemax={Math.round(typeof window !== "undefined" ? window.innerWidth * 0.7 : 1200)}
              aria-valuenow={Math.round(panelWidth)}
              tabIndex={0}
              onPointerDown={(event) => {
                event.preventDefault();
                setPanelResizing(true);
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const direction = event.key === "ArrowLeft" ? 1 : -1;
                const minimum = Math.max(300, Math.round(window.innerWidth * 0.4));
                const maximum = Math.round(window.innerWidth * 0.7);
                setPanelWidth((width) => Math.max(minimum, Math.min(maximum, width + direction * 24)));
              }}
              className={`absolute inset-y-0 left-0 z-30 hidden w-2 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center outline-none lg:flex ${
                panelResizing ? "bg-info/10" : "hover:bg-info/10 focus:bg-info/10"
              }`}
            >
              <span className={`h-12 w-1 rounded-full transition-colors ${panelResizing ? "bg-info" : "bg-border"}`} />
            </div>
            <EssayWorkspacePanel
              activeTab={activeTab}
              onTabChange={setActiveTab}
              isEvaluating={isEvaluating}
              onCollapse={() => setPanelOpen(false)}
              essayPrompt={essayPrompt}
              promptConfirmed={promptConfirmed}
              outlineLoading={outlineLoading}
              outlineStatus={outlineStatus}
              reviewReady={reviewReady}
              suggestions={suggestions}
              onAccept={acceptSuggestion}
              onDismiss={dismissSuggestion}
              onReveal={revealSuggestion}
              onAcceptAllQuickFixes={acceptAllQuickFixes}
              quickFixCount={quickFixSuggestions.length}
              coachLoading={coachLoading}
              reviewResult={reviewResult}
              reviewUpdatedAt={reviewUpdatedAt}
              reviewDraftChanged={!!reviewUpdatedAt && draft !== reviewDraftAtRun}
              now={nowTick}
              covered={coveredPoints}
              onToggleCovered={toggleCovered}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className="hidden border-l border-border bg-card px-2 py-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:flex lg:flex-col lg:items-center lg:gap-3"
            aria-label="Open coaching panel"
          >
            <ChevronLeft className="size-4" />
            <span className="[writing-mode:vertical-rl] rotate-180">Coach</span>
          </button>
        )}
      </div>
      </div>

      <OutlineWorkspaceLoadingOverlay loading={outlineLoading} />
      <EssayReviewWorkspaceLoadingOverlay loading={isEvaluating} progress={sessionProgress} />
      {workspaceTutorialActive && (
        <EssayWorkspaceTutorial
          onFinish={closeWorkspaceTutorial}
          onSkip={closeWorkspaceTutorial}
        />
      )}
    </div>
  );
}

function EssayWorkspacePanel({
  activeTab,
  onTabChange,
  isEvaluating,
  onCollapse,
  essayPrompt,
  promptConfirmed,
  outlineLoading,
  outlineStatus,
  reviewReady,
  suggestions,
  onAccept,
  onDismiss,
  onReveal,
  onAcceptAllQuickFixes,
  quickFixCount,
  coachLoading,
  reviewResult,
  reviewUpdatedAt,
  reviewDraftChanged,
  now,
  covered,
  onToggleCovered,
}: {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  isEvaluating: boolean;
  onCollapse: () => void;
  essayPrompt: string;
  promptConfirmed: boolean;
  outlineLoading: boolean;
  outlineStatus: string | null;
  reviewReady: boolean;
  suggestions: Suggestion[];
  onAccept: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
  onReveal: (s: Suggestion) => void;
  onAcceptAllQuickFixes: () => void;
  quickFixCount: number;
  coachLoading: boolean;
  reviewResult: EssayReviewResult | null;
  reviewUpdatedAt: number | null;
  reviewDraftChanged: boolean;
  now: number;
  covered: Set<string>;
  onToggleCovered: (id: string) => void;
}) {
  const { user } = useUser();

  const tabs: Array<{ id: WorkspaceTab; label: string; icon: typeof ListChecks; count?: number }> = [
    { id: "outline", label: "Outline", icon: ListChecks },
    { id: "coach", label: "Essay Review", icon: Wand2 },
    { id: "highlights", label: "Fixes", icon: Sparkles, count: suggestions.length },
  ];

  return (
    <aside
      aria-busy={isEvaluating}
      className="relative flex w-full shrink-0 flex-col border-t border-border bg-card lg:sticky lg:top-[56px] lg:h-[calc(100vh-120px)] lg:overflow-hidden lg:border-l lg:border-t-0"
    >
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
      <div
        key={activeTab}
        data-outline-loading-region={activeTab === "outline" ? true : undefined}
        data-essay-review-loading-region={activeTab === "coach" ? true : undefined}
        className="min-h-0 flex-1 animate-in fade-in slide-in-from-bottom-1 overflow-y-auto p-4 duration-200"
      >
        {activeTab === "outline" && (
          <PersonalizedOutlinePanel
            outline={user?.personalizedOutline}
            wordLimit={buildOutlinePayload(user, essayPrompt).word_limit}
            loading={outlineLoading}
            status={outlineStatus}
            covered={covered}
            onToggleCovered={onToggleCovered}
          />
        )}
        {activeTab === "coach" && (
          <WorkspaceEssayReviewTab
            review={reviewResult}
            loading={isEvaluating && !reviewReady}
            updatedAt={reviewUpdatedAt}
            draftChanged={reviewDraftChanged}
            now={now}
          />
        )}
        {activeTab === "highlights" && (
          <WorkspaceHighlightsTab
            isEvaluating={isEvaluating}
            suggestions={suggestions}
            onAccept={onAccept}
            onDismiss={onDismiss}
            onReveal={onReveal}
            onAcceptAllQuickFixes={onAcceptAllQuickFixes}
            quickFixCount={quickFixCount}
            coachLoading={coachLoading}
          />
        )}
      </div>
    </aside>
  );
}

function outlineToText(outline?: PersonalizedOutlineResult) {
  const data = outline?.outline;
  if (!data) return "";
  const sections = data.sections ?? [];
  const lines = [
    ...sections.flatMap((section, index) => [
      outlineSectionHeading(section.section_name || `Section ${index + 1}`, index, sections.length),
      `Guidance: ${section.purpose}`,
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
  ];
  return lines.filter(Boolean).join("\n").trim();
}

function outlineSectionRole(index: number, total: number): string {
  if (total === 1) return "Introduction & Conclusion";
  if (index === 0) return "Introduction";
  if (index === total - 1) return "Conclusion";
  return "";
}

function cleanOutlineSectionTitle(title: string): string {
  return title.replace(/^(?:introduction(?:\s*&\s*conclusion)?|conclusion)\s*:\s*/i, "").trim();
}

function outlineSectionHeading(title: string, index: number, total: number): string {
  const role = outlineSectionRole(index, total);
  const cleanTitle = cleanOutlineSectionTitle(title);
  return role ? `${role}: ${cleanTitle}` : `Section ${index + 1}: ${cleanTitle}`;
}

function estimatedWordCountLabel(value: string): string {
  const estimate = value.trim();
  if (!/\d/.test(estimate)) return estimate;
  const approximate = estimate.startsWith("~") ? estimate : `~${estimate}`;
  return /\bwords?\b/i.test(approximate) ? approximate : `${approximate} words`;
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
  labelPrefix,
  detail,
  covered,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  labelPrefix?: string;
  detail?: string;
  covered: Set<string>;
  onToggle: (id: string) => void;
  children?: React.ReactNode;
}) {
  const done = covered.has(id);
  return (
    <div
      className={`rounded-lg border p-2.5 transition-colors duration-150 ${
        done
          ? "border-border bg-muted/20"
          : "border-border bg-background hover:border-info/30"
      }`}
    >
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
          <div className={`text-[14px] leading-snug ${done ? "text-muted-foreground line-through" : "text-foreground"}`}>
            {labelPrefix && <span className="font-bold">{labelPrefix}: </span>}
            <strong className="font-semibold">{label}</strong>
          </div>
          {detail && <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{detail}</div>}
          {children}
        </div>
      </div>
    </div>
  );
}

function PersonalizedOutlinePanel({
  outline,
  wordLimit,
  loading,
  status,
  covered,
  onToggleCovered,
}: {
  outline?: PersonalizedOutlineResult;
  wordLimit?: string;
  loading: boolean;
  status?: string | null;
  covered: Set<string>;
  onToggleCovered: (id: string) => void;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const data = outline?.outline;

  async function copyOutline() {
    const text = outlineToText(outline);
    if (!text) return;
    await navigator.clipboard?.writeText(text);
    setCopyStatus("Copied.");
    window.setTimeout(() => setCopyStatus(""), 1600);
  }

  return (
    <div className="relative text-foreground" aria-busy={loading}>
        {wordLimit && (
          <div className="border-b border-border pb-4">
            <div className="min-w-0">
              <div className="inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                {wordLimit}
              </div>
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
          const sections = data.sections ?? [];

          return (
            <div className="mt-4 space-y-3">
              {outline?.strategy?.tone_guidance && (
                <div className="flex items-start gap-2.5 rounded-lg border border-info/20 bg-info/5 px-3 py-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-info/10 text-info">
                    <Lightbulb className="size-4" aria-hidden="true" />
                  </span>
                  <p className="pt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-info">Recommended tip: </span>
                    <strong className="font-semibold text-foreground">{outline.strategy.tone_guidance}</strong>
                  </p>
                </div>
              )}

              {sections.map((s, i) => (
                <OutlineCheckRow
                  key={`p-sec-${i}`}
                  id={`p-sec-${i}`}
                  label={cleanOutlineSectionTitle(s.section_name || `Section ${i + 1}`)}
                  labelPrefix={outlineSectionRole(i, sections.length)}
                  detail={s.purpose}
                  covered={covered}
                  onToggle={onToggleCovered}
                >
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
                  {s.estimated_word_count && (
                    <div className="mt-1.5 text-[11px] text-muted-foreground">{estimatedWordCountLabel(s.estimated_word_count)}</div>
                  )}
                </OutlineCheckRow>
              ))}

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

function PanelEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-background p-4 text-[13px] leading-relaxed text-muted-foreground">
      {message}
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

function CoachSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}

type CoachTone = "success" | "warning" | "danger" | "info" | "muted";

function CoachList({ label, items, tone, icon: Icon }: { label: string; items?: string[]; tone: CoachTone; icon?: typeof Check }) {
  const [showAll, setShowAll] = useState(false);
  const clean = (items ?? []).filter(Boolean);
  if (!clean.length) return null;
  const visible = showAll ? clean : clean.slice(0, 2);
  const hiddenCount = Math.max(0, clean.length - 2);
  const toneText: Record<CoachTone, string> = {
    success: "text-success",
    warning: "text-warning",
    danger: "text-destructive",
    info: "text-info",
    muted: "text-muted-foreground",
  };
  const toneDot: Record<CoachTone, string> = {
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-destructive",
    info: "bg-info",
    muted: "bg-muted-foreground/50",
  };
  return (
    <div>
      <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${toneText[tone]}`}>
        {Icon && <Icon className="size-3.5" />}
        {label}
      </div>
      <ul className="mt-1.5 space-y-1 text-[13px] leading-relaxed text-foreground/85">
        {visible.map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2">
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${toneDot[tone]}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((open) => !open)}
          className="mt-1 inline-flex items-center rounded-md px-2 py-1 text-[12px] font-semibold text-info transition-colors hover:bg-info/10 hover:text-info"
          aria-expanded={showAll}
        >
          {showAll ? "Show less ▲" : `Show ${hiddenCount} more ▼`}
        </button>
      )}
    </div>
  );
}

function CriterionScoreButton({
  criterion,
  selected,
  onSelect,
}: {
  criterion: EssayCriterionReview;
  selected: boolean;
  onSelect: () => void;
}) {
  const score = typeof criterion.score === "number" ? criterion.score : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-controls="essay-review-criterion-detail"
      className={`group h-full w-full min-w-0 rounded-lg border px-2 py-2.5 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2 ${
        selected
          ? "border-info bg-info/10 shadow-sm"
          : "border-transparent bg-muted/35 hover:border-info/30 hover:bg-info/5"
      }`}
    >
      <span className={`flex min-h-9 items-center justify-center text-[11px] font-semibold leading-tight ${selected ? "text-info" : "text-foreground/85"}`}>
        {criterion.label || labelize(criterion.criterion ?? "criterion")}
      </span>
      <span className="mt-1 block text-[10px] font-semibold tabular-nums text-muted-foreground">
        {criterion.weight ?? 0}%
      </span>
      <span
        className="mt-1.5 block text-[22px] font-bold leading-none tabular-nums"
        style={score != null ? { color: scoreColor(score) } : undefined}
      >
        {score ?? "—"}
      </span>
    </button>
  );
}

function CriterionReviewDetails({ criterion }: { criterion: EssayCriterionReview }) {
  const score = typeof criterion.score === "number" ? criterion.score : null;
  const feedback = criterion.coach_feedback;
  const action = criterion.priority_action;
  const rubricBands = [
    ["Excellent", criterion.rubric?.excellent],
    ["Developing", criterion.rubric?.developing],
    ["Weak", criterion.rubric?.weak],
  ].filter((entry): entry is [string, string] => !!entry[1]);

  return (
    <section
      id="essay-review-criterion-detail"
      aria-live="polite"
      className="overflow-hidden rounded-xl border border-border bg-background"
    >
      <div className="flex items-start gap-3 border-b border-border bg-accent/25 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">{criterion.label || labelize(criterion.criterion ?? "criterion")}</div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            <span>{criterion.weight ?? 0}% ·</span>
            {!!rubricBands.length ? (
              <Tooltip delayDuration={150}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="font-semibold text-foreground/80 underline decoration-dotted underline-offset-2 outline-none transition-colors hover:text-info focus-visible:text-info"
                    aria-label={`Show the complete ${criterion.label || "criterion"} scoring rubric`}
                  >
                    {criterion.level || "Not scored"}
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="start"
                  sideOffset={7}
                  className="w-80 max-w-[calc(100vw-2rem)] p-3 text-left"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground/70">Tailored scoring rubric</div>
                  <div className="mt-2 space-y-2">
                    {rubricBands.map(([label, description]) => (
                      <div key={label} className="text-[11px] leading-relaxed text-primary-foreground/85">
                        <span className="font-semibold text-primary-foreground">{label}: </span>{description}
                      </div>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            ) : (
              <span>{criterion.level || "Not scored"}</span>
            )}
          </div>
          {criterion.rubric?.description && (
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{criterion.rubric.description}</p>
          )}
        </div>
        <span className="shrink-0 text-[18px] font-bold tabular-nums" style={score != null ? { color: scoreColor(score) } : undefined}>
          {score != null ? `${score}/100` : "Unavailable"}
        </span>
      </div>

      <div className="space-y-3 p-3">
        {(feedback?.grounded_praise || feedback?.main_gap) && (
          <section className="space-y-2 rounded-lg border border-info/20 bg-info/5 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-info">Scholarship Coach Feedback</div>
            {feedback?.grounded_praise && (
              <p className="text-[12px] leading-relaxed text-foreground/90">{feedback.grounded_praise}</p>
            )}
            {feedback?.main_gap && (
              <p className="text-[12px] leading-relaxed"><span className="font-semibold">Main gap: </span>{feedback.main_gap}</p>
            )}
          </section>
        )}

        {action && (
          <section className="space-y-2 rounded-lg border border-success/20 bg-success/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-success">Priority revision action</div>
              {(action.impact || action.estimated_effort) && (
                <div className="flex gap-1.5 text-[10px] font-semibold text-muted-foreground">
                  {action.impact && <span className="rounded-full bg-background/80 px-2 py-0.5">{action.impact} impact</span>}
                  {action.estimated_effort && <span className="rounded-full bg-background/80 px-2 py-0.5">{action.estimated_effort} effort</span>}
                </div>
              )}
            </div>
            {action.title && <div className="text-[13px] font-semibold">{action.title}</div>}
            {action.location && <p className="text-[12px] leading-relaxed"><span className="font-semibold">Where: </span>{action.location}</p>}
            {action.how_to_fix && <p className="text-[12px] leading-relaxed"><span className="font-semibold">How to fix it: </span>{action.how_to_fix}</p>}
            {action.why_this_fixes_the_gap && (
              <p className="text-[12px] leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">Why this fixes the gap: </span>{action.why_this_fixes_the_gap}</p>
            )}
            {action.evidence_safety && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">Evidence guardrail: {action.evidence_safety}</p>
            )}
          </section>
        )}
      </div>
    </section>
  );
}

function UnifiedEssayReview({
  review,
  updatedAt,
  draftChanged,
  now,
}: {
  review: EssayReviewResult;
  updatedAt: number | null;
  draftChanged: boolean;
  now: number;
}) {
  const { user } = useUser();
  const criteria = ESSAY_REVIEW_DIMENSIONS
    .map((key) => review.criteria?.[key])
    .filter((entry): entry is EssayCriterionReview => !!entry);
  const criteriaByKey = ESSAY_REVIEW_DIMENSIONS.reduce<Partial<Record<EssayReviewDimension, EssayCriterionReview>>>((entries, key) => {
    const criterion = review.criteria?.[key];
    if (criterion) entries[key] = criterion;
    return entries;
  }, {});
  const [selectedCriterionKey, setSelectedCriterionKey] = useState<EssayReviewDimension>(
    () => ESSAY_REVIEW_DIMENSIONS.find((key) => !!review.criteria?.[key]) ?? "alignment",
  );
  useEffect(() => {
    if (review.criteria?.[selectedCriterionKey]) return;
    const firstAvailable = ESSAY_REVIEW_DIMENSIONS.find((key) => !!review.criteria?.[key]);
    if (firstAvailable) setSelectedCriterionKey(firstAvailable);
  }, [review, selectedCriterionKey]);
  const selectedCriterion = criteriaByKey[selectedCriterionKey] ?? criteria[0];
  const grammarCriterion = criteriaByKey.grammar;
  const score = typeof review.overall_score === "number" ? review.overall_score : null;
  const scoredVersions = (user?.drafts ?? []).filter((version) => typeof version.reviewOverall === "number");

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[12px] text-muted-foreground">Last updated: {relativeTimeLabel(updatedAt, now)}</div>
        {draftChanged && <div className="mt-1 text-[12px] font-medium text-warning">Essay changed since this review.</div>}
      </div>

      <OverallEssayScoreCard score={score} versions={scoredVersions} />

      <div className="overflow-hidden rounded-xl border border-border bg-border">
        <div className="hidden grid-cols-6 gap-px md:grid">
          {ESSAY_REVIEW_SCORE_GROUPS.map((group) => (
            <h3 key={group.label} className={`bg-background px-3 py-3 text-center text-[18px] font-bold leading-tight text-foreground ${group.columnClass}`}>
              {group.label}
            </h3>
          ))}
          {ESSAY_REVIEW_SCORE_GROUPS.flatMap((group) => group.criteria).map((key) => {
            const criterion = criteriaByKey[key];
            if (!criterion) return null;
            return (
              <div key={key} className="min-w-0 bg-background p-1.5 pt-0">
                <CriterionScoreButton
                  criterion={criterion}
                  selected={selectedCriterionKey === key}
                  onSelect={() => setSelectedCriterionKey(key)}
                />
              </div>
            );
          })}
        </div>

        <div className="grid gap-px md:hidden">
          {ESSAY_REVIEW_SCORE_GROUPS.map((group) => {
            const groupCriteria = group.criteria
              .map((key) => [key, criteriaByKey[key]] as const)
              .filter((entry): entry is readonly [EssayReviewDimension, EssayCriterionReview] => !!entry[1]);
            if (!groupCriteria.length) return null;
            return (
              <section key={group.label} className="min-w-0 bg-background p-3">
                <h3 className="text-center text-[18px] font-bold leading-tight text-foreground">{group.label}</h3>
                <div className={`mt-3 grid gap-1.5 ${groupCriteria.length === 3 ? "grid-cols-3" : groupCriteria.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {groupCriteria.map(([key, criterion]) => (
                    <CriterionScoreButton
                      key={key}
                      criterion={criterion}
                      selected={selectedCriterionKey === key}
                      onSelect={() => setSelectedCriterionKey(key)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {grammarCriterion && (
          <section className="flex items-center gap-3 border-t border-border bg-background p-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-bold text-foreground">Grammar</h3>
              <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">Spelling, punctuation, usage, and sentence-level correctness</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedCriterionKey("grammar")}
              aria-pressed={selectedCriterionKey === "grammar"}
              aria-controls="essay-review-criterion-detail"
              className={`flex min-w-28 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2 ${
                selectedCriterionKey === "grammar"
                  ? "border-info bg-info/10 shadow-sm"
                  : "border-transparent bg-muted/35 hover:border-info/30 hover:bg-info/5"
              }`}
            >
              <span className="flex flex-col items-center">
                <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{grammarCriterion.weight ?? 0}%</span>
                <span className="mt-1 text-[22px] font-bold leading-none tabular-nums" style={typeof grammarCriterion.score === "number" ? { color: scoreColor(grammarCriterion.score) } : undefined}>
                  {typeof grammarCriterion.score === "number" ? grammarCriterion.score : "—"}
                </span>
              </span>
            </button>
          </section>
        )}
      </div>

      {selectedCriterion && <CriterionReviewDetails criterion={selectedCriterion} />}
    </div>
  );
}

function WorkspaceEssayReviewTab({
  review,
  loading,
  updatedAt,
  draftChanged,
  now,
}: {
  review: EssayReviewResult | null;
  loading: boolean;
  updatedAt: number | null;
  draftChanged: boolean;
  now: number;
}) {
  if (loading) {
    return (
      <CoachSkeleton />
    );
  }
  if (!review || review.schema_version !== 3) {
    return (
      <PanelEmpty
        message="No review yet. Select Evaluate to generate the weighted seven-criterion review for this draft."
      />
    );
  }
  return (
    <UnifiedEssayReview
      review={review}
      updatedAt={updatedAt}
      draftChanged={draftChanged}
      now={now}
    />
  );
}

function Sparkline({ points }: { points: number[] }) {
  const w = 320;
  const h = 40;
  const pad = 5;
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => [pad + i * step, h - pad - (Math.max(0, Math.min(100, p)) / 100) * (h - pad * 2)] as const);
  const d = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="var(--info)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === coords.length - 1 ? 3 : 2} fill="var(--info)" />
      ))}
    </svg>
  );
}

function OverallEssayScoreCard({ score, versions }: { score: number | null; versions: EssayDraft[] }) {
  const scored = versions.filter((v) => typeof v.reviewOverall === "number");
  const latest = scored[scored.length - 1] ?? null;
  const prev = scored.length > 1 ? scored[scored.length - 2] : null;
  const overall = score ?? latest?.reviewOverall ?? null;
  const overallDelta = prev && overall != null ? overall - (prev.reviewOverall ?? 0) : null;
  const deltas =
    prev?.reviewScores && latest?.reviewScores
      ? Object.entries(latest.reviewScores)
          .map(([k, v]) => ({ key: k, delta: v - (prev.reviewScores?.[k] ?? v) }))
          .filter((x) => x.delta !== 0)
          .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      : [];
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-3">
      <div className="flex items-center gap-3">
        <ScoreRing score={overall} size={58} stroke={4} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">Overall essay score</div>
          <div className="text-[12px] text-muted-foreground">Criteria weights tailored for this scholarship and essay prompt</div>
        </div>
      </div>

      {latest && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-[12px]">
          <span className="text-muted-foreground">Draft {latest.version} · {latest.wordCount} words</span>
          {prev && overallDelta != null ? (
            <span className="font-semibold" style={{ color: overallDelta >= 0 ? "var(--success)" : "var(--destructive)" }}>
              {overallDelta >= 0 ? `▲ +${overallDelta}` : `▼ ${overallDelta}`} since Draft {prev.version} · {scored.length} scored drafts
            </span>
          ) : (
            <span className="text-muted-foreground">First scored draft</span>
          )}
        </div>
      )}

      {scored.length > 1 && <Sparkline points={scored.map((v) => v.reviewOverall ?? 0)} />}
      {deltas.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {deltas.slice(0, 5).map((x) => (
            <span
              key={x.key}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${x.delta > 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}
            >
              {x.delta > 0 ? `▲ +${x.delta}` : `▼ ${x.delta}`} {labelize(x.key)}
            </span>
          ))}
        </div>
      )}
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
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard?.writeText(s.replacement);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className={`rounded-lg border border-l-4 border-border bg-background p-2.5 ${meta.borderClass}`}>
      <button type="button" onClick={() => onReveal(s)} className="block w-full text-left" title="Jump to this text in the editor">
        <div className="flex items-center gap-1.5">
          <span className={`text-[11px] font-semibold ${meta.textClass}`}>{s.title}</span>
          {s.source === "coach" && s.severity && (
            <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{s.severity}</span>
          )}
        </div>
        <div className="mt-1 text-[12px]">
          <span className="text-muted-foreground line-through decoration-muted-foreground/50">{s.original.trim() || "␠"}</span>
          <span className="mx-1 text-muted-foreground">→</span>
          <span className="font-medium text-foreground">{s.replacement.trim() || "(removed)"}</span>
        </div>
        {s.source === "coach" && s.explanation && (
          <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{s.explanation}</div>
        )}
      </button>
      <div className="mt-2 flex items-center gap-1.5">
        <button type="button" onClick={() => onAccept(s)} className="flex-1 rounded-md bg-info px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90">
          Accept
        </button>
        <button type="button" onClick={() => onDismiss(s)} className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          Ignore
        </button>
        <button
          type="button"
          onClick={copy}
          title="Copy suggested text"
          aria-label="Copy suggested text"
          className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
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
  onAcceptAllQuickFixes,
  quickFixCount,
  coachLoading,
}: {
  isEvaluating: boolean;
  suggestions: Suggestion[];
  onAccept: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
  onReveal: (s: Suggestion) => void;
  onAcceptAllQuickFixes: () => void;
  quickFixCount: number;
  coachLoading: boolean;
}) {
  const counts = countByCategory(suggestions);

  if (isEvaluating) return <HighlightsSkeleton />;

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-semibold text-muted-foreground">{suggestions.length} open</div>

      {quickFixCount > 0 && (
        <button
          type="button"
          onClick={onAcceptAllQuickFixes}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground transition-colors duration-150 hover:bg-accent"
          title="Applies grammar, spelling, spacing, and capitalization fixes — stylistic rewrites stay for individual review"
        >
          <Check className="size-3.5 text-success" />
          Accept {quickFixCount} quick fix{quickFixCount === 1 ? "" : "es"}
        </button>
      )}

      {coachLoading && <HighlightsSkeleton />}

      {!coachLoading && !suggestions.length && (
        <div className="rounded-xl border border-dashed border-border bg-background p-4 text-[13px] leading-relaxed text-muted-foreground">
          No sentence-level fixes are available for this draft. Run the main coaching session after making changes.
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

/* ---------------- Step 5: Revise — multiple drafts ---------------- */

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

function essayReviewPriorityActions(review?: EssayReviewResult | null): string[] {
  if (!review?.criteria) return [];
  return ESSAY_REVIEW_DIMENSIONS
    .map((key) => review.criteria[key]?.priority_action?.title)
    .filter((item): item is string => !!item?.trim());
}

function lowEssayReviewCriteria(review?: EssayReviewResult | null): string[] {
  if (!review?.criteria) return [];
  return ESSAY_REVIEW_DIMENSIONS
    .map((key) => review.criteria[key])
    .filter((entry): entry is EssayCriterionReview => typeof entry?.score === "number" && (entry.score ?? 0) < 70)
    .map((entry) => `${entry.label || labelize(entry.criterion ?? "criterion")} (${entry.score}/100)`);
}

/* ---------------- Step 6: Final Check ---------------- */

function StepFinalCheck({ onNavigate }: { onNavigate?: (slug: string) => void }) {
  const { user, updateProfile } = useUser();
  const review = user?.essayReviewResult?.schema_version === 3 ? user.essayReviewResult : null;
  const docs = user?.documents ?? [];
  const hasDoc = (kind: string) => docs.some((doc) => doc.kind.toLowerCase().includes(kind));
  const [zipping, setZipping] = useState(false);
  const [zipStatus, setZipStatus] = useState<string | null>(null);

  function addDocument(kind: string, file: File) {
    storeFile(file.name, file);
    updateProfile({ documents: [...docs, { name: file.name, kind }] });
  }

  async function downloadSubmissionZip() {
    setZipping(true);
    setZipStatus(null);
    try {
      const [{ default: JSZip }, { convertFileToPdf, essayToPdf }] = await Promise.all([
        import("jszip"),
        import("@/lib/pdfExport"),
      ]);
      const zip = new JSZip();
      let included = 0;
      const unavailable: string[] = [];
      const converted: string[] = [];

      if (user?.essayDraft?.trim()) {
        zip.file("essay.pdf", essayToPdf(user.essayDraft));
        included += 1;
      }

      for (const document of docs) {
        const file = getFile(document.name);
        const pdfName = `${document.name.replace(/\.[^./]+$/, "")}.pdf`;
        if (file) {
          const { blob, note } = await convertFileToPdf(file);
          zip.file(`${document.kind}/${pdfName}`, blob);
          included += 1;
          if (note) converted.push(document.name);
        } else {
          zip.file(
            `${document.kind}/${pdfName.replace(/\.pdf$/, ".MISSING.pdf")}`,
            essayToPdf(`"${document.name}" is recorded in the profile, but its file contents are not available in this browser session. Re-upload it on this page and download again.`),
          );
          unavailable.push(document.name);
        }
      }

      if (included === 0 && unavailable.length === 0) {
        setZipStatus("Nothing to download yet — add an essay draft or upload documents first.");
        return;
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(user?.activeScholarship?.name || "scholarship").replace(/[^\w-]+/g, "_")}-submission.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      const notes: string[] = [];
      if (unavailable.length) notes.push(`Re-upload ${unavailable.join(", ")} to include the original file contents.`);
      if (converted.length) notes.push(`${converted.join(", ")} were converted to PDF; review their formatting.`);
      setZipStatus(notes.length ? `Downloaded. ${notes.join(" ")}` : "Downloaded — everything was included as PDF.");
    } catch {
      setZipStatus("The submission ZIP could not be created. Try again.");
    } finally {
      setZipping(false);
    }
  }

  const checklist: Array<{
    item: string;
    hint: string;
    done: boolean;
    targetSlug: string;
    documentKind?: string;
  }> = [
    {
      item: "Student profile created",
      hint: "Complete the required student profile information.",
      done: !!user?.educationLevel,
      targetSlug: "profile",
    },
    {
      item: "Scholarship requirements imported",
      hint: "Add or extract the scholarship requirements.",
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
      targetSlug: "requirements",
    },
    {
      item: "Resume uploaded or identified",
      hint: "Upload the resume you want included with this submission.",
      done: hasDoc("resume"),
      targetSlug: "profile",
      documentKind: "Resume",
    },
    {
      item: "Transcript uploaded or identified",
      hint: "Upload your transcript.",
      done: hasDoc("transcript"),
      targetSlug: "profile",
      documentKind: "Transcript",
    },
    {
      item: "Recommendation letter uploaded or identified",
      hint: "Upload a recommendation letter.",
      done: hasDoc("recommendation") || hasDoc("rec"),
      targetSlug: "profile",
      documentKind: "Letter of Recommendation",
    },
    {
      item: "Essay draft added",
      hint: "Write or paste a draft in the Essay Workspace.",
      done: !!user?.essayDraft?.trim(),
      targetSlug: "essay-workspace",
    },
    {
      item: "Essay review completed",
      hint: "Run the Essay Review in the Essay Workspace.",
      done: !!review,
      targetSlug: "essay-workspace",
    },
  ];
  const done = checklist.filter((x) => x.done).length;
  const percent = Math.round((done / checklist.length) * 100);
  const allDone = done === checklist.length;
  const nextIncomplete = checklist.find((item) => !item.done);
  const revisionNotes = essayReviewPriorityActions(review).slice(0, 3);
  const lowDims = lowEssayReviewCriteria(review);

  return (
    <div className="space-y-6">
      <Card className="border-primary/30 bg-primary/5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Download className="size-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">Download your submission</div>
              <p className="mt-0.5 text-xs text-muted-foreground">Bundle your essay and supporting documents into one ZIP file.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void downloadSubmissionZip()}
            disabled={zipping}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Download className="size-4" />
            {zipping ? "Zipping…" : "Download as ZIP"}
          </button>
        </div>
        {zipStatus && <p className="mt-3 text-xs text-muted-foreground" role="status">{zipStatus}</p>}
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Submission readiness</div>
            <div className="mt-1 font-display text-3xl">
              {done} / {checklist.length} complete
              <span className="ml-2 text-base font-normal text-muted-foreground">({percent}%)</span>
            </div>
          </div>
          <div className={`grid size-16 shrink-0 place-items-center rounded-2xl font-display text-2xl ${allDone ? "bg-success/20 text-success" : "bg-warning/20"}`}>
            {allDone ? <Check className="size-7" strokeWidth={3} /> : "!"}
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
          <div className={`h-full transition-[width] duration-500 ${allDone ? "bg-success" : "bg-warning"}`} style={{ width: `${percent}%` }} />
        </div>
        {!allDone && nextIncomplete && onNavigate && (
          <button type="button" onClick={() => onNavigate(nextIncomplete.targetSlug)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">
            Fix next: {nextIncomplete.item}
            <ArrowRight className="size-4" />
          </button>
        )}
      </Card>

      <Card>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Final checklist</div>
        <ul className="mt-3 divide-y divide-border">
          {checklist.map((item) => {
            const canUpload = !!item.documentKind && !item.done;
            const canNavigate = !item.done && !canUpload && !!onNavigate;
            return (
              <li key={item.item} className="flex items-start gap-3 py-3">
                <div className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md ${item.done ? "bg-success text-white" : "border-2 border-warning"}`}>
                  {item.done && <Check className="size-3.5" strokeWidth={3} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${item.done ? "" : "font-medium text-foreground"}`}>{item.item}</div>
                  {!item.done && <p className="mt-0.5 text-xs text-muted-foreground">{item.hint}</p>}
                </div>
                {!item.done && <Pill tone="warn">action needed</Pill>}
                {canUpload && (
                  <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent focus-within:ring-2 focus-within:ring-primary/30">
                    <FileUp className="size-3.5" /> Upload
                    <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" className="hidden" onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) addDocument(item.documentKind!, file);
                    }} />
                  </label>
                )}
                {canNavigate && (
                  <button type="button" onClick={() => onNavigate?.(item.targetSlug)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Go to ${item.item}`}>
                    <ChevronRight className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {allDone && (
        <Card className="border-success/30 bg-success/10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-medium text-success">Ready to submit — all checks passed.</div>
            {onNavigate && <button type="button" onClick={() => onNavigate("tracker")} className="inline-flex items-center gap-2 rounded-lg border border-success/40 bg-card px-3 py-1.5 text-xs font-medium text-success hover:bg-success/10">Go to Tracker <ArrowRight className="size-3.5" /></button>}
          </div>
        </Card>
      )}

      {(revisionNotes.length > 0 || lowDims.length > 0) && (
        <Card className="bg-secondary/40">
          <div className="text-sm font-medium">Optional polish from your Essay Review{allDone ? "" : " (not required to submit)"}:</div>
          {revisionNotes.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground/80">
            {revisionNotes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>}
          {lowDims.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Lowest review dimensions: {lowDims.join(", ")}</p>}
        </Card>
      )}
    </div>
  );
}

/* ---------------- Step 7: Tracker ---------------- */

function daysAgoLabel(iso?: string): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

type DateRangeFilter = "all" | "24h" | "1w" | "1m" | "6m" | "1y";
const DATE_RANGE_OPTIONS: Array<{ value: DateRangeFilter; label: string }> = [
  { value: "all", label: "All time" },
  { value: "24h", label: "Last 24 hours" },
  { value: "1w", label: "Last week" },
  { value: "1m", label: "Last month" },
  { value: "6m", label: "Last 6 months" },
  { value: "1y", label: "Last year" },
];

function dateRangeCutoff(range: DateRangeFilter): Date | null {
  if (range === "all") return null;
  const cutoff = new Date();
  if (range === "24h") cutoff.setHours(cutoff.getHours() - 24);
  if (range === "1w") cutoff.setDate(cutoff.getDate() - 7);
  if (range === "1m") cutoff.setMonth(cutoff.getMonth() - 1);
  if (range === "6m") cutoff.setMonth(cutoff.getMonth() - 6);
  if (range === "1y") cutoff.setFullYear(cutoff.getFullYear() - 1);
  return cutoff;
}

type DraftChartPoint = { draft: string; score: number; draftId: string };
type DraftDotProps = { cx?: number; cy?: number; index?: number; payload?: DraftChartPoint };

function DraftDot({ cx, cy, index, payload, r = 4, onSelect }: DraftDotProps & { r?: number; onSelect: (point: DraftChartPoint) => void }) {
  if (cx == null || cy == null) return null;
  return <circle key={`draft-dot-${index}`} cx={cx} cy={cy} r={r} fill="var(--info)" stroke="var(--card)" strokeWidth={1.5} className="cursor-pointer" onClick={() => payload && onSelect(payload)} />;
}

function StepTracker({ onNavigate }: { onNavigate?: (slug: string) => void }) {
  const { user, updateProfile } = useUser();
  const scholarship = user?.activeScholarship;
  const review = user?.essayReviewResult?.schema_version === 3 ? user.essayReviewResult : null;
  const currentScore = typeof review?.overall_score === "number" ? review.overall_score : undefined;
  const applications = useMemo(() => user?.applications ?? [], [user?.applications]);
  const [openColumn, setOpenColumn] = useState<ApplicationStatus | null>(null);
  const [scholarshipFilter, setScholarshipFilter] = useState("");
  const [dateFilter, setDateFilter] = useState<DateRangeFilter>("all");

  useEffect(() => {
    if (!scholarship?.name) return;
    const existing = applications.find((application) => application.name === scholarship.name);
    if (!existing) {
      updateProfile({
        applications: [...applications, {
          id: crypto.randomUUID(),
          name: scholarship.name,
          type: scholarship.type,
          status: "Drafting",
          scoreHistory: currentScore === undefined ? [] : [currentScore],
          updatedAt: new Date().toISOString(),
        }],
      });
      return;
    }
    if (currentScore !== undefined && existing.scoreHistory?.at(-1) !== currentScore) {
      updateProfile({
        applications: applications.map((application) => application.id === existing.id
          ? { ...application, scoreHistory: [...(application.scoreHistory ?? []), currentScore], updatedAt: new Date().toISOString() }
          : application),
      });
    }
    // Persist only when the active scholarship or completed review changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scholarship?.name, currentScore]);

  function updateStatus(id: string, status: ApplicationStatus) {
    updateProfile({ applications: applications.map((application) => application.id === id ? { ...application, status, updatedAt: new Date().toISOString() } : application) });
  }

  if (applications.length === 0) {
    return <Card className="py-12 text-center text-sm text-muted-foreground">Nothing tracked yet. Import a scholarship and begin an application to see it here.</Card>;
  }

  const latest = [...applications].sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())[0];
  const drafting = applications.filter((application) => application.status === "Drafting");
  const submitted = applications.filter((application) => application.status === "Submitted");
  const awarded = applications.filter((application) => application.status === "Awarded");
  const active = drafting.length + submitted.length;
  const needsAttention = applications
    .filter((application) => application.status !== "Awarded" && (application.scoreHistory?.length ?? 0) > 0)
    .sort((a, b) => a.scoreHistory!.at(-1)! - b.scoreHistory!.at(-1)!)
    .slice(0, 3);

  const drafts = user?.drafts ?? [];
  const scholarshipOptions = Array.from(new Set([...applications.map((application) => application.name), ...drafts.map((draft) => draft.scholarshipName).filter((name): name is string => !!name)]));
  const cutoff = dateRangeCutoff(dateFilter);
  const filteredDrafts = drafts
    .filter((draft) => !scholarshipFilter || draft.scholarshipName === scholarshipFilter)
    .filter((draft) => !cutoff || new Date(draft.savedAt).getTime() >= cutoff.getTime());
  let lastScore: number | undefined;
  const chartData = filteredDrafts.map((draft) => {
    if (typeof draft.reviewOverall === "number") lastScore = draft.reviewOverall;
    return { draft: `Draft ${draft.version}`, score: lastScore, draftId: draft.id };
  }).filter((point): point is DraftChartPoint => typeof point.score === "number");
  const pipeline: Array<{ status: ApplicationStatus; items: TrackedApplication[] }> = [
    { status: "Drafting", items: drafting },
    { status: "Submitted", items: submitted },
    { status: "Awarded", items: awarded },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex items-center gap-4"><div className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><UserRound className="size-5" /></div><div><div className="text-xs uppercase tracking-widest text-muted-foreground">Active</div><div className="mt-0.5 font-display text-2xl">{active}</div></div></Card>
        <Card className="flex items-center gap-4"><div className="grid size-11 shrink-0 place-items-center rounded-xl bg-success/15 text-success"><Check className="size-5" strokeWidth={3} /></div><div className="min-w-0"><div className="text-xs uppercase tracking-widest text-muted-foreground">Latest application</div><button type="button" onClick={() => onNavigate?.("discovery")} className="max-w-full truncate text-left text-sm font-medium hover:underline">{latest.name}</button><div className="text-xs text-muted-foreground">Updated {daysAgoLabel(latest.updatedAt)}</div></div></Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Score by draft</div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateRangeFilter)} className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium">
              {DATE_RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {scholarshipOptions.length > 1 && <select value={scholarshipFilter} onChange={(event) => setScholarshipFilter(event.target.value)} className="max-w-[60%] rounded-full border border-border bg-card px-3 py-1 text-xs font-medium"><option value="">All scholarships</option>{scholarshipOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select>}
          </div>
        </div>
        <div className="mt-4 h-72">
          {chartData.length ? <ResponsiveContainer width="100%" height="100%"><RechartsLineChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 24 }}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="draft" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} /><YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} /><RechartsTooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", fontSize: 12 }} /><Legend verticalAlign="top" align="right" height={28} wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="score" name="Overall score" stroke="var(--info)" strokeWidth={2.5} dot={(props: DraftDotProps) => <DraftDot {...props} onSelect={() => onNavigate?.("revise")} />} activeDot={(props: DraftDotProps) => <DraftDot {...props} r={6} onSelect={() => onNavigate?.("revise")} />} /></RechartsLineChart></ResponsiveContainer> : <div className="grid h-full place-items-center text-sm text-muted-foreground">{scholarshipFilter || dateFilter !== "all" ? "No scored drafts match this filter." : "No drafts scored yet."}</div>}
        </div>
      </Card>

      {needsAttention.length > 0 && <Card><div className="text-xs uppercase tracking-widest text-muted-foreground">Needs attention · Lowest scores</div><ul className="mt-3 divide-y divide-border">{needsAttention.map((application) => { const score = application.scoreHistory!.at(-1)!; return <li key={application.id} className="flex items-center gap-3 py-3"><span className={`size-2 shrink-0 rounded-full ${score < 50 ? "bg-destructive" : "bg-info"}`} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{application.name}</span><span className="shrink-0 text-xs uppercase tracking-widest text-muted-foreground">{application.status}</span><span className={`shrink-0 font-mono text-sm ${score < 50 ? "text-destructive" : "text-info"}`}>{score}/100</span></li>; })}</ul></Card>}

      <div className="grid gap-4 md:grid-cols-3">
        {pipeline.map((column) => <StatusColumn key={column.status} status={column.status} items={column.items} onViewAll={() => setOpenColumn(column.status)} />)}
      </div>

      <Dialog open={openColumn !== null} onOpenChange={(open) => !open && setOpenColumn(null)}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle className="font-display text-xl">{openColumn}</DialogTitle><DialogDescription>{openColumn ? pipeline.find((column) => column.status === openColumn)?.items.length : 0} applications</DialogDescription></DialogHeader><div className="max-h-80 space-y-2 overflow-y-auto">{openColumn && pipeline.find((column) => column.status === openColumn)?.items.map((application) => <div key={application.id} className="rounded-lg border border-border p-3"><div className="flex items-center justify-between gap-2"><div className="truncate text-sm font-medium">{application.name}</div>{(application.scoreHistory?.length ?? 0) > 0 && <span className="shrink-0 font-mono text-xs text-muted-foreground">{application.scoreHistory!.at(-1)}/100</span>}</div><div className="mt-2 flex items-center gap-2">{application.status === "Drafting" && <button type="button" onClick={() => updateStatus(application.id, "Submitted")} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"><Send className="size-3" /> Mark submitted</button>}{application.status === "Submitted" && <button type="button" onClick={() => updateStatus(application.id, "Awarded")} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"><ShieldCheck className="size-3" /> Mark awarded</button>}</div></div>)}</div></DialogContent>
      </Dialog>
    </div>
  );
}

function StatusColumn({ status, items, onViewAll }: { status: ApplicationStatus; items: TrackedApplication[]; onViewAll: () => void }) {
  const tone = status === "Drafting" ? "bg-warning/15 text-warning" : status === "Submitted" ? "bg-info/15 text-info" : "bg-success/15 text-success";
  return (
    <Card>
      <div className="flex items-center justify-between"><div className="text-xs uppercase tracking-widest text-muted-foreground">{status}</div><span className={`rounded-full px-2 py-0.5 font-mono text-xs ${tone}`}>{items.length}</span></div>
      {items.length > 0 ? <button type="button" onClick={onViewAll} className="mt-3 w-full rounded-xl border border-border p-4 text-left hover:bg-accent"><div className="font-display text-3xl">{items.length}</div><div className="mt-1 flex items-center justify-between text-sm text-muted-foreground">application{items.length === 1 ? "" : "s"}<span className="inline-flex items-center gap-1 font-medium text-foreground">View all <ChevronRight className="size-3.5" /></span></div></button> : <div className="mt-3 rounded-xl border border-dashed border-border p-6 text-center"><Plus className="mx-auto size-5 text-muted-foreground" /><div className="mt-2 text-sm text-muted-foreground">No items yet</div></div>}
    </Card>
  );
}
