import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import scholarELogoUrl from "../../logo/logoPic.jpeg";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ClipboardList,
  Compass,
  Copy,
  FileUp,
  Lightbulb,
  LineChart,
  ListChecks,
  Lock,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Power,
  ReceiptText,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound,
  Wand2,
} from "lucide-react";
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
  getScholarshipDiscoveryBootstrap,
  buildRewritePayload,
  extractScholarshipOpportunity,
  generatePersonalizedOutline,
  runEditorCheck,
  runSelectionRewrite,
  runWorkspaceCoachingSession,
  splitEssayPrompts,
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
  type WikiDiscoveryResult,
  type ApplicationReadinessMatrix,
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
              ? user?.wikiDiscovery
                ? "bg-[radial-gradient(circle_at_85%_8%,rgba(109,93,246,0.10),transparent_28%),linear-gradient(180deg,#f4f6fb_0%,#ffffff_48%,#f4f2fb_100%)]"
                : "bg-[radial-gradient(circle_at_18%_15%,rgba(109,93,246,0.18),transparent_34%),radial-gradient(circle_at_82%_75%,rgba(46,196,182,0.12),transparent_30%),linear-gradient(145deg,#f7f8ff_0%,#eef2fb_52%,#f8f5ff_100%)]"
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

function isRequiredAboutComplete(user: UserProfile | null) {
  return !!(
    user?.gender?.trim() &&
    user.location?.trim() &&
    user.citizenshipStatus?.trim() &&
    user.raceEthnicity
  );
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
  profileError,
  startProfilePrompt,
  onProfileSetupComplete,
}: {
  slug: string;
  goNext: () => void;
  goPrev: () => void;
  goToProfile: () => void;
  goToRequirements: () => void;
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
const PROFILE_ENTRY_CLASS = "rounded-lg border border-border/60 bg-white/60 p-4";

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
    updateProfile({
      educationHistory: [
        ...educationHistory,
        {
          id: newId("edu"),
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
  const aboutYouComplete = isRequiredAboutComplete(user);
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

  const uploadedDocsList = docs.length > 0 && (
    <div className="mt-4 divide-y divide-border">
      {docs.map((d) => (
        <div key={d.name} className="py-3 flex items-center gap-4">
          <div className="size-10 rounded-lg bg-success/15 text-success grid place-items-center"><Check className="size-5" strokeWidth={2.5} /></div>
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
  const profileSummaryCard = (
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
      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        <Input label="Full name" value={user?.name ?? ""} onChange={(v) => set("name", v)} placeholder="Maya Rodriguez" />
        <Input label="Email" value={user?.email ?? ""} onChange={(v) => set("email", v)} placeholder="you@school.edu" type="email" />
      </div>
    </Card>
  );
  const aboutYouCard = (
    <Card className={PROFILE_SECTION_CLASS}>
      <SectionLabel>About you *</SectionLabel>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <Select
          label="Gender"
          value={user?.gender ?? ""}
          onChange={(v) => set("gender", v)}
          options={genderOptions}
          invalid={showSetupErrors && !user?.gender?.trim()}
        />
        <Input
          label="Location"
          value={user?.location ?? ""}
          onChange={(v) => set("location", v)}
          placeholder="City, State"
          invalid={showSetupErrors && !user?.location?.trim()}
        />
        <Select
          label="Citizenship / Residency Status"
          value={user?.citizenshipStatus ?? ""}
          onChange={(v) => set("citizenshipStatus", v)}
          options={citizenshipOptions}
          invalid={showSetupErrors && !user?.citizenshipStatus?.trim()}
        />
        <Select
          label="Please select your Race / Ethnicity"
          value={user?.raceEthnicity ?? ""}
          onChange={(v) => set("raceEthnicity", v)}
          options={raceOptions}
          invalid={showSetupErrors && !user?.raceEthnicity}
        />
      </div>

      <button
        type="button"
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
  const optionalContextCard = (
    <Card className={`${PROFILE_SECTION_CLASS}`}>
      <SectionLabel>Optional context</SectionLabel>
      <p className="text-xs text-muted-foreground mt-1">
        All optional — add whatever helps scholarships see who you are.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Textarea label="Volunteering" value={user?.optional?.volunteering ?? ""} onChange={(v) => setOptional({ volunteering: v })} placeholder="Describe any volunteer work, community service, or nonprofit involvement you’d like Scholar-E to consider." />
        <Textarea label="Society / club involvement" value={user?.optional?.societyInvolvement ?? ""} onChange={(v) => setOptional({ societyInvolvement: v })} placeholder="Clubs, organizations, roles…" />
        <Textarea label="Leadership experience" value={user?.optional?.leadership ?? ""} onChange={(v) => setOptional({ leadership: v })} placeholder="Captain, president, lead organizer, founder…" />
        <Textarea label="Sports" value={user?.optional?.sports ?? ""} onChange={(v) => setOptional({ sports: v })} placeholder="Teams, varsity/club, captaincy…" />
        <Textarea label="Articles published" value={user?.optional?.articlesPublished ?? ""} onChange={(v) => setOptional({ articlesPublished: v })} placeholder="Titles, outlets, links…" />
        <Textarea label="Projects" value={user?.optional?.projects ?? ""} onChange={(v) => setOptional({ projects: v })} placeholder="Personal, school, or research projects…" />
      </div>
    </Card>
  );
  const profileSetupSteps = [
    {
      title: "About You",
      helper: "Complete these required details so Scholar-E can personalize your profile and improve opportunity matching.",
      required: true,
      complete: aboutYouComplete,
      content: (
        <div className="space-y-6">
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
      content: educationCard,
    },
    {
      title: "Experience",
      helper: "Review your experiences and add or update anything that best represents your background.",
      required: false,
      complete: true,
      content: <div className="space-y-6">{experienceSection}</div>,
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
  const continueLabel = isFinalStep
    ? "Finish Profile Setup"
    : currentOptional
      ? "Continue"
      : "Continue";

  return (
    <section className="mx-auto max-w-6xl" aria-labelledby="profile-setup-title">
      <div className="mb-6 rounded-2xl border border-border bg-card p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Student Profile</div>
            <h1 id="profile-setup-title" className="mt-2 font-display text-3xl font-semibold">
              Complete Your Profile
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Review the information below. Some details may already be filled from your resume. You can edit everything now or later.
            </p>
          </div>
          <div className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground">
            Step {currentStep + 1} of {steps.length}
          </div>
        </div>
        <div className="mt-5 flex gap-2 overflow-x-auto pb-1 md:hidden" aria-label="Profile setup progress">
          {steps.map((item, index) => (
            <button
              key={item.title}
              type="button"
              onClick={() => onStepSelect(index)}
              disabled={index > highestStep}
              aria-current={index === currentStep ? "step" : undefined}
              aria-label={`${item.title}, ${index === currentStep ? "current" : index < highestStep ? "completed" : "upcoming"}`}
              className={`min-w-36 rounded-full border px-3 py-1.5 text-left text-xs font-medium ${
                index === currentStep
                  ? "border-primary bg-primary text-primary-foreground"
                  : index <= highestStep
                    ? "border-border bg-background text-foreground"
                    : "border-border bg-muted/50 text-muted-foreground opacity-60"
              }`}
            >
              {index < highestStep && index !== currentStep ? "✓" : index + 1}. {item.title}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden md:block">
          <nav className="sticky top-24 rounded-2xl border border-border bg-card p-3" aria-label="Profile setup steps">
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
                  className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isReachable
                        ? "hover:bg-accent"
                        : "cursor-not-allowed text-muted-foreground opacity-60"
                  }`}
                  aria-current={isActive ? "step" : undefined}
                >
                  <span className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] ${
                    isActive
                      ? "bg-primary-foreground text-primary"
                      : isComplete
                        ? "bg-success/20 text-success"
                        : "bg-secondary text-secondary-foreground"
                  }`}>
                    {isComplete ? "✓" : index + 1}
                  </span>
                  <span>
                    <span className="block font-medium">{item.title}</span>
                    <span className="block text-[11px] opacity-75">{item.required ? "Required" : "Optional"}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 rounded-2xl border border-border bg-card p-5 md:p-6">
          <div className="sr-only" aria-live="polite">
            Step {currentStep + 1} of {steps.length}: {step.title}
          </div>
          <div className="mb-5 border-b border-border pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="font-display text-2xl font-semibold outline-none"
              >
                {step.title}
              </h2>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                step.required ? "bg-warning/20 text-foreground" : "bg-secondary text-secondary-foreground"
              }`}>
                {step.required ? "Required" : "Optional"}
              </span>
              {importedBadge}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.helper}</p>
            {showValidation && !currentComplete && (
              <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                Complete the required fields in this step before continuing.
              </p>
            )}
          </div>

          <div className="animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
            {step.content}
          </div>

          <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={onBack}
              disabled={currentStep === 0}
              className="rounded-full border border-border px-5 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={onContinue}
              disabled={!currentComplete && !currentOptional}
              className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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
  label, value, onChange, placeholder, className = "", type = "text", invalid = false,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string; type?: string; invalid?: boolean }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        className={`mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm ${
          invalid ? "border-destructive ring-2 ring-destructive/20" : "border-border"
        }`}
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
  label, value, onChange, options, className = "", invalid = false,
}: { label: string; value: string; onChange: (v: string) => void; options: string[]; className?: string; invalid?: boolean }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        className={`mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm ${
          invalid ? "border-destructive ring-2 ring-destructive/20" : "border-border"
        }`}
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

function EducationHistorySection({
  entries,
  onAdd,
  onRemove,
  onChange,
  showMissingEducationLevel = false,
}: {
  entries: EducationHistoryEntry[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<EducationHistoryEntry>) => void;
  showMissingEducationLevel?: boolean;
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
        <button type="button" onClick={onAdd} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">
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
                invalid={showMissingEducationLevel && !entry.educationLevel?.trim()}
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
          <button type="button" onClick={onToggle} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">
            {isOpen ? "Collapse" : "Expand"}
          </button>
          <button type="button" onClick={onAdd} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">
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
            Work, internships, research assistantships, teaching assistantships, and leadership experience.
          </p>
        </div>
        <button type="button" onClick={onAdd} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">
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
                options={["Work", "Internship", "Research Assistant", "Teaching Assistant", "Leadership", "Other"]}
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
  // Always land on the search setup; earlier results stay one click away.
  const [showResults, setShowResults] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [focus, setFocus] = useState(user?.discoveryFocus ?? "");
  const [intentOptions, setIntentOptions] = useState(user?.discoveryIntentOptions ?? []);
  const [platformDefaults, setPlatformDefaults] = useState(user?.discoveryPlatformDefaults ?? []);
  const [bootstrapSummary, setBootstrapSummary] = useState<Record<string, string>>({});
  const [bootstrapLoading, setBootstrapLoading] = useState(!user?.discoveryIntentOptions?.length);
  const [bootstrapError, setBootstrapError] = useState("");
  const [selectedIntentIds, setSelectedIntentIds] = useState<string[]>(
    () => user?.discoveryIntents?.map((intent) => intent.id) ?? [],
  );
  const [bringValue, setBringValue] = useState("");
  const [platformContext, setPlatformContext] = useState("");
  const [showBring, setShowBring] = useState(false);

  useEffect(() => {
    let active = true;
    const studentProfile = buildWikiPayload(user).student_profile;
    getScholarshipDiscoveryBootstrap(studentProfile)
      .then((result) => {
        if (!active) return;
        setIntentOptions(result.intent_options ?? []);
        setPlatformDefaults(result.platform_defaults ?? []);
        setBootstrapSummary(result.profile_summary ?? {});
        setBootstrapError("");
        updateProfile({
          discoveryIntentOptions: result.intent_options ?? [],
          discoveryPlatformDefaults: result.platform_defaults ?? [],
        });
      })
      .catch(() => {
        if (!active) return;
        setBootstrapError("We couldn’t prepare profile suggestions. You can still describe what you want below.");
      })
      .finally(() => {
        if (active) setBootstrapLoading(false);
      });
    return () => { active = false; };
    // Step 2 remounts after profile updates; bootstrap once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshWiki() {
    setLoading(true);
    setStatus("Looking for scholarships related to your profile...");
    const progressTimer = window.setTimeout(
      () => setStatus("Checking trusted sources and organizing useful places to search..."),
      5000,
    );
    try {
      const discoveryFocus = focus.trim();
      const selectedIntents = intentOptions.filter((intent) => selectedIntentIds.includes(intent.id));
      const result = await discoverScholarshipWiki({
        ...buildWikiPayload(user),
        selected_intents: selectedIntents,
        free_text_intent: discoveryFocus,
      });
      updateProfile({ wikiDiscovery: result, discoveryFocus, discoveryIntents: selectedIntents });
      setStatus(result.result_note || "Your discovery results are ready.");
      setShowResults(true);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "We couldn't complete this search. Please try again.");
      setShowResults(false);
    } finally {
      window.clearTimeout(progressTimer);
      setLoading(false);
    }
  }

  function useSourceForExtraction(source: DiscoverySource) {
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

  function openPlatform(source: DiscoverySource) {
    setPlatformContext(source.name || "the platform");
    if (source.url) window.open(source.url, "_blank", "noopener,noreferrer");
  }

  function continueWithOwnOpportunity() {
    const raw = bringValue.trim();
    if (!raw) {
      setStatus("Paste a scholarship link, name, or the details you found first.");
      return;
    }
    const platformOnly = platformSources.some(
      (platform) => (platform.name || "").trim().toLowerCase() === raw.toLowerCase(),
    );
    if (platformOnly) {
      setPlatformContext(raw);
      setStatus(`${raw} is a search platform. Paste a particular scholarship name, listing, or link from it.`);
      return;
    }
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
  const platformSources = [...apiPlatforms, ...platformDefaults]
    .filter((source, index, sources) => sources.findIndex((candidate) => candidate.url === source.url) === index)
    .slice(0, 3);
  const savedIds = new Set((user?.savedWikiSources ?? []).map((item) => item.id));
  const presentSummary = (value?: string) => value && value !== "unknown"
    ? value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "";
  const preSearchProfileChips = [
    presentSummary(bootstrapSummary.education_level),
    presentSummary(bootstrapSummary.field_of_study),
    presentSummary(bootstrapSummary.student_type),
  ].filter(Boolean);
  const resultIntentLabels = (wiki?.selected_intents ?? user?.discoveryIntents ?? [])
    .map((intent) => intent.label)
    .filter(Boolean);

  function toggleDiscoveryIntent(intentId: string) {
    setSelectedIntentIds((current) => current.includes(intentId)
      ? current.filter((id) => id !== intentId)
      : [...current, intentId]);
  }

  const resultsVisible = showResults && hasWiki;

  return (
    <div className={resultsVisible && !loading ? "space-y-7 pb-3" : "flex min-h-[calc(100vh-190px)] items-center justify-center py-6"}>
      {!resultsVisible && !loading && (
        <section className="w-full max-w-6xl overflow-hidden rounded-[2rem] border border-white/80 bg-white/90 p-10 shadow-[0_28px_90px_-45px_rgba(38,56,95,0.5)] backdrop-blur-xl">
          <header className="flex items-start justify-between border-b border-border/70 pb-7">
            <div className="max-w-3xl">
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20"><Compass className="size-5" /></span>
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Scholarship discovery</div>
              </div>
              <h2 className="mt-5 font-display text-[42px] font-extrabold leading-[1.05] tracking-tight">Build a search around what matters to you</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Follow the three steps below. We’ll combine your verified profile, the priorities you choose, and any detail you add into one grounded search.</p>
            </div>
            <div className="flex items-center gap-3">
              {hasWiki && (
                <button onClick={() => setShowResults(true)} className="rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold text-muted-foreground hover:border-primary/30 hover:text-primary">View last results</button>
              )}
              <button onClick={onUpdateProfile} className="rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold text-muted-foreground hover:border-primary/30 hover:text-primary">Edit profile</button>
            </div>
          </header>
          {status && !loading && (
            <p role="status" aria-live="polite" className="mt-4 text-sm text-muted-foreground">{status}</p>
          )}

          <div className="mt-8 grid grid-cols-[240px_minmax(0,1fr)] gap-10">
            <aside className="rounded-2xl border border-[#dfe3f3] bg-[#f3f5fb] p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#53608d]">Your search path</div>
              <ol className="mt-5 space-y-5">
                {[
                  ["1", "Confirm context", "We use your saved profile."],
                  ["2", "Choose priorities", "Select what matters today."],
                  ["3", "Add details & search", "Optional notes make it sharper."],
                ].map(([number, title, detail], index) => (
                  <li key={number} className="flex gap-3">
                    <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${index === 0 ? "bg-success text-white" : "bg-white text-[#53608d] ring-1 ring-[#d7dced]"}`}>{index === 0 ? <Check className="size-3.5" /> : number}</span>
                    <div><div className="text-sm font-semibold">{title}</div><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</p></div>
                  </li>
                ))}
              </ol>
              <div className="mt-6 border-t border-[#dce1f0] pt-5">
                <div className="text-xs font-semibold text-foreground">Profile context</div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {preSearchProfileChips.length
                    ? preSearchProfileChips.map((value) => <Pill key={value}>{value}</Pill>)
                    : <span className="text-xs leading-5 text-muted-foreground">Add your education and field to receive stronger suggestions.</span>}
                </div>
              </div>
            </aside>

            <div className="min-w-0">
              <section aria-labelledby="discovery-priorities-heading">
                <div className="flex items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">2</span>
                  <div>
                    <h3 id="discovery-priorities-heading" className="font-display text-2xl font-bold">Choose your priorities</h3>
                    <p className="mt-1 text-sm text-muted-foreground">These suggestions come from your profile. Select any that match what you want now.</p>
                  </div>
                </div>
                {bootstrapLoading ? (
                  <div className="mt-5 grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-14 rounded-xl" />)}</div>
                ) : intentOptions.length ? (
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    {intentOptions.map((intent) => {
                      const selected = selectedIntentIds.includes(intent.id);
                      return (
                        <button key={intent.id} type="button" aria-pressed={selected} onClick={() => toggleDiscoveryIntent(intent.id)} className={`flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${selected ? "border-primary bg-primary/8 text-primary shadow-sm ring-2 ring-primary/10" : "border-border/80 bg-white text-foreground hover:border-primary/40 hover:bg-primary/[0.03]"}`}>
                          <span className={`grid size-5 shrink-0 place-items-center rounded-full border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}>{selected && <Check className="size-3" />}</span>
                          {intent.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-4 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">No profile priorities are available yet. Use the detail box below or update your profile.</p>
                )}
                {bootstrapError && <p className="mt-3 text-xs text-amber-700">{bootstrapError}</p>}
              </section>

              <section aria-labelledby="discovery-details-heading" className="mt-8 border-t border-border/70 pt-7">
                <div className="flex items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">3</span>
                  <div>
                    <h3 id="discovery-details-heading" className="font-display text-2xl font-bold">Add any detail, then search</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Optional. Mention a topic, funding need, location, or something you want excluded.</p>
                  </div>
                </div>
                <div className="mt-5 rounded-2xl border border-border/80 bg-white p-2 shadow-sm ring-primary/15 focus-within:ring-4">
                  <label htmlFor="discovery-focus" className="sr-only">Additional scholarship search details</label>
                  <textarea id="discovery-focus" rows={3} value={focus} onChange={(event) => setFocus(event.target.value)} placeholder="For example: Battery-materials research funding without a service commitment" className="w-full resize-none border-0 bg-transparent px-3 py-2 text-base leading-6 outline-none placeholder:text-muted-foreground" />
                  <div className="border-t border-border/70 px-3 pt-3">
                    <p className="text-xs text-muted-foreground">We’ll search curated sources and the live web together.</p>
                  </div>
                </div>
              </section>

              <div className="mt-6 flex items-center justify-between gap-6 rounded-2xl border border-primary/15 bg-primary/[0.035] px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">Ready to discover scholarships?</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    We’ll combine your profile, selected priorities, and the details you added above.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={refreshWiki}
                  disabled={loading || bootstrapLoading}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Find scholarships
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 border-t border-border/60 pt-5 text-center">
                {!showBring ? (
                  <button onClick={() => setShowBring(true)} className="text-sm font-medium text-muted-foreground hover:text-primary">Already found a scholarship? Bring it here instead</button>
                ) : (
                  <div className="flex gap-2 rounded-2xl border border-border/70 bg-white/75 p-3 text-left">
                    <input value={bringValue} onChange={(event) => setBringValue(event.target.value)} placeholder="Paste a scholarship link, name, or details" className="min-w-0 flex-1 rounded-xl border border-input bg-white px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-primary/15" />
                    <button onClick={continueWithOwnOpportunity} className="rounded-xl border border-primary bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">Continue to Step 3</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {loading && (
        <section className="w-full max-w-5xl space-y-5 rounded-[2rem] border border-white/80 bg-white/80 p-8 shadow-xl backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <Spinner className="size-5 text-primary" />
            <div>
              <h2 className="font-display text-2xl font-bold">Building your discovery shortlist</h2>
              <p role="status" aria-live="polite" className="mt-1 text-sm text-muted-foreground">{status}</p>
            </div>
          </div>
          <div className="space-y-3">
            {[0, 1, 2].map((item) => <Skeleton key={item} className="h-32 rounded-2xl" />)}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((item) => <Skeleton key={item} className="h-24 rounded-2xl" />)}
          </div>
        </section>
      )}

      {resultsVisible && !loading && (
        <>
          <section className="rounded-3xl border border-white/80 bg-white/80 px-7 py-5 shadow-sm backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-success">
                  <span className="grid size-6 place-items-center rounded-full bg-success/10"><Check className="size-3.5" /></span>
                  Discovery complete
                </div>
                <h2 className="mt-2 font-display text-3xl font-bold">Your scholarship shortlist</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Grounded in your student profile{resultIntentLabels.length ? ` · ${resultIntentLabels.join(" · ")}` : ""}
                </p>
                {(wiki?.free_text_intent || user?.discoveryFocus) && (
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">Also requested: {wiki?.free_text_intent || user?.discoveryFocus}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2 self-start">
                <button onClick={onUpdateProfile} className="rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent">
                  Profile used for this search
                </button>
                <button onClick={() => setShowResults(false)} className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10">
                  New search
                </button>
              </div>
            </div>
          </section>

          <section>
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Scholarships to explore</div>
                <p className="mt-1 text-sm text-muted-foreground">Discovery suggestions only—eligibility is checked in the next step.</p>
              </div>
            </div>
            <div className="space-y-3">
              {directSources.map((source) => (
                <DiscoverySourceCard
                  key={`direct-${source.url || source.name}`}
                  source={source}
                  mode="scholarship"
                  saved={savedIds.has((source.url || source.name || "").toLowerCase())}
                  onExplore={() => useSourceForExtraction(source)}
                  onSave={() => toggleSaved(source, "scholarship")}
                />
              ))}
            </div>
            {!directSources.length && (
              <div className="rounded-2xl border border-dashed border-border bg-white/70 p-5">
                <h3 className="font-semibold">We couldn’t confirm a close scholarship.</h3>
                <p className="mt-1 text-sm text-muted-foreground">We left out weaker matches. The profile-matched platforms below are the best places to continue.</p>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-[#d9def3] bg-[#eef1fb]/90 p-6 shadow-sm">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4a5685]">Continue searching elsewhere</div>
              <h3 className="mt-2 font-display text-2xl font-bold">Places selected for your profile</h3>
              <p className="mt-1 text-sm text-muted-foreground">Open a platform, find a scholarship, then paste it into the return bar below.</p>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {platformSources.map((source) => (
                <button key={`platform-${source.url || source.name}`} onClick={() => openPlatform(source)} className="group min-h-32 rounded-2xl border border-white/90 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid size-9 place-items-center rounded-xl bg-[#eef1fb] font-display text-sm font-bold text-[#4a5685]">{source.name?.charAt(0) || "P"}</div>
                    <ArrowRight className="size-4 -rotate-45 text-muted-foreground transition group-hover:text-primary" />
                  </div>
                  <div className="mt-3 font-display text-lg font-bold leading-tight">{source.name}</div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{source.why_recommended}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="sticky bottom-4 z-20 rounded-2xl border border-primary/20 bg-white/95 p-3 shadow-[0_18px_45px_-18px_rgba(38,56,95,0.45)] backdrop-blur-xl">
            {platformContext && <p className="mb-2 px-1 text-xs font-medium text-primary">Found something on {platformContext}?</p>}
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                {!platformContext && <div className="px-1 text-xs font-semibold text-foreground">Found a scholarship here or somewhere else?</div>}
                <label htmlFor="bring-opportunity" className="sr-only">Scholarship link, name, or details</label>
                <input id="bring-opportunity" value={bringValue} onChange={(event) => setBringValue(event.target.value)} placeholder="Paste a link, scholarship name, or listing details" className="mt-1 w-full rounded-xl border border-input bg-white px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-primary/15" />
              </div>
              <button onClick={continueWithOwnOpportunity} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90">
                Continue to Step 3 <ArrowRight className="size-4" />
              </button>
            </div>
          </section>
        </>
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
              {source.why_recommended && <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{source.why_recommended}</p>}
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
      <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/[0.07] via-primary/[0.035] to-transparent p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="size-4.5" />
          </span>
          <div>
            <h5 className="font-display text-base font-bold">Worth a closer look?</h5>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Select this opportunity to collect its official requirements and evaluate how well it aligns with your profile.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onExplore}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          Select &amp; continue to Step 3 <ArrowRight className="size-4" />
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
  const markerClass = complete
    ? "border-primary bg-primary text-primary-foreground"
    : active
      ? "border-primary bg-background text-primary"
      : "border-border bg-background text-muted-foreground";

  return (
    <section
      className={`group relative grid gap-4 transition-opacity duration-300 motion-reduce:transition-none md:grid-cols-[76px_1fr] ${locked ? "opacity-55" : "opacity-100"}`}
      aria-disabled={locked || undefined}
      aria-labelledby={headingId}
      aria-describedby={locked && lockedMessage ? `${headingId ?? `workflow-step-${number}`}-locked-message` : undefined}
      tabIndex={locked ? 0 : undefined}
    >
      <div className="relative hidden md:flex justify-center">
        <div className={`relative z-10 grid size-12 place-items-center rounded-full border-2 text-sm font-semibold ${markerClass}`}>
          {complete ? <Check className="size-5" strokeWidth={3} /> : number}
        </div>
        {!isLast && <div className="absolute left-1/2 top-12 h-[calc(100%+2rem)] -translate-x-1/2 border-l-2 border-dashed border-border" />}
      </div>
      <div className="min-w-0">
        <div className="relative pb-4">
          <div className="pointer-events-none absolute right-0 top-[-18px] hidden select-none font-display text-8xl font-bold leading-none text-primary/5 md:block">
            {String(number).padStart(2, "0")}
          </div>
          <div className="flex items-center gap-3 md:hidden">
            <div className={`grid size-10 place-items-center rounded-full border-2 text-sm font-semibold ${markerClass}`}>
              {complete ? <Check className="size-4" strokeWidth={3} /> : number}
            </div>
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Step {number}</div>
          </div>
          <div className="hidden text-sm font-semibold uppercase tracking-widest text-muted-foreground md:block">Step {number}</div>
          <h3 id={headingId} tabIndex={headingId && !locked ? -1 : undefined} className="mt-1 scroll-mt-20 font-display text-2xl font-bold leading-tight text-foreground">{title}</h3>
          {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>}
          {locked && lockedMessage && (
            <p id={`${headingId ?? `workflow-step-${number}`}-locked-message`} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Lock className="size-3.5" aria-hidden="true" />
              {lockedMessage}
            </p>
          )}
        </div>
        <div className={`overflow-hidden rounded-2xl border border-border/70 bg-white shadow-sm transition-colors duration-300 motion-reduce:transition-none ${locked ? "bg-muted/35 grayscale-[0.2]" : ""}`}>
          <div className={`h-1 ${active ? "bg-primary" : complete ? "bg-success" : "bg-border"}`} />
          <div inert={locked ? true : undefined} className={locked ? "pointer-events-none select-none p-5 md:p-6" : "p-5 md:p-6"}>{children}</div>
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
      title="Confirm the opportunity you want to explore"
      description="We carried over what you selected or entered during discovery. Add or correct anything you know, then Scholar-E will collect the available requirements into editable fields."
      complete={complete}
      active={active}
    >
      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        <Input
          label="Scholarship name"
          value={scholarship.name ?? ""}
          onChange={(name) => updateScholarship({ name })}
          placeholder="Coca-Cola Scholars Program, Gates Scholarship..."
          className="sm:col-span-2"
        />
        <Input
          label="Scholarship URL"
          value={scholarship.url ?? ""}
          onChange={(url) => updateScholarship({ url })}
          placeholder="https://... or source name"
          className="sm:col-span-2"
        />
      </div>
      <Textarea
        label="Additional Notes (Optional)"
        value={scholarship.additionalNotes ?? ""}
        onChange={(additionalNotes) => updateScholarship({ additionalNotes })}
        placeholder="Paste copied scholarship text, eligibility details, award amount, deadlines, essay prompts, or anything else that may help Scholar-E extract requirements."
        rows={3}
      />
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onExtract}
          disabled={extracting}
          aria-busy={extracting}
          className={`inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-90 ${extracting ? "agent-loading" : ""}`}
        >
          {extracting && <Spinner className="size-4" />}
          {extracting ? "Extracting requirements…" : "Extract Requirements"}
        </button>
      </div>
      {extractionStatus && <p className="mt-3 text-xs text-muted-foreground text-right">{extractionStatus}</p>}
      {extractionError && <p className="mt-3 text-xs text-destructive text-right">{extractionError}</p>}
    </WorkflowStep>
  );
}

const REVIEW_MISSING_TEXT = "Not found — add manually";

function isReviewFieldMissing(value?: string) {
  const text = String(value ?? "").trim();
  return !text || /^(not found|n\/a|none|unknown|unclear)$/i.test(text);
}

function reviewFieldTone(value?: string) {
  return isReviewFieldMissing(value) ? "warning" : "success";
}

function ReviewSection({
  title,
  icon,
  children,
  defaultExpanded = true,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <section className="rounded-2xl border border-border/55 bg-white/95 p-4 shadow-sm transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-3 border-b border-border/30 pb-2 text-left"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold uppercase tracking-widest text-foreground">
          {icon && <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/5 text-primary">{icon}</span>}
          <span>{title}</span>
        </span>
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {expanded && <div className="pt-3">{children}</div>}
    </section>
  );
}

function ReviewField({
  label,
  value,
  onChange,
  placeholder,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const tone = reviewFieldTone(value);
  const [editing, setEditing] = useState(false);
  const displayValue = tone === "warning" ? "Not found" : value;

  if (!editing) {
    return (
      <div className={`min-w-0 ${className}`}>
        <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {tone === "warning" && <AlertCircle className="size-3 text-warning/70" aria-hidden="true" />}
          {label}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`group flex min-h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
            tone === "success" ? "text-foreground hover:bg-muted/35" : "bg-warning/[0.035] text-muted-foreground hover:bg-warning/[0.06]"
          }`}
        >
          <span className={`min-w-0 truncate ${tone === "success" ? "text-[15px] font-medium" : "text-sm"}`}>{displayValue}</span>
          {tone === "warning" ? (
            <span className="shrink-0 rounded-full border border-primary/10 bg-white px-2 py-0.5 text-[10px] font-semibold text-primary shadow-sm transition-colors group-hover:bg-primary/5">
              Add manually
            </span>
          ) : (
            <PencilLine className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60" aria-hidden="true" />
          )}
        </button>
      </div>
    );
  }

  return (
    <label className={`block ${className}`}>
      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <span className={`size-1.5 rounded-full ${tone === "success" ? "bg-success" : "bg-warning/70"}`} />
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder ?? (tone === "warning" ? REVIEW_MISSING_TEXT : undefined)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
        }}
        autoFocus
        className={`h-8 w-full rounded-lg border px-2.5 text-sm transition-colors ${
          tone === "success" ? "border-border/80 bg-white" : "border-warning/15 bg-warning/[0.025] placeholder:text-muted-foreground/40"
        }`}
      />
    </label>
  );
}

function ReviewTextArea({
  label,
  value,
  onChange,
  rows = 3,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  className?: string;
}) {
  const tone = reviewFieldTone(value);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const shouldClamp = value.length > 160 || value.split("\n").length > 3;
  const displayValue = tone === "warning" ? "Not found" : value;

  if (!editing) {
    return (
      <div className={`min-w-0 ${className}`}>
        <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {tone === "warning" && <AlertCircle className="size-3 text-warning/70" aria-hidden="true" />}
          {label}
        </div>
        <div className={`rounded-lg px-2 py-1.5 transition-colors ${tone === "success" ? "text-foreground hover:bg-muted/30" : "bg-warning/[0.035] text-muted-foreground"}`}>
          <button type="button" onClick={() => setEditing(true)} className="block w-full text-left">
            <span className={`whitespace-pre-wrap text-sm leading-snug ${tone === "success" && shouldClamp && !expanded ? "line-clamp-3" : ""}`}>
              {displayValue}
            </span>
          </button>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {tone === "warning" ? (
              <>
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-muted-foreground shadow-sm">
                  <AlertCircle className="size-3 text-warning/70" aria-hidden="true" />
                  Not found
                </span>
                <button type="button" onClick={() => setEditing(true)} className="text-xs font-medium text-primary hover:underline">
                  Add manually
                </button>
              </>
            ) : (
              <>
                {shouldClamp && (
                  <button type="button" onClick={() => setExpanded((current) => !current)} className="text-xs font-medium text-primary hover:underline">
                    {expanded ? "Show less" : "Show more"}
                  </button>
                )}
                <button type="button" onClick={() => setEditing(true)} className="text-xs font-medium text-muted-foreground hover:text-primary">
                  Edit
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <label className={`block ${className}`}>
      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <span className={`size-1.5 rounded-full ${tone === "success" ? "bg-success" : "bg-warning/70"}`} />
        {label}
      </span>
      <textarea
        value={value}
        rows={rows}
        placeholder={tone === "warning" ? REVIEW_MISSING_TEXT : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setEditing(false)}
        autoFocus
        className={`w-full rounded-lg border px-2.5 py-1.5 text-sm leading-snug transition-colors ${
          tone === "success" ? "border-border/80 bg-white" : "border-warning/15 bg-warning/[0.025] placeholder:text-muted-foreground/40"
        }`}
      />
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
  const parseList = (value: string) => value.split("\n").filter((item) => item.length > 0);
  const extractedValues = [
    scholarship.name,
    scholarship.organization,
    scholarship.type,
    scholarship.country,
    scholarship.officialWebsite ?? scholarship.url,
    scholarship.awardAmount,
    scholarship.applicationOpens,
    scholarship.applicationDeadline,
    scholarship.notificationDate,
    scholarship.programStart,
    scholarship.programEnd,
    scholarship.currentStatus,
    scholarship.description,
    scholarship.minimumGpa,
    scholarship.enrollmentLevel,
    scholarship.citizenshipRequirement,
    scholarship.financialNeedRequirement,
    scholarship.locationRequirement,
    scholarship.eligibleMajors,
    scholarship.otherEligibilityRules,
    docsValue,
    scholarship.otherRequiredMaterials,
    scholarship.essayPrompts,
    listValue(scholarship.eligibilityRequirements),
    listValue(scholarship.requiredApplicationMaterials),
    listValue(scholarship.benefits),
    listValue(scholarship.selectionCriteria),
    listValue(scholarship.applicationProcess),
  ];
  const extractedCount = extractedValues.filter((value) => !isReviewFieldMissing(value)).length;
  const needsReviewCount = extractedValues.length - extractedCount;
  const sourceUrl = scholarship.officialWebsite || scholarship.url;
  const sourceDomain = (() => {
    if (!sourceUrl) return "";
    try {
      return new URL(sourceUrl.startsWith("http") ? sourceUrl : `https://${sourceUrl}`).hostname.replace(/^www\./, "");
    } catch {
      return sourceUrl;
    }
  })();

  if (!hasExtractedDetails) {
    return (
      <WorkflowStep
        number={2}
        title="Extracted requirements"
        description="Review and edit anything the extractor found before analyzing fit."
        complete={complete}
        active={active}
        locked={locked}
        lockedMessage="Extract the scholarship requirements to unlock this step."
        headingId="extracted-requirements-heading"
      >
        <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">No requirements extracted yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Run Extract Requirements to review the editable fields Scholar-E finds.</p>
          </div>
          <button type="button" disabled className="w-fit rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground opacity-60">
            Edit
          </button>
        </div>
      </WorkflowStep>
    );
  }

  return (
    <WorkflowStep
      number={2}
      title="Extracted requirements"
      description="Review and edit anything the extractor found before analyzing fit."
      complete={complete}
      active={active}
      locked={locked}
      lockedMessage="Extract the scholarship requirements to unlock this step."
      headingId="extracted-requirements-heading"
    >
      <div className="mt-1 rounded-2xl border border-border/50 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="size-2.5 rounded-full bg-success" />
              Extraction Complete
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{extractedCount} of {extractedValues.length} fields extracted successfully.</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{needsReviewCount} fields require review or manual entry.</p>
            {typeof scholarship.completenessScore === "number" && (
              <p className="mt-0.5 text-xs font-medium text-foreground">
                Important-field completeness: {scholarship.completenessScore}%
              </p>
            )}
          </div>
          {sourceUrl && (
            <a
              href={sourceUrl.startsWith("http") ? sourceUrl : `https://${sourceUrl}`}
              target="_blank"
              rel="noreferrer"
              className="max-w-full truncate rounded-full bg-muted/45 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Source: {sourceDomain}
            </a>
          )}
        </div>
        {!!scholarship.criticalFieldsMissing?.length && (
          <div className="mt-3 rounded-xl border border-warning/20 bg-warning/[0.035] px-3 py-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Important fields still missing:</span>{" "}
            {scholarship.criticalFieldsMissing.join(", ")}.
          </div>
        )}
        {!![...(scholarship.extractionWarnings ?? []), ...(scholarship.validationWarnings ?? [])].length && (
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            {[...(scholarship.extractionWarnings ?? []), ...(scholarship.validationWarnings ?? [])]
              .slice(0, 4)
              .map((warning) => <p key={warning}>• {warning}</p>)}
          </div>
        )}
      </div>

      <div className="mt-5 space-y-5">
        <ReviewSection title="Overview" icon={<ClipboardList className="size-3.5" aria-hidden="true" />}>
          <div className="grid gap-x-2.5 gap-y-2 md:grid-cols-3">
            <ReviewField label="Scholarship name" value={scholarship.name ?? ""} onChange={(name) => updateScholarship({ name })} />
            <ReviewField label="Sponsoring organization" value={scholarship.organization ?? ""} onChange={(organization) => updateScholarship({ organization })} />
            <ReviewField label="Scholarship type" value={scholarship.type ?? ""} onChange={(type) => updateScholarship({ type })} />
            <ReviewField label="Country / region" value={scholarship.country ?? ""} onChange={(country) => updateScholarship({ country })} />
            <ReviewField label="Award amount" value={scholarship.awardAmount ?? ""} onChange={(awardAmount) => updateScholarship({ awardAmount })} />
            <ReviewField label="Official website" value={scholarship.officialWebsite ?? scholarship.url ?? ""} onChange={(officialWebsite) => updateScholarship({ officialWebsite, url: officialWebsite })} />
            <ReviewTextArea label="Scholarship description" value={scholarship.description ?? ""} onChange={(description) => updateScholarship({ description })} rows={2} className="md:col-span-3" />
          </div>
        </ReviewSection>

        <ReviewSection title="Timeline" icon={<CalendarDays className="size-3.5" aria-hidden="true" />} defaultExpanded={false}>
          <div className="grid gap-x-2.5 gap-y-2 md:grid-cols-3">
            <ReviewField label="Application opens" value={scholarship.applicationOpens ?? ""} onChange={(applicationOpens) => updateScholarship({ applicationOpens })} />
            <ReviewField label="Application deadline" value={scholarship.applicationDeadline ?? ""} onChange={(applicationDeadline) => updateScholarship({ applicationDeadline })} />
            <ReviewField label="Notification date" value={scholarship.notificationDate ?? ""} onChange={(notificationDate) => updateScholarship({ notificationDate })} />
            <ReviewField label="Program start" value={scholarship.programStart ?? ""} onChange={(programStart) => updateScholarship({ programStart })} />
            <ReviewField label="Program end" value={scholarship.programEnd ?? ""} onChange={(programEnd) => updateScholarship({ programEnd })} />
            <ReviewField label="Current status" value={scholarship.currentStatus ?? ""} onChange={(currentStatus) => updateScholarship({ currentStatus })} />
          </div>
        </ReviewSection>

        <ReviewSection title="Eligibility" icon={<ShieldCheck className="size-3.5" aria-hidden="true" />} defaultExpanded={false}>
          <div className="grid gap-x-2.5 gap-y-2 md:grid-cols-3">
            <ReviewField label="Minimum GPA" value={scholarship.minimumGpa ?? ""} onChange={(minimumGpa) => updateScholarship({ minimumGpa })} />
            <ReviewField label="Enrollment level" value={scholarship.enrollmentLevel ?? ""} onChange={(enrollmentLevel) => updateScholarship({ enrollmentLevel })} />
            <ReviewField label="Citizenship / residency requirement" value={scholarship.citizenshipRequirement ?? ""} onChange={(citizenshipRequirement) => updateScholarship({ citizenshipRequirement })} />
            <ReviewField label="Financial need requirement" value={scholarship.financialNeedRequirement ?? ""} onChange={(financialNeedRequirement) => updateScholarship({ financialNeedRequirement })} />
            <ReviewField label="Location / residency requirement" value={scholarship.locationRequirement ?? ""} onChange={(locationRequirement) => updateScholarship({ locationRequirement })} />
            <ReviewField label="Eligible majors / fields" value={scholarship.eligibleMajors ?? ""} onChange={(eligibleMajors) => updateScholarship({ eligibleMajors })} />
            <ReviewTextArea label="Other eligibility rules" value={scholarship.otherEligibilityRules ?? ""} onChange={(otherEligibilityRules) => updateScholarship({ otherEligibilityRules })} rows={2} className="md:col-span-3" />
            <ReviewTextArea label="Eligibility requirements" value={listValue(scholarship.eligibilityRequirements)} onChange={(value) => updateScholarship({ eligibilityRequirements: parseList(value) })} rows={3} className="md:col-span-3" />
          </div>
        </ReviewSection>

        <ReviewSection title="Materials & prompts" icon={<FileUp className="size-3.5" aria-hidden="true" />} defaultExpanded={false}>
          <div className="grid gap-x-2.5 gap-y-2 md:grid-cols-3">
            <ReviewField
              label="Required document types"
              value={docsValue}
              onChange={(value) =>
                updateScholarship({
                  requiredDocumentTypes: value
                    .split(",")
                    .map((item) => item.replace(/^\s+/, ""))
                    .filter(Boolean),
                })
              }
              placeholder="Essay, transcript, recommendation letter..."
            />
            <ReviewTextArea label="Other required materials" value={scholarship.otherRequiredMaterials ?? ""} onChange={(otherRequiredMaterials) => updateScholarship({ otherRequiredMaterials })} rows={2} className="md:col-span-2" />
            <ReviewTextArea label="Essay prompts" value={scholarship.essayPrompts ?? ""} onChange={(essayPrompts) => updateScholarship({ essayPrompts })} rows={3} className="md:col-span-3" />
            <ReviewTextArea label="Required application materials" value={listValue(scholarship.requiredApplicationMaterials)} onChange={(value) => updateScholarship({ requiredApplicationMaterials: parseList(value) })} rows={3} className="md:col-span-3" />
          </div>
        </ReviewSection>

        <ReviewSection title="Additional details" icon={<ReceiptText className="size-3.5" aria-hidden="true" />} defaultExpanded={false}>
          <div className="grid gap-x-2.5 gap-y-2 md:grid-cols-3">
            <ReviewTextArea label="Benefits" value={listValue(scholarship.benefits)} onChange={(value) => updateScholarship({ benefits: parseList(value) })} rows={3} />
            <ReviewTextArea label="Selection criteria" value={listValue(scholarship.selectionCriteria)} onChange={(value) => updateScholarship({ selectionCriteria: parseList(value) })} rows={3} className="md:col-span-2" />
            <ReviewTextArea label="Application process" value={listValue(scholarship.applicationProcess)} onChange={(value) => updateScholarship({ applicationProcess: parseList(value) })} rows={3} className="md:col-span-3" />
          </div>
        </ReviewSection>
      </div>

      <div className="mt-7 flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={onAnalyze}
          disabled={analyzing}
          aria-busy={analyzing}
          className={`inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-90 ${analyzing ? "agent-loading" : ""}`}
        >
          {analyzing && <Spinner className="size-4" />}
          {analyzing ? "Analyzing fit…" : "Accept and Analyze Fit"}
        </button>
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
        title="Profile fit analysis"
        description={
          fitAnalysis
            ? "This score answers whether your current profile fits this scholarship."
            : "Extract and review scholarship requirements, then use Accept and Analyze Fit."
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
            <section>
              <div className="font-medium">No analysis yet</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Extract and review scholarship requirements, then use Accept and Analyze Fit.
                Scholar-E will compare your profile to this scholarship’s hard requirements and
                stated priorities. Document readiness is not part of this score.
              </p>
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
  const draft = user?.essayDraft ?? "";
  const essayTitle = user?.essayTitle ?? "";
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).filter(Boolean).length : 0;
  const characterCount = draft.length;
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
  const [panelResizing, setPanelResizing] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [sessionPhase, setSessionPhase] = useState("");
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

  const rawPromptBlob =
    user?.activeScholarship?.essayPrompts
    || user?.activeScholarship?.otherRequiredMaterials
    || user?.activeScholarship?.requirementsPreview
    || "";
  const availablePrompts = useMemo(() => splitEssayPrompts(rawPromptBlob), [rawPromptBlob]);
  const [selectedPromptIndex, setSelectedPromptIndex] = useState(0);
  const essayPrompt =
    availablePrompts[Math.min(selectedPromptIndex, Math.max(0, availablePrompts.length - 1))] || rawPromptBlob;
  const hasMultiplePrompts = availablePrompts.length > 1;
  const hasOutline = !!user?.personalizedOutline?.outline?.sections?.length;

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

  function updateEssayPrompt(value: string) {
    if (!user) return;
    updateProfile({
      activeScholarship: { ...(user.activeScholarship ?? {}), essayPrompts: value },
      personalizedOutline: undefined,
    });
    setSelectedPromptIndex(0);
    setPendingPromptIndex(0);
    setPromptConfirmed(false);
    setPromptPickerOpen(true);
    setOutlineStatus(null);
  }

  function selectEssayPrompt(index: number) {
    if (index === selectedPromptIndex && promptConfirmed) return;
    setSelectedPromptIndex(index);
    setPendingPromptIndex(index);
    setPromptConfirmed(false);
    updateProfile({ personalizedOutline: undefined });
    setOutlineStatus("Prompt changed — confirm the new prompt to build its outline.");
    setActiveTab("outline");
    setPanelOpen(true);
    setPromptPickerOpen(true);
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
    // Resume silently only when the stored outline was generated for this exact focus.
    if (user.personalizedOutline?.generatedForKey === outlineKey) {
      setPromptConfirmed(true);
      setPromptPickerOpen(false);
      return;
    }
    setPendingPromptIndex(Math.min(selectedPromptIndex, Math.max(0, availablePrompts.length - 1)));
    setPromptPickerOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, rawPromptBlob, outlineKey]);

  async function runOutlineGeneration(promptOverride?: string) {
    if (!user || outlineLoading) return;
    const promptForOutline = (promptOverride ?? essayPrompt).trim();
    // Empty prompt is allowed: backend adapts to scholarship-guided mode.
    setOutlineLoading(true);
    setOutlineStatus(
      promptForOutline
        ? "Building an outline adapted to your selected essay prompt…"
        : "Building a scholarship-guided outline (no formal prompt)…",
    );
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

  async function confirmEssayPrompt(index?: number, options?: { allowEmpty?: boolean }) {
    const nextIndex = typeof index === "number" ? index : pendingPromptIndex;
    const nextPrompt = (availablePrompts[nextIndex] || rawPromptBlob).trim();
    if (!nextPrompt && !options?.allowEmpty) {
      setOutlineStatus("Add an essay prompt, or continue without a formal prompt.");
      return;
    }
    setSelectedPromptIndex(nextIndex);
    setPendingPromptIndex(nextIndex);
    setPromptConfirmed(true);
    setPromptPickerOpen(false);
    setPanelOpen(true);
    setActiveTab("outline");
    setOutlineStatus(
      nextPrompt
        ? "Prompt confirmed — generating an outline adapted to this prompt…"
        : "No formal prompt — generating a scholarship-guided outline…",
    );
    await runOutlineGeneration(nextPrompt);
  }

  async function continueWithoutFormalPrompt() {
    // Clear any stale pasted materials masquerading as a prompt so agents use
    // scholarship-guided adaptation instead.
    if (!user) return;
    if (rawPromptBlob.trim()) {
      updateProfile({
        activeScholarship: { ...(user.activeScholarship ?? {}), essayPrompts: "" },
        personalizedOutline: undefined,
      });
    }
    setSelectedPromptIndex(0);
    setPendingPromptIndex(0);
    await confirmEssayPrompt(0, { allowEmpty: true });
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
    updateProfile({ essayDraft: text });
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
    setSessionPhase("Cleaning spelling…");
    setMechanicsNote(null);
    setAnalysisStatus(null);
    setPanelOpen(true);

    try {
      setSessionPhase("Running seven criterion reviews…");
      setSessionProgress(28);

      // One backend request owns mechanics and one Manager-led review graph.
      // Seven criterion agents evaluate, simulate the reviewer, score, and
      // propose one aligned action in parallel.
      const session = await runWorkspaceCoachingSession(buildCoachingSessionPayload(user, essayPrompt));
      const workingDraft = session.cleaned_draft || draft;
      const appliedCount = session.mechanics?.applied_count ?? 0;

      if (workingDraft !== draft) updateProfile({ essayDraft: workingDraft });
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

      setSessionPhase(review?.status === "partial" ? "Partial essay review ready…" : "Essay review ready…");
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
      setSessionPhase("");
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
    const res = await runSelectionRewrite(buildRewritePayload(user, action, text, surrounding));
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
      updateProfile({ essayDraft: normalizePdfDraftText(pages) });
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
    if (last && last.content === content) {
      const merged = [...prev];
      merged[merged.length - 1] = { ...last, ...patch, wordCount: contentWordCount, savedAt: new Date().toISOString() };
      updateProfile({ drafts: merged });
    } else {
      const newVersion: EssayDraft = {
        id: crypto.randomUUID(),
        version: (last?.version ?? 0) + 1,
        content,
        wordCount: contentWordCount,
        savedAt: new Date().toISOString(),
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
    updateProfile({ essayDraft: exampleEssayDraft });
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
    <div className="w-full border-t border-border bg-background">
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

            <button
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
                value={rawPromptBlob}
                onChange={(event) => updateEssayPrompt(event.target.value)}
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
              disabled={!(availablePrompts[pendingPromptIndex] || rawPromptBlob).trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Sparkles className="size-4" />
              Use this prompt & build outline
            </button>
            <button
              type="button"
              onClick={() => void continueWithoutFormalPrompt()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
            >
              Continue without a formal prompt
            </button>
            <p className="text-center text-[12px] text-muted-foreground">
              Without a prompt, outline and coaching adapt to the scholarship mission and selection criteria.
            </p>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="border-b border-border bg-card">
        <div className="mx-auto max-w-[1440px] space-y-3 px-4 py-3 md:px-6">
          {hasMultiplePrompts && promptConfirmed && (
            <div className="rounded-xl border border-info/20 bg-info/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-info">Working on prompt {selectedPromptIndex + 1}</div>
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
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground line-clamp-2">{essayPrompt}</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <label htmlFor="workspace-essay-prompt" className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {hasMultiplePrompts ? "Selected prompt" : "Essay prompt"}
            </label>
            <input
              id="workspace-essay-prompt"
              type="text"
              value={hasMultiplePrompts ? essayPrompt : rawPromptBlob}
              onChange={(event) => updateEssayPrompt(event.target.value)}
              readOnly={hasMultiplePrompts}
              placeholder="Paste or enter the scholarship essay prompt here."
              className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-info focus:ring-2 focus:ring-info/10 read-only:bg-muted/30"
            />
            <button
              type="button"
              onClick={() => void runOutlineGeneration()}
              disabled={outlineLoading || !promptConfirmed}
              aria-busy={outlineLoading}
              className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${outlineLoading ? "agent-loading" : ""}`}
            >
              {outlineLoading ? <Spinner className="size-4" /> : hasOutline ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
              {outlineLoading ? "Generating Outline…" : hasOutline ? "Regenerate Outline" : "Generate Outline"}
            </button>
          </div>
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
              Scholarship-guided mode: outline and coaching adapt to mission/criteria. Add a prompt anytime to regenerate.
            </p>
          )}
          {outlineStatus && <p className="text-xs text-muted-foreground">{outlineStatus}</p>}
        </div>
      </section>

      {/* Zone 2 (editor) + Zone 3 (sidebar) */}
      <div className="mx-auto flex max-w-[1440px] flex-col items-stretch lg:flex-row lg:items-start">
        <div className="flex min-h-[60vh] min-w-0 flex-1 flex-col lg:h-[calc(100vh-120px)] lg:min-h-0">
          <div className={`mx-auto flex min-h-0 w-full flex-1 flex-col transition-[max-width] duration-300 ${panelOpen ? "max-w-[760px]" : "max-w-[960px]"}`}>
            <EssayEditor
              ref={editorApiRef}
              value={draft}
              onChange={(v) => updateProfile({ essayDraft: v })}
              richValue={user?.essayDraftHtml}
              onRichChange={(v) => updateProfile({ essayDraftHtml: v })}
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
              sessionPhase={sessionPhase}
              sessionProgress={sessionProgress}
              reviewReady={reviewReady}
              sessionRunning={isEvaluating}
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
  );
}

function EssayWorkspacePanel({
  activeTab,
  onTabChange,
  isEvaluating,
  onCollapse,
  essayPrompt,
  promptConfirmed,
  sessionPhase,
  sessionProgress,
  reviewReady,
  sessionRunning,
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
  sessionPhase: string;
  sessionProgress: number;
  reviewReady: boolean;
  sessionRunning: boolean;
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
  const { user, updateProfile } = useUser();
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineStatus, setOutlineStatus] = useState<string | null>(null);
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

  async function runOutlineGeneration(force = false) {
    if (!user || outlineLoading || !essayPrompt.trim()) return;
    if (!force && user.personalizedOutline?.generatedForKey === outlineKey) return;
    setOutlineLoading(true);
    setOutlineStatus("Building your personalized outline from the selected prompt and your profile...");
    try {
      const result = await generatePersonalizedOutline(buildOutlinePayload(user, essayPrompt));
      updateProfile({ personalizedOutline: { ...result, generatedForKey: outlineKey } });
      setOutlineStatus(result.status === "error" ? "A fallback outline is ready." : "Personalized outline ready.");
    } catch (error) {
      setOutlineStatus(error instanceof Error ? error.message : "Could not generate the outline.");
    } finally {
      setOutlineLoading(false);
    }
  }

  // Outline is generated from the confirmed prompt via the landing popup confirm
  // action or the explicit Generate Outline button — not auto-raced on mount.

  const tabs: Array<{ id: WorkspaceTab; label: string; icon: typeof ListChecks; count?: number }> = [
    { id: "outline", label: "Outline", icon: ListChecks },
    { id: "coach", label: "Essay Review", icon: Wand2 },
    { id: "highlights", label: "Fixes", icon: Sparkles, count: suggestions.length },
  ];

  return (
    <aside
      aria-busy={sessionRunning}
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
      <div key={activeTab} className="min-h-0 flex-1 animate-in fade-in slide-in-from-bottom-1 overflow-y-auto p-4 duration-200">
        {activeTab === "outline" && (
          <PersonalizedOutlinePanel
            outline={user?.personalizedOutline}
            scholarshipName={user?.activeScholarship?.name}
            wordLimit={buildOutlinePayload(user, essayPrompt).word_limit}
            loading={outlineLoading}
            status={outlineStatus}
            onRegenerate={() => void runOutlineGeneration(true)}
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
      {sessionRunning && (
        <div className="sticky bottom-0 z-20 border-t border-border bg-card/95 px-4 py-2.5 backdrop-blur">
          <div className="flex items-center justify-between gap-3 text-[12px] font-medium text-muted-foreground">
            <span className="min-w-0 leading-snug">
              {sessionPhase
                || (reviewReady ? "Essay review ready…" : "Running essay review…")}
            </span>
            <span className="shrink-0 tabular-nums text-foreground">{sessionProgress}%</span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-label="Coaching session progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={sessionProgress}
          >
            <div
              className="h-full rounded-full bg-info transition-[width] duration-500 ease-out"
              style={{ width: `${sessionProgress}%` }}
            />
          </div>
        </div>
      )}
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
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(["core"]));
  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const data = outline?.outline;

  useEffect(() => {
    if (!loading && data) {
      setOpenGroups(new Set(["core"]));
    }
  }, [loading, Boolean(data), outline?.generatedForKey]);

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
                aria-busy={loading}
                className={`grid size-9 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-90 ${loading ? "agent-loading text-info" : ""}`}
                aria-label="Regenerate outline"
              >
                {loading ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
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
          const points = buildOutlinePoints(outline);
          const corePoints: Pt[] = points.filter((p) => p.group === "core");
          const strategyPoints: Pt[] = points.filter((p) => p.group === "strategy");
          const structurePoints: Pt[] = points.filter((p) => p.group === "structure");
          const keyPoints: Pt[] = points.filter((p) => p.group === "keypoints");
          const sections = data.sections ?? [];
          const total = points.length;
          const coveredCount = points.filter((p) => covered.has(p.id)).length;
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
                <div className="mt-1.5 text-[11px] text-muted-foreground">AI-detected from your draft — tap any point to adjust.</div>
              </div>

              <OutlineGroup id="core" title="Core Message" icon={Target} total={corePoints.length} coveredCount={cc(corePoints)} open={openGroups.has("core")} onToggle={toggleGroup}>
                {corePoints.map((p) => (
                  <OutlineCheckRow key={p.id} id={p.id} label={p.label} detail={p.detail} covered={covered} onToggle={onToggleCovered} />
                ))}
              </OutlineGroup>

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

              {!!strategyPoints.length && (
                <OutlineGroup id="strategy" title="Strategy Notes" icon={Lightbulb} total={strategyPoints.length} coveredCount={cc(strategyPoints)} open={openGroups.has("strategy")} onToggle={toggleGroup}>
                  {strategyPoints.map((p) => (
                    <OutlineCheckRow key={p.id} id={p.id} label={p.label} covered={covered} onToggle={onToggleCovered} />
                  ))}
                </OutlineGroup>
              )}

              {(data.recommended_opening || data.recommended_conclusion) && (
                <div className="rounded-xl border border-border bg-background p-3">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Opening &amp; Closing Tips</div>
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
        <PanelLabel>Essay Review</PanelLabel>
        <div className="mt-1 text-[12px] text-muted-foreground">Last updated: {relativeTimeLabel(updatedAt, now)}</div>
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
      <div className="space-y-3">
        <PanelLabel>Essay Review</PanelLabel>
        <CoachSkeleton />
      </div>
    );
  }
  if (!review || review.schema_version !== 3) {
    return (
      <PanelEmpty
        label="Essay Review"
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
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <PanelLabel>Sentence Fixes</PanelLabel>
          <div className="mt-1 text-[12px] font-semibold text-muted-foreground">{suggestions.length} open</div>
        </div>
      </div>

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

function StepFinalCheck() {
  const { user } = useUser();
  const review = user?.essayReviewResult?.schema_version === 3 ? user.essayReviewResult : null;
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
    { item: "Essay review completed", done: !!review },
  ];
  const blockers = [
    ...essayReviewPriorityActions(review).slice(0, 3),
    ...checklist.filter((c) => !c.done).map((c) => c.item),
  ].filter((item, i, arr) => arr.indexOf(item) === i);
  const done = checklist.filter((x) => x.done).length;
  const lowDims = lowEssayReviewCriteria(review);

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
          <div className="h-full bg-success" style={{ width: `${(done / checklist.length) * 100}%` }} />
        </div>
      </Card>

      <Card>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Final checklist</div>
        <ul className="mt-3 divide-y divide-border">
          {checklist.map((c) => (
            <li key={c.item} className="py-3 flex items-center gap-3">
              <div className={`size-5 rounded-md grid place-items-center ${c.done ? "bg-success text-white" : "border-2 border-warning"}`}>
                {c.done && <Check className="size-3.5" strokeWidth={3} />}
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

/* ---------------- Step 7: Tracker ---------------- */

function StepTracker() {
  const columns = ["Interested", "Drafting", "Submitted", "Awarded"] as const;
  const { user } = useUser();
  const scholarship = user?.activeScholarship;
  const review = user?.essayReviewResult?.schema_version === 3 ? user.essayReviewResult : null;
  const score = typeof review?.overall_score === "number" ? review.overall_score : 0;
  const activeColumn = review ? "Drafting" : scholarship?.name ? "Interested" : "Interested";

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-3 gap-4">
        <Card><div className="text-xs text-muted-foreground uppercase tracking-widest">Active</div><div className="font-display text-3xl mt-1">{scholarship?.name ? 1 : 0}</div></Card>
        <Card><div className="text-xs text-muted-foreground uppercase tracking-widest">Essay score</div><div className="font-display text-3xl mt-1">{score || "—"}</div></Card>
        <Card><div className="text-xs text-muted-foreground uppercase tracking-widest">Latest review</div><div className="font-display text-3xl mt-1">{review ? "Done" : "Needed"}</div><div className="text-xs text-muted-foreground">{scholarship?.name || "No scholarship imported"}</div></Card>
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
                    <Pill tone="gold">{score ? `${score}/100 essay score` : "Needs review"}</Pill>
                    <span className="text-muted-foreground">{review ? "AI reviewed" : "Not reviewed"}</span>
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
        <Link to="/" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gold text-gold-foreground px-5 py-2 text-sm font-medium">
          <ArrowLeft className="size-4" />
          Back to landing
        </Link>
      </Card>
    </div>
  );
}
