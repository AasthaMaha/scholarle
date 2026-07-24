import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  FileText,
  FileUp,
  FlaskConical,
  Gauge,
  GraduationCap,
  Lightbulb,
  Link2,
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
import { Skeleton } from "@/components/ui/skeleton";
import { EssayEditor, type EssayEditorHandle, type RewriteAction } from "@/components/EssayEditor";
import {
  analyzeText,
  anchorCoachSuggestions,
  CATEGORY_META,
  CATEGORY_ORDER,
  countByCategory,
  mergeSuggestions,
  type CoachSentenceSuggestion,
  type Suggestion,
} from "@/lib/suggestions";
import {
  draftEditWindow,
  draftFingerprint,
  ignoredSuggestionKey,
  rebaseCachedSuggestions,
  requiresFullDraftFixScan,
  type EssayFixCacheEntry,
  type FixEngine,
} from "@/lib/fixCache";
import { journeySteps } from "@/lib/persona";
import { incompleteReviewMessage, isCompleteEssayReview } from "@/lib/essayReview";
import { revisionDiff } from "@/lib/revisionDiff";
import {
  containingSentenceRange,
  revisionPriorityRange,
} from "@/lib/revisionPriorityTarget";
import { getFile, removeFile, storeFile } from "@/lib/fileStore";
import { Spinner } from "@/components/Spinner";
import { AcademicOnboarding } from "@/components/AcademicOnboarding";
import {
  analyzeScholarshipFit,
  autofillProfileFromResume,
  buildCoachingSessionPayload,
  buildEditorCheckPayload,
  buildFitPayload,
  buildOutlineCoveragePayload,
  buildOutlinePayload,
  buildOutlinePoints,
  buildRevisionCoachPayload,
  buildWikiPayload,
  discoverScholarshipWiki,
  buildRewritePayload,
  profileToText,
  extractPromptWordLimits,
  extractScholarshipTextFromPdf,
  extractScholarshipOpportunity,
  getScholarshipPdfUploadConfig,
  generatePersonalizedOutline,
  runEditorCheck,
  runContextualGrammarCheck,
  runOutlineCoverageCheck,
  runRevisionCoach,
  runSelectionRewrite,
  runWorkspaceCoachingSession,
  warmEditorTools,
  normalizeEssayPromptEntries,
  normalizeSelectedEssayPromptEntries,
  serializeEssayPromptEntries,
  type EditorCheckResult,
  type RevisionCoachResult,
} from "@/lib/api/scholarE";
import {
  formatUploadSize,
  isMeaningfulScholarshipText,
  isValidScholarshipUrl,
  scholarshipSourceIsReady,
  type ScholarshipInputSource,
} from "@/lib/scholarshipInput";
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
  type EssayRevisionPriority,
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

// The expanded rail stays deliberately compact so every Journey page keeps as
// much horizontal workspace as possible. Labels use the space saved by smaller
// internal padding and step markers; exceptionally long names may truncate and
// remain available through their accessible label/tooltip.
const SIDEBAR_EXPANDED_WIDTH = 208;

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
  const [academicOnboardingActive, setAcademicOnboardingActive] = useState<boolean | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const guidedSidebarExpanded = useRef(false);
  const [journeyTutorialActive, setJourneyTutorialActive] = useState(false);
  const journeyMainRef = useRef<HTMLElement | null>(null);
  const accountIdentity = user?.email || (user ? "guest-profile" : "anonymous");

  useEffect(() => {
    const controller = new AbortController();
    // Begin the one-time Java warm-up at Journey entry, several steps before
    // the student needs Essay Workspace. Backend startup performs the same
    // idempotent request, so this is also a safe cold-start fallback.
    void warmEditorTools(controller.signal).catch(() => {
      // Fixes degrade independently; never interrupt the student's journey.
    });
    return () => controller.abort();
  }, []);

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

  // Resume the last step once the saved profile hydrates from storage.
  const restoredStep = useRef(false);
  useEffect(() => {
    if (restoredStep.current || !user) return;
    restoredStep.current = true;
    if (typeof user.lastStep === "number" && user.lastStep > 0) {
      // Versions before the dashboard consolidation persisted indices 4–6 for
      // Revise, Final Check, and Tracker. They now all resume at the dashboard.
      setStepIdx(Math.min(user.lastStep, journeySteps.length - 1));
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
    const compatibilitySlug = ["revise", "final-check", "tracker"].includes(slug)
      ? "application-dashboard"
      : slug;
    const nextIndex = journeySteps.findIndex((item) => item.slug === compatibilitySlug);
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
        className="flex h-[100dvh] overflow-hidden"
        style={{ ["--sw" as string]: `${SIDEBAR_EXPANDED_WIDTH}px` } as React.CSSProperties}
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
        />
        <div
          className={`flex min-h-0 w-full min-w-0 flex-col transition-[padding] duration-300 ease-out ${
            isSidebarOpen ? "md:pl-[var(--sw)]" : "md:pl-[65px]"
          }`}
        >
          <TopBar step={step} stepIdx={visibleStepIdx} guidedProfileSetupActive={guidedProfileSetupActive} />
          <FloatingSidebarToggle
            isOpen={isSidebarOpen}
            onOpen={() => setIsSidebarOpen(true)}
          />
          <main ref={journeyMainRef} tabIndex={-1} className={`min-h-0 min-w-0 flex-1 overflow-x-hidden outline-none transition-colors duration-500 ${
            step.slug === "essay-workspace" ? "overflow-y-hidden" : "overflow-y-auto"
          } ${
            step.slug === "discovery"
              ? "bg-[radial-gradient(circle_at_85%_8%,rgba(109,93,246,0.10),transparent_28%),linear-gradient(180deg,#f4f6fb_0%,#ffffff_48%,#f4f2fb_100%)]"
              : ""
          }`}>
            <div
              className={`mx-auto ${
                step.slug === "essay-workspace"
                  ? "h-full min-h-0 w-full max-w-none px-0 py-0"
                  : `px-6 md:px-10 ${
                      ["discovery", "requirements"].includes(step.slug)
                        ? "max-w-7xl py-6"
                        : step.slug === "profile"
                          ? "max-w-7xl py-10"
                          : "max-w-5xl py-10"
                    }`
              }`}
            >
              <div className={step.slug === "essay-workspace" ? "h-full min-h-0" : undefined}>
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
          {!guidedProfileSetupActive && <footer className="h-16 shrink-0 border-t border-border bg-background/95 px-6 backdrop-blur md:px-10">
            <div className="mx-auto h-full max-w-7xl">
              <Nav
                stepIdx={stepIdx}
                onNext={goNext}
                onPrev={goPrev}
                hideNext={step.slug === "discovery"}
                nextLabel={step.slug === "essay-workspace" ? "Review & Submit" : "Continue"}
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
    (user?.educationHistory?.some((entry) => entry.educationLevel?.trim()) || user?.educationLevel)
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
}: {
  activeIdx: number;
  laterStepsLocked: boolean;
  tutorialActive: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (i: number) => void;
  onClearAll: () => void;
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
        className={`fixed inset-0 z-30 bg-background/60 transition-opacity duration-300 md:hidden ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />
      <aside
        data-journey-sidebar
        className={`fixed inset-y-0 left-0 z-40 flex w-[var(--sw)] max-w-[85vw] shrink-0 flex-col border-r border-border bg-card/95 backdrop-blur transition-transform duration-300 ease-out md:max-w-none ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-border px-3">
          <Link to="/" className="flex min-w-0 flex-1 items-center gap-2">
            <img src={scholarELogoUrl} alt="" className="size-7 rounded-full object-cover" />
            <div className="text-sm font-display font-semibold tracking-tight">Scholar-E</div>
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

        <div className="flex-1 space-y-5 overflow-y-auto px-2 py-4">
          {groups.map(([group, steps]) => (
            <div key={group} data-journey-group={group}>
              <div className="mb-2 px-2 text-[10px] uppercase tracking-widest text-muted-foreground">{group}</div>
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
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-semibold transition-colors ${
                            isActive
                              ? "bg-info/10 text-info"
                              : isLocked
                                ? "cursor-not-allowed text-muted-foreground opacity-55"
                                : "hover:bg-accent text-foreground/80"
                          }`}
                        >
                          <span
                            className={`relative grid size-7 shrink-0 place-items-center rounded-lg ${
                              isActive
                                ? "bg-info text-white"
                                : isDone
                                ? "bg-success/20 text-success"
                                : "bg-secondary text-muted-foreground"
                            }`}
                          >
                            <span className="text-xs font-bold tabular-nums">{idx + 1}</span>
                            {isDone && (
                              <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-success text-white ring-2 ring-card">
                                <Check className="size-2.5" strokeWidth={4} />
                              </span>
                            )}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{s.title}</span>
                          {isLocked && <Lock className="size-3.5 shrink-0" aria-hidden="true" />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {isLocked ? "Complete your profile to unlock this step." : s.title}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="px-3 py-4">
          <SidebarUser />
        </div>

        <div className="flex h-16 shrink-0 flex-col justify-center border-t border-border px-3">
          <button
            type="button"
            onClick={onClearAll}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-destructive"
          >
            <RefreshCw className="size-3.5" />
            Reset all data
          </button>
          <div className="mt-1 pl-px text-[11px] text-muted-foreground/60">A coach, not a ghostwriter.</div>
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
  const hasWorkspaceExtension = step.slug === "essay-workspace";
  return (
    <div className="sticky top-0 z-20 h-14 bg-background/85 backdrop-blur">
      <div className={`flex h-full items-center pl-16 pr-6 md:px-10 ${hasWorkspaceExtension ? "gap-0" : "gap-4"}`}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={`flex min-w-0 items-center gap-2 ${hasWorkspaceExtension ? "shrink-0" : "flex-1"}`}>
              <span className="truncate text-lg font-bold tracking-tight text-foreground">{step.title}</span>
              {guidedProfileSetupActive ? (
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">Complete Your Profile</span>
              ) : null}
            </div>
          </TooltipTrigger>
          <TooltipContent>Goal: {step.goal}</TooltipContent>
        </Tooltip>
        {hasWorkspaceExtension && (
          <div
            data-journey-topbar-workspace
            className="flex min-w-0 flex-1 items-center gap-2"
          />
        )}
      </div>
      {!guidedProfileSetupActive && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-secondary">
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

      <div className="mt-3 flex w-full flex-1 flex-col items-center gap-1.5 overflow-hidden py-1">
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
                  className={`relative grid size-10 shrink-0 place-items-center rounded-full transition-colors ${
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
                    <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-success text-white ring-2 ring-card">
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
  nextLabel = "Continue",
}: {
  stepIdx: number;
  onNext: () => void;
  onPrev: () => void;
  hideNext?: boolean;
  nextLabel?: string;
}) {
  return (
    <div className="flex h-full items-center justify-between">
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
        {nextLabel}
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
    case "essay-workspace": return <StepEssayWorkspace />;
    case "application-dashboard": return <StepApplicationDashboard onNavigate={goToStep} />;
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

type ScholarshipPdfUploadState = {
  status: "idle" | "uploading" | "ready" | "error";
  filename: string;
  sizeBytes: number;
  extractedText: string;
  error: string;
  truncated: boolean;
};

const EMPTY_SCHOLARSHIP_PDF: ScholarshipPdfUploadState = {
  status: "idle",
  filename: "",
  sizeBytes: 0,
  extractedText: "",
  error: "",
  truncated: false,
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
  const branchGpa = alignedBranch && "gpa" in alignedBranch
    ? String(alignedBranch.gpa ?? "").trim()
    : "";
  const gpa = currentEducation?.gpa?.trim() || branchGpa;
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
  const [scholarshipUrl, setScholarshipUrl] = useState("");
  const [urlTouched, setUrlTouched] = useState(false);
  const [showCopiedText, setShowCopiedText] = useState(false);
  const [copiedScholarshipText, setCopiedScholarshipText] = useState("");
  const [activeInputSource, setActiveInputSource] = useState<ScholarshipInputSource | null>(null);
  const [pdfUpload, setPdfUpload] = useState<ScholarshipPdfUploadState>(EMPTY_SCHOLARSHIP_PDF);
  const [pdfDragOver, setPdfDragOver] = useState(false);
  const [pdfMaxBytes, setPdfMaxBytes] = useState<number | null>(null);
  const [bringError, setBringError] = useState("");
  const [platformContext, setPlatformContext] = useState("");
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const pdfRequestIdRef = useRef(0);

  useEffect(() => {
    if (wiki || discoveryRequestStartedRef.current) return;
    discoveryRequestStartedRef.current = true;
    void refreshWiki();
    // Discovery starts once when this page opens without cached results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    void getScholarshipPdfUploadConfig()
      .then((result) => {
        if (active && Number.isFinite(result.max_size_bytes)) setPdfMaxBytes(result.max_size_bytes);
      })
      .catch(() => {
        // The server still validates the configured limit during upload.
      });
    return () => {
      active = false;
    };
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

  function resizeCopiedTextInput(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 104), 280)}px`;
  }

  async function handleScholarshipPdf(file: File) {
    const requestId = pdfRequestIdRef.current + 1;
    pdfRequestIdRef.current = requestId;
    setActiveInputSource("pdf");
    setBringError("");
    if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
      setPdfUpload({
        ...EMPTY_SCHOLARSHIP_PDF,
        status: "error",
        filename: file.name,
        error: "Upload a PDF file.",
      });
      if (isValidScholarshipUrl(scholarshipUrl)) setActiveInputSource("url");
      else if (isMeaningfulScholarshipText(copiedScholarshipText)) setActiveInputSource("text");
      else setActiveInputSource(null);
      return;
    }
    setPdfUpload({
      status: "uploading",
      filename: file.name,
      sizeBytes: file.size,
      extractedText: "",
      error: "",
      truncated: false,
    });
    try {
      const result = await extractScholarshipTextFromPdf(file);
      if (pdfRequestIdRef.current !== requestId) return;
      setPdfUpload({
        status: "ready",
        filename: result.filename,
        sizeBytes: result.size_bytes,
        extractedText: result.text,
        error: "",
        truncated: result.truncated,
      });
      setPdfMaxBytes(result.max_size_bytes);
      setActiveInputSource("pdf");
    } catch (error) {
      if (pdfRequestIdRef.current !== requestId) return;
      const message = error instanceof Error && error.message
        ? error.message
        : "We couldn’t upload this PDF. Try again.";
      setPdfUpload({
        ...EMPTY_SCHOLARSHIP_PDF,
        status: "error",
        filename: file.name,
        sizeBytes: file.size,
        error: message,
      });
      if (isValidScholarshipUrl(scholarshipUrl)) setActiveInputSource("url");
      else if (isMeaningfulScholarshipText(copiedScholarshipText)) setActiveInputSource("text");
      else setActiveInputSource(null);
    }
  }

  function removeScholarshipPdf() {
    pdfRequestIdRef.current += 1;
    setPdfUpload(EMPTY_SCHOLARSHIP_PDF);
    if (isValidScholarshipUrl(scholarshipUrl)) setActiveInputSource("url");
    else if (isMeaningfulScholarshipText(copiedScholarshipText)) setActiveInputSource("text");
    else setActiveInputSource(null);
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  }

  function continueWithOwnOpportunity() {
    const sourceReady = scholarshipSourceIsReady(activeInputSource, {
      url: scholarshipUrl,
      pdfReady: pdfUpload.status === "ready",
      copiedText: copiedScholarshipText,
    });
    if (!sourceReady) {
      setBringError("Add a valid scholarship URL, upload a readable PDF, or paste scholarship text first.");
      return;
    }
    if (activeInputSource === "url") {
      const url = scholarshipUrl.trim();
      setBringError("");
      updateProfile({
        activeScholarship: {
          name: "",
          url,
          officialWebsite: url,
          additionalNotes: platformContext ? `Discovered on platform: ${platformContext}` : "",
          discoverySource: platformContext || "User-provided scholarship URL",
          discoverySourceKind: "user_entry",
        },
        fitAnalysis: undefined,
        personalizedOutline: undefined,
      });
      onUseSource();
      return;
    }
    if (activeInputSource === "pdf") {
      const displayName = pdfUpload.filename.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
      setBringError("");
      updateProfile({
        activeScholarship: {
          name: displayName,
          url: "",
          additionalNotes: pdfUpload.extractedText,
          discoverySource: `Uploaded PDF: ${pdfUpload.filename}`,
          discoverySourceKind: "user_entry",
        },
        fitAnalysis: undefined,
        personalizedOutline: undefined,
      });
      onUseSource();
      return;
    }
    const raw = copiedScholarshipText.trim();
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
  const validScholarshipUrl = isValidScholarshipUrl(scholarshipUrl);
  const showUrlError = urlTouched && activeInputSource === "url" && !!scholarshipUrl.trim() && !validScholarshipUrl;
  const pdfReady = pdfUpload.status === "ready";
  const copiedTextReady = isMeaningfulScholarshipText(copiedScholarshipText);
  const activeSourceReady = scholarshipSourceIsReady(activeInputSource, {
    url: scholarshipUrl,
    pdfReady,
    copiedText: copiedScholarshipText,
  });
  const activeSourceLabel = activeSourceReady
    ? activeInputSource === "pdf"
      ? "Using uploaded PDF"
      : activeInputSource === "text"
        ? "Using copied scholarship text"
        : "Using scholarship URL"
    : "";

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
            Scholar-E can extract requirements from a scholarship webpage or PDF.
          </p>

          <div className="mt-4 space-y-3.5">
            <div className={`rounded-lg border px-3.5 py-3 transition-[border-color,background-color,box-shadow] duration-150 motion-reduce:transition-none ${activeInputSource === "url" && validScholarshipUrl ? "border-info/55 bg-info/[0.045]" : "border-info/15 bg-white/70"}`}>
              <label htmlFor="scholarship-url" className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Link2 className="size-4 text-info" aria-hidden="true" />
                Paste scholarship URL
              </label>
              <input
                id="scholarship-url"
                type="url"
                inputMode="url"
                autoComplete="url"
                value={scholarshipUrl}
                onChange={(event) => {
                  setScholarshipUrl(event.target.value);
                  setActiveInputSource("url");
                  if (bringError) setBringError("");
                }}
                onFocus={() => {
                  if (validScholarshipUrl) setActiveInputSource("url");
                }}
                onBlur={() => setUrlTouched(true)}
                aria-invalid={showUrlError || undefined}
                aria-describedby={showUrlError ? "scholarship-url-error" : undefined}
                placeholder="https://..."
                className="mt-2 h-11 w-full rounded-lg border border-info/20 bg-background px-3.5 text-sm text-foreground outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-foreground/45 focus:border-info/70 focus:bg-white focus:ring-3 focus:ring-info/20"
              />
              {showUrlError && (
                <p id="scholarship-url-error" role="alert" className="mt-1.5 text-xs font-medium text-destructive">
                  Enter a complete scholarship webpage URL beginning with http:// or https://.
                </p>
              )}
              {activeInputSource === "url" && validScholarshipUrl && (
                <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-info">
                  <Check className="size-3.5" aria-hidden="true" />
                  Using scholarship URL
                </p>
              )}
            </div>

            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-border/80" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/55">OR</span>
              <span className="h-px flex-1 bg-border/80" />
            </div>

            <div className={`rounded-lg border px-3.5 py-3 transition-[border-color,background-color,box-shadow] duration-150 motion-reduce:transition-none ${activeInputSource === "pdf" && pdfReady ? "border-info/55 bg-info/[0.045]" : "border-info/15 bg-accent/20"}`}>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileText className="size-4 text-info" aria-hidden="true" />
                Upload scholarship PDF
              </div>
              {pdfUpload.status === "ready" || pdfUpload.status === "uploading" ? (
                <div className="mt-2.5 flex min-w-0 items-center gap-3 rounded-lg border border-info/15 bg-white/80 px-3 py-2.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
                  <span className={`grid size-8 shrink-0 place-items-center rounded-md ${pdfUpload.status === "ready" ? "bg-success/10 text-success" : "bg-info/10 text-info"}`}>
                    {pdfUpload.status === "uploading" ? <Spinner className="size-4" /> : <FileText className="size-4" aria-hidden="true" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{pdfUpload.filename}</p>
                    <p className="mt-0.5 text-xs text-foreground/60">
                      {pdfUpload.status === "uploading"
                        ? "Reading PDF text…"
                        : [formatUploadSize(pdfUpload.sizeBytes), pdfUpload.truncated ? "Text prepared for analysis" : "Ready to analyze"].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {pdfUpload.status === "ready" && (
                    <div className="flex shrink-0 items-center gap-2">
                      <button type="button" onClick={() => pdfInputRef.current?.click()} className="min-h-8 rounded px-1.5 text-xs font-medium text-info/75 hover:text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35">Replace</button>
                      <button type="button" onClick={removeScholarshipPdf} className="min-h-8 rounded px-1.5 text-xs font-medium text-foreground/60 hover:text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35" aria-label={`Remove uploaded PDF ${pdfUpload.filename}`}>Remove</button>
                    </div>
                  )}
                </div>
              ) : (
                <label
                  htmlFor="scholarship-pdf"
                  role="button"
                  tabIndex={0}
                  aria-disabled={pdfUpload.status === "uploading" || undefined}
                  aria-describedby="scholarship-pdf-help scholarship-pdf-status"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      pdfInputRef.current?.click();
                    }
                  }}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setPdfDragOver(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setPdfDragOver(true);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPdfDragOver(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setPdfDragOver(false);
                    const file = event.dataTransfer.files?.[0];
                    if (file) void handleScholarshipPdf(file);
                  }}
                  className={`mt-2.5 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-3 text-center outline-none transition-[border-color,background-color,box-shadow] duration-150 motion-reduce:transition-none ${pdfDragOver ? "border-info/70 bg-info/[0.07] ring-2 ring-info/15" : "border-info/25 bg-white/65 hover:border-info/50 hover:bg-info/[0.035] focus-visible:border-info/65 focus-visible:ring-3 focus-visible:ring-info/20"}`}
                >
                  <FileUp className="size-5 text-info" aria-hidden="true" />
                  <span className="mt-1.5 text-sm font-medium text-foreground">Drag and drop a PDF here, or <span className="font-semibold text-info underline-offset-4 hover:underline">browse files</span></span>
                  <span id="scholarship-pdf-help" className="mt-1 text-xs text-foreground/55">
                    {pdfMaxBytes ? `PDF files only · Up to ${formatUploadSize(pdfMaxBytes)}` : "PDF files only. File size is validated during upload."}
                  </span>
                </label>
              )}
              <input
                ref={pdfInputRef}
                id="scholarship-pdf"
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                disabled={pdfUpload.status === "uploading"}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleScholarshipPdf(file);
                  event.currentTarget.value = "";
                }}
              />
              <div id="scholarship-pdf-status" aria-live="polite">
                {pdfUpload.error && <p role="alert" className="mt-2 text-xs font-medium text-destructive">{pdfUpload.error}</p>}
                {activeInputSource === "pdf" && pdfReady && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-info">
                    <Check className="size-3.5" aria-hidden="true" />
                    Using uploaded PDF
                  </p>
                )}
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowCopiedText((current) => !current)}
                aria-expanded={showCopiedText}
                aria-controls="copied-scholarship-text-panel"
                className="rounded-sm text-xs font-semibold text-info underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35"
              >
                {showCopiedText ? "Hide copied scholarship text" : "Paste copied scholarship text instead"}
              </button>
              {showCopiedText && (
                <div id="copied-scholarship-text-panel" className="mt-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
                  <label htmlFor="copied-scholarship-text" className="text-sm font-semibold text-foreground">Copied scholarship text</label>
                  <textarea
                    id="copied-scholarship-text"
                    rows={3}
                    value={copiedScholarshipText}
                    onChange={(event) => {
                      setCopiedScholarshipText(event.target.value);
                      setActiveInputSource("text");
                      resizeCopiedTextInput(event.currentTarget);
                      if (bringError) setBringError("");
                    }}
                    onFocus={() => {
                      if (copiedTextReady) setActiveInputSource("text");
                    }}
                    placeholder="Paste copied eligibility requirements or application details…"
                    className="mt-1.5 min-h-24 w-full resize-y rounded-lg border border-info/20 bg-background px-3.5 py-2.5 text-sm leading-6 text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-foreground/45 focus:border-info/70 focus:ring-3 focus:ring-info/20"
                  />
                  {activeInputSource === "text" && copiedTextReady && <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-info"><Check className="size-3.5" aria-hidden="true" />Using copied scholarship text</p>}
                  {!!copiedScholarshipText.trim() && !copiedTextReady && <p className="mt-1.5 text-xs text-foreground/60">Add a little more scholarship information before analyzing.</p>}
                </div>
              )}
            </div>

            {bringError && <p id="bring-opportunity-error" role="alert" className="text-xs font-medium text-destructive">{bringError}</p>}

            <div id="bring-opportunity-help" className="rounded-lg bg-success/[0.035] px-3 py-2.5 text-sm leading-6 text-foreground/80">
              <div className="font-semibold text-foreground">Supported inputs</div>
              <ul className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-2" aria-label="Accepted scholarship input formats">
                {["Scholarship webpage URL", "Scholarship PDF", "Copied scholarship text", "Eligibility or application details"].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="mt-1 size-3.5 shrink-0 text-success" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex justify-end">
              <p className="sr-only" aria-live="polite">{activeSourceLabel}</p>
              <button
                type="button"
                onClick={continueWithOwnOpportunity}
                disabled={!activeSourceReady || pdfUpload.status === "uploading"}
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

// At 500px the three tabs and six-column score grid remain fully readable
// without taking more space from the essay than necessary.
const ESSAY_REVIEW_PANEL_MIN_WIDTH = 500;

function essayReviewPanelBounds(workspaceWidth: number) {
  const maximum = Math.max(1, Math.floor(workspaceWidth / 2));
  return {
    minimum: Math.min(ESSAY_REVIEW_PANEL_MIN_WIDTH, maximum),
    maximum,
  };
}

const ESSAY_REVIEW_DIMENSIONS = [
  "alignment",
  "evidence_strength",
  "insight",
  "narrative_structure_flow_coherence",
  "tone_authenticity",
  "clarity_concision",
] as const;

/** Match the backend's formatting-insensitive evaluation fingerprint input. */
function canonicalEssayForReview(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\uFEFF]/g, "");
  const output: string[] = [];
  let pendingBlank = false;
  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.replace(/[ \t]+/g, " ").trim();
    if (!line) {
      pendingBlank = output.length > 0;
      continue;
    }
    if (pendingBlank) output.push("");
    output.push(line);
    pendingBlank = false;
  }
  return output.join("\n").trim();
}

type DraftCheckScope = { text: string; start: number; end: number; revision: string; document: string; promptId: string };
type AnchoredFixState = { draft: string; suggestions: CoachSentenceSuggestion[] };
const FIX_PIPELINE_VERSION = "6";

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function draftCheckScope(previous: string, current: string, promptId: string): DraftCheckScope {
  if (requiresFullDraftFixScan(previous, current)) {
    return { text: current, start: 0, end: current.length, revision: `full:${draftFingerprint(current)}`, document: current, promptId };
  }
  let changedAt = 0;
  const shared = Math.min(previous.length, current.length);
  while (changedAt < shared && previous[changedAt] === current[changedAt]) changedAt += 1;
  const before = current.slice(0, changedAt);
  const breakMatch = [...before.matchAll(/\n\s*\n/g)].at(-1);
  const start = breakMatch ? (breakMatch.index ?? 0) + breakMatch[0].length : 0;
  const after = current.slice(changedAt);
  const nextBreak = after.match(/\n\s*\n/);
  const end = nextBreak?.index == null ? current.length : changedAt + nextBreak.index;
  const text = current.slice(start, end);
  return { text, start, end, revision: `${start}:${end}:${draftFingerprint(text)}`, document: current, promptId };
}

function rebaseDraftRange(
  previousDraft: string,
  currentDraft: string,
  start: number,
  end: number,
): [number, number] | null {
  if (previousDraft === currentDraft) return [start, end];
  const change = draftEditWindow(previousDraft, currentDraft);
  if (end <= change.prefix) return [start, end];
  if (start >= change.previousEnd) return [start + change.delta, end + change.delta];
  return null;
}

type EssayReviewDimension = (typeof ESSAY_REVIEW_DIMENSIONS)[number];

type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
};

type PdfVisualLine = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  averageCharacterWidth: number;
};

function pdfItemPosition(item: PdfTextItem) {
  const transform = item.transform;
  if (!transform || transform.length < 6 || !Number.isFinite(transform[4]) || !Number.isFinite(transform[5])) {
    return null;
  }
  return {
    x: transform[4],
    y: transform[5],
    width: Number.isFinite(item.width) ? Math.max(0, item.width ?? 0) : 0,
    height: Number.isFinite(item.height) ? Math.max(0, item.height ?? 0) : 0,
  };
}

function median(values: number[], fallback: number) {
  if (!values.length) return fallback;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function joinPdfLineFragments(items: PdfTextItem[]) {
  const ordered = [...items].sort((a, b) => (pdfItemPosition(a)?.x ?? 0) - (pdfItemPosition(b)?.x ?? 0));
  let text = "";
  let previous: PdfTextItem | null = null;

  for (const item of ordered) {
    const fragment = item.str ?? "";
    if (!fragment) continue;
    if (previous && !/\s$/.test(text) && !/^\s/.test(fragment)) {
      const previousPosition = pdfItemPosition(previous);
      const position = pdfItemPosition(item);
      if (!previousPosition || !position) {
        text += " ";
      } else {
        const gap = position.x - (previousPosition.x + previousPosition.width);
        const previousCharacters = Math.max(1, (previous.str ?? "").trim().length);
        const currentCharacters = Math.max(1, fragment.trim().length);
        const characterWidth =
          ((previousPosition.width / previousCharacters) + (position.width / currentCharacters)) / 2;
        // A near-zero visual gap means the PDF split one word into multiple text runs.
        if (gap > Math.max(1, characterWidth * 0.2)) text += " ";
      }
    }
    text += fragment;
    previous = item;
  }

  return text.replace(/[ \t]+/g, " ").trim();
}

function isPdfPageMarker(text: string) {
  const spacedPage = "p\\s*a\\s*g\\s*e";
  return new RegExp(
    `^(?:page\\s+\\d+|\\d+\\s*(?:\\||[-–—])\\s*(?:${spacedPage}|page)|(?:${spacedPage}|page)\\s+\\d+)$`,
    "i",
  ).test(text.trim());
}

function buildPdfVisualLines(items: PdfTextItem[]) {
  const groups: PdfTextItem[][] = [];
  let current: PdfTextItem[] = [];
  let forceNewLine = false;

  for (const item of items) {
    const fragment = item.str ?? "";
    if (!fragment) {
      if (item.hasEOL) forceNewLine = true;
      continue;
    }

    const previous = current[current.length - 1];
    const previousPosition = previous ? pdfItemPosition(previous) : null;
    const position = pdfItemPosition(item);
    const lineTolerance = Math.max(
      1.5,
      Math.min(previousPosition?.height || 10, position?.height || 10) * 0.45,
    );
    const startsNewLine =
      current.length > 0 &&
      (forceNewLine ||
        previous?.hasEOL ||
        (!!previousPosition && !!position && Math.abs(position.y - previousPosition.y) > lineTolerance));

    if (startsNewLine) {
      groups.push(current);
      current = [];
    }
    current.push(item);
    forceNewLine = false;
  }
  if (current.length) groups.push(current);

  return groups
    .map((group): PdfVisualLine | null => {
      const positioned = group
        .map((item) => ({ item, position: pdfItemPosition(item) }))
        .filter((entry) => entry.position !== null);
      const text = joinPdfLineFragments(group);
      if (!text || isPdfPageMarker(text)) return null;
      if (!positioned.length) {
        return { text, x: 0, y: 0, width: 0, height: 10, averageCharacterWidth: 5 };
      }
      const x = Math.min(...positioned.map(({ position }) => position!.x));
      const right = Math.max(...positioned.map(({ position }) => position!.x + position!.width));
      const width = Math.max(0, right - x);
      return {
        text,
        x,
        y: positioned[0].position!.y,
        width,
        height: Math.max(...positioned.map(({ position }) => position!.height || 0), 10),
        averageCharacterWidth: width > 0 ? width / Math.max(1, text.replace(/\s/g, "").length) : 5,
      };
    })
    .filter((line): line is PdfVisualLine => line !== null);
}

/** Reflow visual PDF lines into paragraphs while preserving genuine structure. */
function reflowPdfVisualLines(lines: PdfVisualLine[]) {
  if (!lines.length) return "";

  const typicalHeight = median(lines.map((line) => line.height).filter((height) => height > 0), 10);
  const verticalSteps = lines
    .slice(1)
    .map((line, index) => Math.abs(lines[index].y - line.y))
    .filter((step) => step > 1 && step < typicalHeight * 2.5);
  const typicalStep = median(verticalSteps, typicalHeight * 1.2);
  const bodyLines = lines.filter((line) => line.text.length >= 30 && line.height <= typicalHeight * 1.25);
  const typicalWidth = median(bodyLines.map((line) => line.width).filter((width) => width > 0), 0);
  const commonLeft = median(bodyLines.map((line) => line.x), lines[0].x);

  let text = lines[0].text;
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    const verticalGap = Math.abs(previous.y - current.y);
    const largeGap = verticalGap > Math.max(typicalStep * 1.35, typicalHeight * 1.55);
    const indented = current.x - commonLeft > Math.max(12, current.averageCharacterWidth * 1.75);
    const fontScaleChanged =
      Math.max(previous.height, current.height) / Math.max(1, Math.min(previous.height, current.height)) > 1.2;
    const listItem = /^(?:[-•▪◦*]|\(?\d+[.)])\s+/.test(current.text);
    const previousLooksComplete =
      typicalWidth > 0 &&
      previous.width < typicalWidth * 0.72 &&
      /[.!?]["')\]]?$/.test(previous.text);
    const openingDocumentLabel =
      index <= 3 && (previous.text.length < 80 || current.text.length < 80) && previousLooksComplete === false;
    const paragraphBreak = largeGap || indented || fontScaleChanged || listItem || previousLooksComplete || openingDocumentLabel;

    if (paragraphBreak) {
      text += `\n\n${current.text}`;
    } else if (/[-‐‑]$/.test(previous.text)) {
      text += current.text;
    } else {
      text += ` ${current.text}`;
    }
  }

  return text;
}

function normalizedPdfHeaderText(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function isPossiblePdfHeaderLine(line: PdfVisualLine) {
  const normalized = normalizedPdfHeaderText(line.text);
  const words = normalized.split(/\s+/).filter(Boolean);
  return normalized.length >= 8 && normalized.length <= 180 && words.length >= 2;
}

function matchingPdfHeaderFormat(reference: PdfVisualLine, candidate: PdfVisualLine) {
  const heightRatio =
    Math.max(reference.height, candidate.height) / Math.max(1, Math.min(reference.height, candidate.height));
  const horizontalTolerance = Math.max(
    24,
    reference.averageCharacterWidth * 4,
    candidate.averageCharacterWidth * 4,
  );
  return heightRatio <= 1.2 && Math.abs(reference.x - candidate.x) <= horizontalTolerance;
}

function removeRepeatedPdfHeaders(pageLines: PdfVisualLine[][], studentName = "") {
  const headerLineCount = 4;
  const occurrences = new Map<
    string,
    Array<{ pageIndex: number; lineIndex: number; line: PdfVisualLine }>
  >();

  pageLines.forEach((lines, pageIndex) => {
    const keysSeenOnPage = new Set<string>();
    lines.slice(0, headerLineCount).forEach((line, lineIndex) => {
      if (!isPossiblePdfHeaderLine(line)) return;
      const key = normalizedPdfHeaderText(line.text);
      if (keysSeenOnPage.has(key)) return;
      keysSeenOnPage.add(key);
      const existing = occurrences.get(key) ?? [];
      existing.push({ pageIndex, lineIndex, line });
      occurrences.set(key, existing);
    });
  });

  const repeated = new Map<string, Array<{ pageIndex: number; lineIndex: number; line: PdfVisualLine }>>();
  occurrences.forEach((items, key) => {
    if (new Set(items.map((item) => item.pageIndex)).size < 2) return;
    const reference = items[0].line;
    const compatible = items.filter((item) => matchingPdfHeaderFormat(reference, item.line));
    if (new Set(compatible.map((item) => item.pageIndex)).size >= 2) repeated.set(key, compatible);
  });

  const knownNameKey = normalizedPdfHeaderText(studentName);
  const removals = pageLines.map(() => new Set<number>());
  for (let pageIndex = 1; pageIndex < pageLines.length; pageIndex += 1) {
    const matches = Array.from(repeated.entries())
      .flatMap(([key, items]) =>
        items
          .filter((item) => item.pageIndex === pageIndex)
          .map((item) => ({ key, item, repeatedPageCount: new Set(items.map((entry) => entry.pageIndex)).size })),
      );
    const repeatedBlock = matches.length >= 2;
    matches.forEach(({ key, item, repeatedPageCount }) => {
      const isKnownStudentName = !!knownNameKey && key === knownNameKey;
      if (repeatedBlock || repeatedPageCount >= 3 || isKnownStudentName) {
        removals[pageIndex].add(item.lineIndex);
      }
    });
  }

  let removedCount = 0;
  const cleanedPages = pageLines.map((lines, pageIndex) =>
    lines.filter((_line, lineIndex) => {
      const remove = removals[pageIndex].has(lineIndex);
      if (remove) removedCount += 1;
      return !remove;
    }),
  );
  return { cleanedPages, removedCount };
}

function reconstructPdfDocumentText(pages: PdfTextItem[][], studentName = "") {
  const pageLines = pages.map(buildPdfVisualLines);
  const { cleanedPages, removedCount } = removeRepeatedPdfHeaders(pageLines, studentName);
  return {
    text: normalizePdfDraftText(cleanedPages.map(reflowPdfVisualLines)),
    removedRepeatedHeaderLines: removedCount,
  };
}

function normalizePdfDraftText(pages: string[]) {
  return pages
    .map((page) => page.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    // A page boundary is usually just another visual wrap, not a paragraph.
    .join(" ")
    .replace(/([A-Za-z])\s+-\s+(?=[A-Za-z])/g, "$1-")
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
      title: "Flow & Coherence",
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
      title: "Preparing specific revision guidance",
      description: "Preparing one clear, specific revision action for each criterion based on its score and feedback.",
    },
  ];
  const activeStep = displayedProgress < 17
    ? 0
    : displayedProgress < 29
      ? 1
      : displayedProgress < 41
        ? 2
        : displayedProgress < 57
          ? 3
          : displayedProgress < 69
            ? 4
            : displayedProgress < 82
              ? 5
              : 6;
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

type RevisionCoachUiState = {
  status: "loading" | "ready" | "error" | "applied";
  result?: RevisionCoachResult;
  message?: string;
};

function revisionPriorityKey(priority: EssayRevisionPriority, index = 0) {
  return priority.id || `${priority.title || "priority"}-${index}`;
}

function StepEssayWorkspace() {
  const { user, updateProfile } = useUser();
  const [topBarTarget, setTopBarTarget] = useState<HTMLElement | null>(null);
  const editorApiRef = useRef<EssayEditorHandle | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [anchoredFixes, setAnchoredFixes] = useState<AnchoredFixState>(() => ({ draft: "", suggestions: [] }));
  const [coachLoading, setCoachLoading] = useState(false);
  const [reviewResult, setReviewResult] = useState<EssayReviewResult | null>(
    () => isCompleteEssayReview(user?.essayReviewResult) ? user.essayReviewResult : null,
  );
  const [reviewUpdatedAt, setReviewUpdatedAt] = useState<number | null>(() => user?.essayReviewUpdatedAt ?? null);
  const [reviewDraftAtRun, setReviewDraftAtRun] = useState<string>(() => user?.essayReviewDraftAtRun ?? "");
  const [reviewPromptAtRun, setReviewPromptAtRun] = useState<string>(() => user?.essayReviewPromptAtRun ?? "");
  const [reviewProfileFingerprintAtRun, setReviewProfileFingerprintAtRun] = useState<string>(
    () => user?.essayReviewProfileFingerprintAtRun ?? "",
  );
  const [revisionCoachStates, setRevisionCoachStates] = useState<Record<string, RevisionCoachUiState>>({});
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
  const workspaceColumnsRef = useRef<HTMLDivElement | null>(null);
  const [workspaceColumnsWidth, setWorkspaceColumnsWidth] = useState(
    ESSAY_REVIEW_PANEL_MIN_WIDTH * 2,
  );
  const [panelWidth, setPanelWidth] = useState(ESSAY_REVIEW_PANEL_MIN_WIDTH);
  const panelBounds = essayReviewPanelBounds(workspaceColumnsWidth);

  useEffect(() => {
    if (!user || essayTitle.trim() || !activeScholarshipName) return;
    updateProfile({ essayTitle: activeScholarshipName });
  }, [activeScholarshipName, essayTitle, updateProfile, user]);
  const [panelResizing, setPanelResizing] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [languageToolLoading, setLanguageToolLoading] = useState(false);
  const [contextualGrammarLoading, setContextualGrammarLoading] = useState(false);
  const [sessionProgress, setSessionProgress] = useState(0);
  const [reviewReady, setReviewReady] = useState(false);
  const [reviewRunError, setReviewRunError] = useState<string | null>(null);
  const [languageToolWarning, setLanguageToolWarning] = useState<string | null>(null);
  const [contextualGrammarWarning, setContextualGrammarWarning] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineStatus, setOutlineStatus] = useState<string | null>(null);
  const [promptConfirmed, setPromptConfirmed] = useState(false);
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [pendingPromptIndex, setPendingPromptIndex] = useState(0);
  const [workspaceTutorialActive, setWorkspaceTutorialActive] = useState(false);
  const workspaceTutorialHandled = useRef(false);
  const languageToolAbortRef = useRef<AbortController | null>(null);
  const contextualGrammarAbortRef = useRef<AbortController | null>(null);
  const currentDraftRef = useRef("");
  const previousDraftForFixesRef = useRef("");
  const [fullFixScanNonce, setFullFixScanNonce] = useState(0);
  const handledFullFixScanNonceRef = useRef(0);

  useEffect(() => {
    setTopBarTarget(document.querySelector<HTMLElement>("[data-journey-topbar-workspace]"));
  }, []);

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
  const activePromptIdRef = useRef(activePromptId);
  activePromptIdRef.current = activePromptId;
  const fixCacheByPromptRef = useRef<Record<string, EssayFixCacheEntry>>(user?.essayFixesByPromptId ?? {});
  fixCacheByPromptRef.current = user?.essayFixesByPromptId ?? fixCacheByPromptRef.current;
  const essayPrompt =
    activePromptEntry?.promptText || (hasPromptDecisionState ? "" : legacyPromptBlob);
  const draft = user?.essayDraftsByPromptId?.[activePromptId]
    ?? (selectedPromptIndex === 0 && activePromptId !== "no-essay-prompt" ? user?.essayDraft ?? "" : "");
  const draftHtml = user?.essayDraftHtmlByPromptId?.[activePromptId]
    ?? (selectedPromptIndex === 0 && activePromptId !== "no-essay-prompt" ? user?.essayDraftHtml ?? "" : "");
  currentDraftRef.current = draft;
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).filter(Boolean).length : 0;
  const characterCount = draft.length;
  const hasMultiplePrompts = availablePrompts.length > 1;
  const fixesLoading = languageToolLoading || contextualGrammarLoading;
  const fixesWarning = [languageToolWarning, contextualGrammarWarning].filter(Boolean).join(" ") || null;
  const canonicalDraftForReview = useMemo(() => canonicalEssayForReview(draft), [draft]);
  const canonicalPromptForReview = useMemo(() => canonicalEssayForReview(essayPrompt), [essayPrompt]);
  const currentProfileFingerprint = useMemo(
    () => draftFingerprint(canonicalEssayForReview(profileToText(user))),
    [user],
  );
  const reviewScoringInputChanged = !!reviewResult && (
    canonicalDraftForReview !== canonicalEssayForReview(reviewDraftAtRun)
    || canonicalPromptForReview !== canonicalEssayForReview(reviewPromptAtRun)
  );
  const reviewProfileChanged = !!reviewResult
    && currentProfileFingerprint !== reviewProfileFingerprintAtRun;
  const reviewInputChanged = !reviewResult || reviewScoringInputChanged || reviewProfileChanged;

  useEffect(() => {
    languageToolAbortRef.current?.abort();
    contextualGrammarAbortRef.current?.abort();
    const cached = fixCacheByPromptRef.current[activePromptId];
    const restored = cached?.pipelineVersion === FIX_PIPELINE_VERSION
      ? rebaseCachedSuggestions(cached.draft, draft, cached.suggestions ?? [])
      : [];
    setAnchoredFixes({ draft, suggestions: restored });
    setDismissed(new Set(user?.ignoredEssayFixesByPromptId?.[activePromptId] ?? []));
    previousDraftForFixesRef.current = "";
  }, [activePromptId, user?.email]);

  useEffect(() => {
    setRevisionCoachStates({});
  }, [activePromptId, reviewUpdatedAt]);

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
  const coachRaw = useMemo(
    () => rebaseCachedSuggestions(anchoredFixes.draft, draft, anchoredFixes.suggestions),
    [anchoredFixes, draft],
  );
  const suggestions = useMemo(() => {
    const auto = analyzeText(draft);
    const coach = anchorCoachSuggestions(coachRaw, draft);
    return mergeSuggestions(coach, auto).filter((s) => !dismissed.has(ignoredSuggestionKey(s, draft)));
  }, [draft, coachRaw, dismissed]);

  useEffect(() => {
    if (!user || anchoredFixes.draft !== draft) return;
    const existing = fixCacheByPromptRef.current[activePromptId];
    const entry: EssayFixCacheEntry = {
      ...existing,
      draft: anchoredFixes.draft,
      suggestions: anchoredFixes.suggestions,
      checkedAt: Date.now(),
      pipelineVersion: FIX_PIPELINE_VERSION,
    };
    const next = { ...fixCacheByPromptRef.current, [activePromptId]: entry };
    fixCacheByPromptRef.current = next;
    updateProfile({ essayFixesByPromptId: next });
  }, [activePromptId, anchoredFixes, draft, updateProfile, user?.email]);

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

  // Restore only schema-v5 six-criterion Essay Review data. Older payloads
  // are intentionally ignored and render as an empty Evaluate state.
  useEffect(() => {
    const restored = user?.essayReviewResult;
    const complete = isCompleteEssayReview(restored);
    setReviewResult(complete ? restored : null);
    setReviewUpdatedAt(complete ? user?.essayReviewUpdatedAt ?? null : null);
    setReviewDraftAtRun(complete ? user?.essayReviewDraftAtRun ?? "" : "");
    setReviewPromptAtRun(complete ? user?.essayReviewPromptAtRun ?? "" : "");
    setReviewProfileFingerprintAtRun(
      complete ? user?.essayReviewProfileFingerprintAtRun ?? "" : "",
    );
  }, [
    user?.email,
    user?.essayReviewResult,
    user?.essayReviewUpdatedAt,
    user?.essayReviewDraftAtRun,
    user?.essayReviewPromptAtRun,
    user?.essayReviewProfileFingerprintAtRun,
  ]);

  useEffect(() => {
    if (!panelResizing) return;
    const resize = (event: PointerEvent) => {
      const workspace = workspaceColumnsRef.current?.getBoundingClientRect();
      if (!workspace) return;
      const { minimum, maximum } = essayReviewPanelBounds(workspace.width);
      const requestedWidth = workspace.right - event.clientX;
      setPanelWidth(Math.max(minimum, Math.min(maximum, requestedWidth)));
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
    const workspace = workspaceColumnsRef.current;
    if (!workspace) return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const { minimum, maximum } = essayReviewPanelBounds(width);
      setWorkspaceColumnsWidth(width);
      setPanelWidth((current) => Math.max(minimum, Math.min(maximum, current)));
    });
    resizeObserver.observe(workspace);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (panelWidth < panelBounds.minimum || panelWidth > panelBounds.maximum) {
      setPanelWidth((current) => Math.max(panelBounds.minimum, Math.min(panelBounds.maximum, current)));
    }
  }, [panelBounds.maximum, panelBounds.minimum, panelWidth]);

  const savedLabel = (() => {
    if (!savedAt) return "Not saved yet";
    const mins = Math.floor((nowTick - savedAt) / 60000);
    if (mins < 1) return "Saved · just now";
    if (mins === 1) return "Saved · 1m ago";
    if (mins < 60) return `Saved · ${mins}m ago`;
    return `Saved · ${Math.floor(mins / 60)}h ago`;
  })();

  function acceptSuggestion(s: Suggestion) {
    if (s.replacementAvailable === false) return;
    editorApiRef.current?.accept(s);
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
    const key = ignoredSuggestionKey(s, draft);
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    if (user) {
      const existing = user.ignoredEssayFixesByPromptId?.[activePromptId] ?? [];
      const nextIgnored = [...existing.filter((entry) => entry !== key), key].slice(-200);
      updateProfile({
        ignoredEssayFixesByPromptId: {
          ...(user.ignoredEssayFixesByPromptId ?? {}),
          [activePromptId]: nextIgnored,
        },
      });
    }
  }

  function addSuggestionToDictionary(s: Suggestion) {
    if (!user) return;
    const word = s.original.trim();
    if (!word || /\s/.test(word)) return;
    const existing = user.personalDictionary ?? [];
    if (!existing.some((item) => item.toLowerCase() === word.toLowerCase())) {
      updateProfile({ personalDictionary: [...existing, word] });
    }
    dismissSuggestion(s);
  }

  function revealSuggestion(s: Suggestion) {
    editorApiRef.current?.reveal(s);
  }

  function revealReviewPriority(priority: EssayRevisionPriority) {
    if (!reviewResult) return;
    const range = revisionPriorityRange(priority, reviewResult, draft);
    if (!range) return;
    editorApiRef.current?.reveal({
      id: `review-${priority.id || priority.title || range.start}`,
      category: "clarity",
      start: range.start,
      end: range.end,
      original: draft.slice(range.start, range.end),
      title: priority.title || "Revision priority",
      explanation: priority.action || "",
      replacement: "",
      source: "coach",
      replacementAvailable: false,
    });
  }

  async function requestRevisionCoachSuggestion(priority: EssayRevisionPriority) {
    const key = revisionPriorityKey(priority);
    if (!reviewResult) {
      setRevisionCoachStates((current) => ({
        ...current,
        [key]: { status: "error", message: "Evaluate the essay before requesting a suggested change." },
      }));
      return;
    }
    const citedTarget = revisionPriorityRange(priority, reviewResult, draft);
    if (!citedTarget) {
      setRevisionCoachStates((current) => ({
        ...current,
        [key]: {
          status: "error",
          message: "Scholar-E could not locate a specific passage for this priority.",
        },
      }));
      return;
    }
    const target = containingSentenceRange(draft, citedTarget);
    revealReviewPriority(priority);
    setRevisionCoachStates((current) => ({
      ...current,
      [key]: { status: "loading" },
    }));
    try {
      const result = await runRevisionCoach(buildRevisionCoachPayload(
        user,
        priority,
        draft,
        target,
        draftFingerprint(draft),
        essayPrompt,
      ));
      if (result.status !== "success" || !result.suggested_text || !result.target) {
        throw new Error(result.message || "Scholar-E could not create a grounded suggestion.");
      }
      setRevisionCoachStates((current) => ({
        ...current,
        [key]: { status: "ready", result },
      }));
    } catch (error) {
      setRevisionCoachStates((current) => ({
        ...current,
        [key]: {
          status: "error",
          message: error instanceof Error ? error.message : "Scholar-E could not create a grounded suggestion.",
        },
      }));
    }
  }

  function applyRevisionCoachSuggestion(
    priority: EssayRevisionPriority,
    result: RevisionCoachResult,
    replacement: string,
  ) {
    const key = revisionPriorityKey(priority);
    const target = result.target;
    const stale = !target
      || result.draft_revision !== draftFingerprint(draft)
      || draft.slice(target.start, target.end) !== result.original_text;
    if (stale) {
      setRevisionCoachStates((current) => ({
        ...current,
        [key]: {
          ...current[key],
          status: "error",
          message: "The essay changed after this suggestion was created. Request a new suggestion.",
        },
      }));
      return;
    }
    if (!replacement.trim() || /\[[^\]]+\]/.test(replacement)) {
      setRevisionCoachStates((current) => ({
        ...current,
        [key]: {
          ...current[key],
          status: "error",
          message: "Replace every placeholder with your own real detail before using this suggestion.",
        },
      }));
      return;
    }
    editorApiRef.current?.accept({
      id: `revision-coach-${key}`,
      category: "engagement",
      start: target.start,
      end: target.end,
      original: result.original_text || "",
      title: priority.title || "Revision Coach",
      explanation: result.reason || "",
      replacement: replacement.trim(),
      source: "coach",
      replacementAvailable: true,
    });
    setRevisionCoachStates((current) => ({
      ...current,
      [key]: { ...current[key], status: "applied" },
    }));
  }

  function dismissRevisionCoachSuggestion(priority: EssayRevisionPriority) {
    const key = revisionPriorityKey(priority);
    setRevisionCoachStates((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function persistEssayReview(
    result: EssayReviewResult,
    draftForRun: string,
    promptForRun: string,
    profileFingerprintForRun: string,
  ) {
    const updatedAt = Date.now();
    setReviewResult(result);
    setReviewUpdatedAt(updatedAt);
    setReviewDraftAtRun(draftForRun);
    setReviewPromptAtRun(promptForRun);
    setReviewProfileFingerprintAtRun(profileFingerprintForRun);
    updateProfile({
      essayReviewResult: result,
      essayReviewUpdatedAt: updatedAt,
      essayReviewDraftAtRun: draftForRun,
      essayReviewPromptAtRun: promptForRun,
      essayReviewProfileFingerprintAtRun: profileFingerprintForRun,
    });
  }

  function cachedFixResult(scope: DraftCheckScope, engine: FixEngine): EditorCheckResult | null {
    const paragraph = fixCacheByPromptRef.current[scope.promptId]?.paragraphs?.[draftFingerprint(scope.text)];
    if (!paragraph || paragraph.text !== scope.text) return null;
    const cached = paragraph[engine];
    if (!cached || cached.pipelineVersion !== FIX_PIPELINE_VERSION) return null;
    const cacheLifetime = cached.suggestions.length > 0
      ? 24 * 60 * 60 * 1000
      : 5 * 60 * 1000;
    if (Date.now() - cached.checkedAt > cacheLifetime) return null;
    return {
      status: "success",
      sentence_suggestions: cached.suggestions,
      warnings: [],
      draft_revision: scope.revision,
      language_tool_status: engine === "language_tool" ? "ready" : undefined,
      replaces_language_tool: cached.replacesLanguageTool,
      fix_pipeline_version: cached.pipelineVersion,
    };
  }

  function cacheFixResult(scope: DraftCheckScope, result: EditorCheckResult, engine: FixEngine) {
    const suggestionsForEngine: CoachSentenceSuggestion[] = (result.sentence_suggestions ?? []).map((suggestion) => ({
      ...suggestion,
      source: engine,
    }));
    const existing = fixCacheByPromptRef.current[scope.promptId];
    const paragraphKey = draftFingerprint(scope.text);
    const paragraph = existing?.paragraphs?.[paragraphKey];
    const nextParagraphs = {
      ...(existing?.paragraphs ?? {}),
      [paragraphKey]: {
        ...paragraph,
        text: scope.text,
        [engine]: {
          suggestions: suggestionsForEngine,
          checkedAt: Date.now(),
          pipelineVersion: result.fix_pipeline_version ?? FIX_PIPELINE_VERSION,
          replacesLanguageTool: result.replaces_language_tool,
        },
      },
    };
    const boundedParagraphs = Object.fromEntries(
      Object.entries(nextParagraphs)
        .sort(([, left], [, right]) => {
          const leftTime = Math.max(left.language_tool?.checkedAt ?? 0, left.contextual_grammar?.checkedAt ?? 0);
          const rightTime = Math.max(right.language_tool?.checkedAt ?? 0, right.contextual_grammar?.checkedAt ?? 0);
          return leftTime - rightTime;
        })
        .slice(-40),
    );
    const entry: EssayFixCacheEntry = {
      ...existing,
      draft: existing?.draft ?? scope.document,
      suggestions: existing?.suggestions ?? [],
      checkedAt: Date.now(),
      pipelineVersion: FIX_PIPELINE_VERSION,
      paragraphs: boundedParagraphs,
    };
    const next = { ...fixCacheByPromptRef.current, [scope.promptId]: entry };
    fixCacheByPromptRef.current = next;
    updateProfile({ essayFixesByPromptId: next });
  }

  function applyFixCheckResult(scope: DraftCheckScope, result: EditorCheckResult, engine: FixEngine) {
    if (scope.promptId !== activePromptIdRef.current) return;
    if (result.draft_revision !== scope.revision) return;
    const currentDraft = currentDraftRef.current;
    const currentScope = rebaseDraftRange(scope.document, currentDraft, scope.start, scope.end);
    if (!currentScope) return;
    const [scopeStart, scopeEnd] = currentScope;
    if (currentDraft.slice(scopeStart, scopeEnd) !== scope.text) return;

    let refreshedSuggestions: CoachSentenceSuggestion[] = [];
    for (const suggestion of result.sentence_suggestions ?? []) {
      const relativeStart = typeof suggestion.start_offset === "number" ? suggestion.start_offset : null;
      const relativeEnd = typeof suggestion.end_offset === "number" ? suggestion.end_offset : null;
      if (relativeStart == null || relativeEnd == null) continue;
      const absoluteStart = scopeStart + relativeStart;
      const absoluteEnd = scopeStart + relativeEnd;
      if (absoluteStart < scopeStart || absoluteEnd > scopeEnd) continue;
      refreshedSuggestions.push({
        ...suggestion,
        source: engine,
        start_offset: absoluteStart,
        end_offset: absoluteEnd,
      });
    }

    setAnchoredFixes((previous) => {
      const rebased = rebaseCachedSuggestions(previous.draft, currentDraft, previous.suggestions);
      let preserved = rebased.filter((suggestion) => {
        if (suggestion.source !== engine) return true;
        const start = suggestion.start_offset;
        const end = suggestion.end_offset;
        return typeof start !== "number" || typeof end !== "number" || end <= scopeStart || start >= scopeEnd;
      });
      const overlaps = (left: CoachSentenceSuggestion, right: CoachSentenceSuggestion) => {
        const leftStart = left.start_offset ?? -1;
        const leftEnd = left.end_offset ?? -1;
        const rightStart = right.start_offset ?? -1;
        const rightEnd = right.end_offset ?? -1;
        return leftStart >= 0 && rightStart >= 0 && leftStart < rightEnd && leftEnd > rightStart;
      };

      if (engine === "language_tool") {
        // LanguageTool is the fast candidate generator, but validated
        // contextual suggestions should win when they cover the same text.
        refreshedSuggestions = refreshedSuggestions.filter((fresh) =>
          !preserved.some((suggestion) => suggestion.source === "contextual_grammar" && overlaps(suggestion, fresh)));
      } else if (result.replaces_language_tool) {
        // The contextual response is the authoritative final result for this
        // paragraph: remove every provisional LanguageTool candidate in scope,
        // including candidates the AI explicitly rejected.
        preserved = preserved.filter((suggestion) => {
          if (suggestion.source !== "language_tool") return true;
          const start = suggestion.start_offset;
          const end = suggestion.end_offset;
          return typeof start !== "number" || typeof end !== "number" || end <= scopeStart || start >= scopeEnd;
        });
      } else {
        preserved = preserved.filter((suggestion) =>
          suggestion.source !== "language_tool"
          || !refreshedSuggestions.some((fresh) => overlaps(suggestion, fresh)));
      }

      return {
        draft: currentDraft,
        suggestions: [...preserved, ...refreshedSuggestions]
          .sort((left, right) => (left.start_offset ?? 0) - (right.start_offset ?? 0)),
      };
    });
  }

  async function runLanguageToolCheck(scope: DraftCheckScope) {
    if (coachLoading || isEvaluating || !scope.text.trim()) return;
    const cached = cachedFixResult(scope, "language_tool");
    if (cached) {
      applyFixCheckResult(scope, cached, "language_tool");
      setLanguageToolWarning(null);
      return;
    }
    languageToolAbortRef.current?.abort();
    const controller = new AbortController();
    languageToolAbortRef.current = controller;
    setLanguageToolLoading(true);
    try {
      let result: EditorCheckResult | null = null;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        result = await runEditorCheck(
          buildEditorCheckPayload(user, scope.text, scope.revision),
          controller.signal,
        );
        if (controller.signal.aborted || result.status !== "warming") break;
        setLanguageToolWarning(null);
        await abortableDelay(result.retry_after_ms ?? 750, controller.signal);
      }
      if (controller.signal.aborted) return;
      if (!result || result.status === "warming") return;
      if (result.status !== "error") {
        cacheFixResult(scope, result, "language_tool");
        applyFixCheckResult(scope, result, "language_tool");
      }
      setLanguageToolWarning((result.warnings ?? []).join(" ") || null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLanguageToolWarning("LanguageTool is temporarily unavailable. Immediate browser checks are still active.");
    } finally {
      if (languageToolAbortRef.current === controller) {
        languageToolAbortRef.current = null;
        setLanguageToolLoading(false);
      }
    }
  }

  async function runContextualCheck(scope: DraftCheckScope) {
    if (coachLoading || isEvaluating || !scope.text.trim()) return;
    const cached = cachedFixResult(scope, "contextual_grammar");
    if (cached) {
      applyFixCheckResult(scope, cached, "contextual_grammar");
      setContextualGrammarWarning(null);
      return;
    }
    contextualGrammarAbortRef.current?.abort();
    const controller = new AbortController();
    contextualGrammarAbortRef.current = controller;
    setContextualGrammarLoading(true);
    try {
      const result = await runContextualGrammarCheck(
        buildEditorCheckPayload(user, scope.text, scope.revision),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (result.status !== "error") {
        cacheFixResult(scope, result, "contextual_grammar");
        applyFixCheckResult(scope, result, "contextual_grammar");
      }
      setContextualGrammarWarning((result.warnings ?? []).join(" ") || null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setContextualGrammarWarning("Contextual grammar checking is temporarily unavailable. LanguageTool remains active.");
    } finally {
      if (contextualGrammarAbortRef.current === controller) {
        contextualGrammarAbortRef.current = null;
        setContextualGrammarLoading(false);
      }
    }
  }

  async function runCoverageCheck() {
    const currentDraft = currentDraftRef.current;
    if (!currentDraft.trim() || !buildOutlinePoints(user?.personalizedOutline).length) return;
    try {
      const result = await runOutlineCoverageCheck(buildOutlineCoveragePayload(user, currentDraft));
      const coveredIds = result.outline_coverage?.covered_point_ids;
      if (!coveredIds) return;
      const known = new Set(buildOutlinePoints(user?.personalizedOutline).map((point) => point.id));
      setAutoCovered(new Set(coveredIds.filter((id) => known.has(id))));
    } catch {
      // Coverage is independent from Fixes and can safely wait for Evaluate.
    }
  }

  async function runCoachingSession() {
    if (coachLoading || isEvaluating || !user) return;
    if (!promptConfirmed) {
      setPromptPickerOpen(true);
      setActiveTab("outline");
      setPanelOpen(true);
      return;
    }
    if (!canonicalDraftForReview) {
      return;
    }

    setIsEvaluating(true);
    setCoachLoading(true);
    setReviewReady(false);
    setReviewRunError(null);
    setSessionProgress(6);
    setPanelOpen(true);
    setActiveTab("coach");

    try {
      // One backend request owns the Manager-led review graph. It evaluates the
      // submitted draft exactly as written; grammar corrections remain optional fixes.
      // Six profile-blind specialists answer fixed questions in parallel.
      // Python scores them; one later profile-aware planner consolidates actions.
      const session = await runWorkspaceCoachingSession(buildCoachingSessionPayload(user, essayPrompt));
      const review = session.review ?? null;
      const gotReview = isCompleteEssayReview(review);
      const coveredIds = session.outline_coverage?.covered_point_ids;
      if (coveredIds) {
        const known = new Set(buildOutlinePoints(user.personalizedOutline).map((p) => p.id));
        setAutoCovered(new Set(coveredIds.filter((id) => known.has(id))));
      }

      if (!gotReview) {
        setReviewRunError(incompleteReviewMessage(review, !!reviewResult));
        setReviewReady(true);
        setSessionProgress(100);
        setActiveTab("coach");
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        return;
      }
      persistEssayReview(review, draft, essayPrompt, currentProfileFingerprint);
      setReviewRunError(null);
      setReviewReady(true);

      setSessionProgress(100);
      setActiveTab("coach");
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    } catch (error) {
      console.error("Scholar-E coaching session failed.", error);
      setReviewRunError(
        reviewResult
          ? "The new evaluation could not be completed. Your previous complete review remains displayed."
          : "The evaluation could not be completed. Please try again; no score was saved.",
      );
      setReviewReady(true);
      setActiveTab("coach");
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

  // Unaffected findings are synchronously rebased above on every draft render.
  // LanguageTool refreshes the changed paragraph first; the slower contextual
  // pass follows independently. New edits abort both stale requests without
  // clearing still-valid underlines elsewhere in the essay.
  const runLanguageToolCheckRef = useRef(runLanguageToolCheck);
  const runContextualCheckRef = useRef(runContextualCheck);
  useEffect(() => {
    runLanguageToolCheckRef.current = runLanguageToolCheck;
    runContextualCheckRef.current = runContextualCheck;
  });
  useEffect(() => {
    const previous = previousDraftForFixesRef.current;
    previousDraftForFixesRef.current = draft;

    const languageToolController = languageToolAbortRef.current;
    const contextualController = contextualGrammarAbortRef.current;
    languageToolAbortRef.current = null;
    contextualGrammarAbortRef.current = null;
    languageToolController?.abort();
    contextualController?.abort();
    setLanguageToolLoading(false);
    setContextualGrammarLoading(false);

    if (!draft.trim()) {
      setAnchoredFixes({ draft: "", suggestions: [] });
      setLanguageToolWarning(null);
      setContextualGrammarWarning(null);
      return;
    }

    const explicitFullScan = fullFixScanNonce !== handledFullFixScanNonceRef.current;
    handledFullFixScanNonceRef.current = fullFixScanNonce;
    const scope = explicitFullScan
      ? { text: draft, start: 0, end: draft.length, revision: `full:${draftFingerprint(draft)}`, document: draft, promptId: activePromptId }
      : draftCheckScope(previous, draft, activePromptId);
    const languageToolTimer = window.setTimeout(
      () => void runLanguageToolCheckRef.current(scope),
      500,
    );
    const contextualTimer = window.setTimeout(
      () => void runContextualCheckRef.current(scope),
      1200,
    );
    return () => {
      window.clearTimeout(languageToolTimer);
      window.clearTimeout(contextualTimer);
    };
  }, [draft, fullFixScanNonce, isEvaluating, user?.personalDictionary]);

  // Draft changes already trigger both Fixes passes. Paste/upload additionally
  // refreshes the independent outline-coverage check after text settles.
  const [pasteNonce, setPasteNonce] = useState(0);
  useEffect(() => {
    if (pasteNonce === 0) return;
    const id = window.setTimeout(() => {
      void runCoverageCheck();
    }, 800);
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
          getTextContent: () => Promise<{ items: PdfTextItem[] }>;
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
      const pages: PdfTextItem[][] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        pages.push(tc.items);
      }
      const imported = reconstructPdfDocumentText(pages, user?.name ?? "");
      updateActiveDraft(imported.text);
      // A PDF is a whole-document replacement even when its character count is
      // close to the previous draft. Force both Fixes engines to review every
      // imported paragraph after extraction and cleanup settles.
      setFullFixScanNonce((nonce) => nonce + 1);
      setReviewResult(null);
      setReviewUpdatedAt(null);
      setReviewDraftAtRun("");
      setReviewPromptAtRun("");
      setReviewProfileFingerprintAtRun("");
      setReviewReady(false);
      setReviewRunError(null);
      setAnchoredFixes({ draft: imported.text, suggestions: [] });
      setDismissed(new Set());
      updateProfile({
        essayReviewResult: undefined,
        essayReviewUpdatedAt: undefined,
        essayReviewDraftAtRun: undefined,
        essayReviewPromptAtRun: undefined,
        essayReviewProfileFingerprintAtRun: undefined,
      });
      triggerAutoCheck();
    } catch (error) {
      console.error("Scholar-E could not parse the uploaded PDF.", error);
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
    upsertVersion({
      reviewOverall: score ?? undefined,
      reviewOverallLevel: reviewResult?.overall_level,
    });
  }

  // Attach the canonical criterion scores to the current draft version.
  useEffect(() => {
    if (!reviewResult?.criteria) return;
    const reviewScores: Record<string, number> = {};
    const reviewLevels: Record<string, string> = {};
    for (const [key, value] of Object.entries(reviewResult.criteria)) {
      if (typeof value?.score === "number") reviewScores[key] = value.score;
      if (value?.level) reviewLevels[key] = value.level;
    }
    if (!Object.keys(reviewScores).length) return;
    upsertVersion({
      reviewScores,
      reviewLevels,
      reviewOverall: reviewResult.overall_score ?? undefined,
      reviewOverallLevel: reviewResult.overall_level,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewResult]);

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background" aria-busy={outlineLoading || isEvaluating}>
      <div
        inert={outlineLoading || isEvaluating || workspaceTutorialActive ? true : undefined}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
      {topBarTarget && createPortal(
        <div
          inert={outlineLoading || isEvaluating || workspaceTutorialActive ? true : undefined}
          className="flex min-w-0 flex-1 items-center"
          aria-busy={outlineLoading || isEvaluating}
        >
          <div className="mx-10 hidden h-6 w-px shrink-0 bg-border lg:block" />
          <div className="hidden min-w-0 flex-1 items-center gap-10 lg:flex">
            <input
              type="text"
              value={essayTitle}
              onChange={(e) => updateProfile({ essayTitle: e.target.value })}
              placeholder="Untitled scholarship essay"
              aria-label="Essay title"
              className="w-auto min-w-[10rem] max-w-[22rem] truncate border-none bg-transparent p-0 text-[15px] font-bold leading-tight tracking-tight text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground"
            />
            <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
              <span className={`inline-block size-1.5 rounded-full ${savedAt ? "bg-success" : "bg-muted-foreground/40"}`} />
              {savedLabel}
            </div>
          </div>

          <div className="ml-2 flex shrink-0 items-center gap-1 md:gap-1.5">
            <WordCountMeter wordCount={wordCount} characterCount={characterCount} target={wordTarget} />
            <div className="mx-1 hidden h-6 w-px bg-border sm:block" />

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
              disabled={!canonicalDraftForReview || !promptConfirmed || coachLoading || isEvaluating || !reviewInputChanged}
              aria-busy={coachLoading || isEvaluating}
              className={`ml-0.5 inline-flex items-center gap-1.5 rounded-lg bg-info px-3 py-2 text-[13px] font-medium text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-60 ${coachLoading || isEvaluating ? "agent-loading" : ""}`}
            >
              {coachLoading || isEvaluating ? <Spinner className="size-4" /> : <Wand2 className="size-4" />}
              <span className="hidden sm:inline">
                {coachLoading || isEvaluating
                  ? "Evaluating…"
                  : !reviewResult
                    ? "Evaluate"
                    : reviewProfileChanged && !reviewScoringInputChanged
                      ? "Update Coaching"
                      : "Evaluate Again"}
              </span>
            </button>

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="ml-1 hidden xl:block">
                  <ScoreRing score={score} />
                </div>
              </TooltipTrigger>
              <TooltipContent>{score == null ? "Run a coaching session to get your essay score" : `Essay score: ${score}/100`}</TooltipContent>
            </Tooltip>
          </div>
        </div>,
        topBarTarget,
      )}

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

      <section className="shrink-0 border-b border-border bg-card">
        <div className="mx-auto max-w-[1440px] space-y-3 px-4 py-3 md:px-6">
          {promptConfirmed && (
            <div className="flex items-center rounded-xl border border-info/20 bg-info/5 px-3 py-2.5">
              <div className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-info">
                {essayPrompt.trim()
                  ? "Prompt"
                  : "Scholarship-guided writing focus"}
              </div>
              <div className="mx-3 h-7 w-px shrink-0 bg-border" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted-foreground line-clamp-2">
                {essayPrompt || "No formal prompt selected; evaluation uses the scholarship mission and selection criteria."}
              </p>
              <div className="mx-3 h-7 w-px shrink-0 bg-border" aria-hidden="true" />
              <Tooltip delayDuration={50}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingPromptIndex(selectedPromptIndex);
                      setPromptPickerOpen(true);
                    }}
                    aria-label="Change or edit prompt"
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-info outline-none transition-colors hover:bg-info/10 focus-visible:bg-info/10 focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
                  >
                    <PencilLine className="size-4" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end" sideOffset={7}>
                  Change or edit prompt
                </TooltipContent>
              </Tooltip>
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
      <div ref={workspaceColumnsRef} className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col items-stretch overflow-hidden lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div
            data-essay-workspace-tour="editor"
            className="flex min-h-0 w-full flex-1 flex-col"
          >
            <EssayEditor
              ref={editorApiRef}
              value={draft}
              onChange={updateActiveDraft}
              richValue={draftHtml}
              onRichChange={updateActiveDraftHtml}
              suggestions={suggestions}
              onDismiss={dismissSuggestion}
              onAddToDictionary={addSuggestionToDictionary}
              onAutoCheck={triggerAutoCheck}
              onRequestRewrite={requestRewrite}
              className="flex-1"
            />
          </div>
        </div>

        {panelOpen ? (
          <div
            style={{ "--essay-panel-width": `${panelWidth}px` } as React.CSSProperties}
            className={`relative min-h-0 w-full flex-1 overflow-hidden lg:w-[var(--essay-panel-width)] lg:flex-none ${
              panelResizing ? "transition-none" : "transition-[width] duration-300 ease-out"
            }`}
          >
            <div
              role="separator"
              aria-label="Resize coaching sidebar"
              aria-orientation="vertical"
              aria-valuemin={panelBounds.minimum}
              aria-valuemax={panelBounds.maximum}
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
                setPanelWidth((width) => Math.max(
                  panelBounds.minimum,
                  Math.min(panelBounds.maximum, width + direction * 24),
                ));
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
              onAddToDictionary={addSuggestionToDictionary}
              fixesLoading={fixesLoading}
              fixesWarning={fixesWarning}
              reviewResult={reviewResult}
              reviewRunError={reviewRunError}
              reviewUpdatedAt={reviewUpdatedAt}
              reviewDraftChanged={!!reviewUpdatedAt && reviewScoringInputChanged}
              now={nowTick}
              onRevealPriority={revealReviewPriority}
              revisionCoachStates={revisionCoachStates}
              onRequestRevisionCoach={requestRevisionCoachSuggestion}
              onApplyRevisionCoach={applyRevisionCoachSuggestion}
              onDismissRevisionCoach={dismissRevisionCoachSuggestion}
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
  onAddToDictionary,
  fixesLoading,
  fixesWarning,
  reviewResult,
  reviewRunError,
  reviewUpdatedAt,
  reviewDraftChanged,
  now,
  onRevealPriority,
  revisionCoachStates,
  onRequestRevisionCoach,
  onApplyRevisionCoach,
  onDismissRevisionCoach,
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
  onAddToDictionary: (s: Suggestion) => void;
  fixesLoading: boolean;
  fixesWarning: string | null;
  reviewResult: EssayReviewResult | null;
  reviewRunError: string | null;
  reviewUpdatedAt: number | null;
  reviewDraftChanged: boolean;
  now: number;
  onRevealPriority: (priority: EssayRevisionPriority) => void;
  revisionCoachStates: Record<string, RevisionCoachUiState>;
  onRequestRevisionCoach: (priority: EssayRevisionPriority) => void;
  onApplyRevisionCoach: (
    priority: EssayRevisionPriority,
    result: RevisionCoachResult,
    replacement: string,
  ) => void;
  onDismissRevisionCoach: (priority: EssayRevisionPriority) => void;
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
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden border-t border-border bg-card lg:border-l lg:border-t-0"
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
                {tab.id === "highlights" && fixesLoading && (
                  <span
                    className="size-3 shrink-0 animate-spin rounded-full border-2 border-info/25 border-t-info"
                    role="status"
                    aria-label="Checking essay fixes"
                  />
                )}
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
            runError={reviewRunError}
            loading={isEvaluating && !reviewReady}
            updatedAt={reviewUpdatedAt}
            draftChanged={reviewDraftChanged}
            now={now}
            onRevealPriority={onRevealPriority}
            revisionCoachStates={revisionCoachStates}
            onRequestRevisionCoach={onRequestRevisionCoach}
            onApplyRevisionCoach={onApplyRevisionCoach}
            onDismissRevisionCoach={onDismissRevisionCoach}
          />
        )}
        {activeTab === "highlights" && (
          <WorkspaceHighlightsTab
            isEvaluating={isEvaluating}
            suggestions={suggestions}
            onAccept={onAccept}
            onDismiss={onDismiss}
            onReveal={onReveal}
            onAddToDictionary={onAddToDictionary}
            fixesLoading={fixesLoading}
            fixesWarning={fixesWarning}
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
          <div className={`text-[14px] font-semibold leading-snug ${done ? "text-muted-foreground line-through" : "text-foreground"}`}>
            {labelPrefix && <span>{labelPrefix}: </span>}
            <span>{label}</span>
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
          <div className="pb-2.5">
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
            <div className="mt-3 space-y-3">
              {outline?.strategy?.tone_guidance && (
                <div className="flex items-start gap-2.5 rounded-lg border border-info/20 bg-info/5 px-3 py-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-info/10 text-info">
                    <Lightbulb className="size-4" aria-hidden="true" />
                  </span>
                  <p className="pt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-info">Recommended tip: </span>
                    <span className="font-normal text-foreground">{outline.strategy.tone_guidance}</span>
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
  edge,
}: {
  criterion: EssayCriterionReview;
  selected: boolean;
  onSelect: () => void;
  edge?: "left" | "right";
}) {
  const score = typeof criterion.score === "number" ? criterion.score : null;
  const displayLabel = criterion.short_label
    || (criterion.criterion === "narrative_structure_flow_coherence"
      ? "Flow"
      : criterion.criterion === "evidence_strength"
        ? "Evidence"
        : criterion.criterion === "tone_authenticity"
          ? "Tone"
          : criterion.criterion === "clarity_concision"
            ? "Clarity"
            : criterion.label || labelize(criterion.criterion ?? "criterion"));

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-controls="essay-review-criterion-detail"
      className={`group relative h-[5rem] w-full min-w-0 text-center transition-all focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-info ${
        edge === "left"
          ? "rounded-bl-xl after:rounded-bl-xl"
          : edge === "right"
            ? "rounded-br-xl after:rounded-br-xl"
            : ""
      } ${
        selected
          ? "z-10 bg-background after:pointer-events-none after:absolute after:inset-0 after:border-[3px] after:border-info"
          : "bg-background hover:bg-info/5"
      }`}
    >
      <span className="absolute inset-0 grid grid-rows-[1.25rem_0.75rem_1.5rem] content-center items-center justify-items-center gap-1 px-1 py-1">
        <span className={`flex h-full w-full items-center justify-center text-center text-[11px] leading-tight ${selected ? "font-black text-info" : "font-semibold text-foreground/85"}`}>
          {displayLabel}
        </span>
        <span className="flex h-full w-full items-center justify-center text-center text-[10px] font-semibold leading-none text-muted-foreground">
          {typeof criterion.weight === "number" ? `${criterion.weight}%` : ""}
        </span>
        <span
          className="flex h-full w-full items-center justify-center text-center text-[20px] font-bold leading-none tabular-nums"
          style={score != null ? { color: scoreColor(score) } : undefined}
        >
          {score ?? "—"}
        </span>
      </span>
    </button>
  );
}

function RevisionPrioritiesSection({
  priorities,
  onRevealPriority,
  revisionCoachStates,
  onRequestRevisionCoach,
  onApplyRevisionCoach,
  onDismissRevisionCoach,
}: {
  priorities: EssayRevisionPriority[];
  onRevealPriority: (priority: EssayRevisionPriority) => void;
  revisionCoachStates: Record<string, RevisionCoachUiState>;
  onRequestRevisionCoach: (priority: EssayRevisionPriority) => void;
  onApplyRevisionCoach: (
    priority: EssayRevisionPriority,
    result: RevisionCoachResult,
    replacement: string,
  ) => void;
  onDismissRevisionCoach: (priority: EssayRevisionPriority) => void;
}) {
  if (!priorities.length) return null;
  return (
    <section className="rounded-xl border border-success/20 bg-success/5 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-success">
        Top revision priorities
      </div>
      <div className="mt-2 space-y-2">
        {priorities.slice(0, 3).map((priority, index) => (
          <article
            key={priority.id || `${priority.title}-${index}`}
            id={priority.id}
            className="rounded-lg border border-success/15 bg-background/80 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="text-[13px] font-semibold">
                {index + 1}. {priority.title || "Priority revision"}
              </div>
              <div className="flex gap-1 text-[10px] font-semibold text-muted-foreground">
                {priority.impact && <span className="rounded-full bg-success/10 px-2 py-0.5">{priority.impact} impact</span>}
                {priority.estimated_effort && <span className="rounded-full bg-accent px-2 py-0.5">{priority.estimated_effort}</span>}
              </div>
            </div>
            {priority.action && <p className="mt-1.5 text-[12px] leading-relaxed">{priority.action}</p>}
            {priority.location && (
              <button
                type="button"
                onClick={() => onRevealPriority(priority)}
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-info transition-colors hover:text-info/80 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
              >
                Show in essay
                <ArrowRight className="size-3" aria-hidden="true" />
              </button>
            )}
            {priority.completion_condition && (
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Done when: </span>{priority.completion_condition}
              </p>
            )}
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Primary: {labelize(priority.primary_criterion || "criterion")}
              {!!priority.also_improves?.length && ` · Also improves: ${priority.also_improves.map(labelize).join(", ")}`}
            </p>
            <RevisionCoachSuggestionPanel
              priority={priority}
              state={revisionCoachStates[revisionPriorityKey(priority)]}
              onRequest={() => onRequestRevisionCoach(priority)}
              onApply={(result, replacement) => onApplyRevisionCoach(priority, result, replacement)}
              onDismiss={() => onDismissRevisionCoach(priority)}
            />
          </article>
        ))}
      </div>
    </section>
  );
}

function RevisionCoachSuggestionPanel({
  priority,
  state,
  onRequest,
  onApply,
  onDismiss,
}: {
  priority: EssayRevisionPriority;
  state?: RevisionCoachUiState;
  onRequest: () => void;
  onApply: (result: RevisionCoachResult, replacement: string) => void;
  onDismiss: () => void;
}) {
  const result = state?.result;
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState("");
  useEffect(() => {
    setEditedText(result?.suggested_text ?? "");
    setEditing(false);
  }, [result?.suggested_text]);
  const diff = useMemo(
    () => revisionDiff(result?.original_text ?? "", editedText),
    [editedText, result?.original_text],
  );
  const unresolvedPlaceholders = /\[[^\]]+\]/.test(editedText);

  if (!state) {
    return (
      <button
        type="button"
        onClick={onRequest}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-info/25 bg-info/5 px-2.5 py-1.5 text-[11px] font-semibold text-info transition-colors hover:bg-info/10"
      >
        <Wand2 className="size-3.5" aria-hidden="true" />
        Preview suggested change
      </button>
    );
  }

  if (state.status === "loading") {
    return (
      <div role="status" className="mt-2 flex items-center gap-2 rounded-md border border-info/20 bg-info/5 px-2.5 py-2 text-[11px] text-muted-foreground">
        <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-info/20 border-t-info" />
        Creating a grounded suggestion…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="mt-2 rounded-md border border-warning/25 bg-warning/5 p-2.5">
        <p className="text-[11px] leading-relaxed text-foreground/85">{state.message}</p>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={onRequest} className="rounded-md bg-info px-2.5 py-1 text-[10px] font-semibold text-white">
            Try again
          </button>
          <button type="button" onClick={onDismiss} className="rounded-md border border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (state.status === "applied") {
    return (
      <div role="status" className="mt-2 flex items-center gap-2 rounded-md border border-success/25 bg-success/5 px-2.5 py-2 text-[11px] text-success">
        <Check className="size-3.5" aria-hidden="true" />
        Added to your essay. Review it in your own voice.
      </div>
    );
  }

  if (!result) return null;

  return (
    <section className="mt-2 rounded-lg border border-info/20 bg-info/5 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-info">
          Suggested change
        </div>
        <div className="text-[9px] font-semibold text-muted-foreground">
          Preview only · your essay is unchanged
        </div>
      </div>

      {editing ? (
        <label className="mt-2 block">
          <span className="text-[10px] font-semibold text-foreground">Edit before using</span>
          <textarea
            value={editedText}
            onChange={(event) => setEditedText(event.target.value)}
            rows={5}
            className="mt-1 w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-[12px] leading-relaxed outline-none focus:border-info focus:ring-2 focus:ring-info/15"
          />
        </label>
      ) : (
        <div className="mt-2 rounded-md border border-border bg-background p-2.5">
          <div className="mb-1.5 flex gap-3 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span><span className="mr-1 text-destructive">−</span>Removed</span>
            <span><span className="mr-1 text-success">+</span>Added</span>
          </div>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed">
            {diff.map((segment, index) => {
              if (segment.type === "remove") {
                return (
                  <del key={`${segment.type}-${index}`} className="bg-destructive/10 text-destructive decoration-destructive/70">
                    {segment.text}
                  </del>
                );
              }
              if (segment.type === "add") {
                return (
                  <ins key={`${segment.type}-${index}`} className="border-b border-success/60 bg-success/10 text-success no-underline">
                    {segment.text}
                  </ins>
                );
              }
              return <span key={`${segment.type}-${index}`}>{segment.text}</span>;
            })}
          </p>
        </div>
      )}

      {result.reason && (
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Why this helps: </span>
          {result.reason}
        </p>
      )}

      {!!result.selected_profile_facts?.length && (
        <details className="mt-2 text-[10px] text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-foreground">
            Profile details used ({result.selected_profile_facts.length})
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {result.selected_profile_facts.map((fact) => (
              <li key={fact.fact_id}>
                {fact.fact || fact.value}
                {fact.sensitivity === "sensitive" && " · sensitive detail"}
              </li>
            ))}
          </ul>
        </details>
      )}

      {unresolvedPlaceholders && (
        <p className="mt-2 text-[10px] font-medium text-warning">
          Replace every bracketed placeholder with your own real detail before using this suggestion.
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setEditing((current) => !current)}
          className="rounded-md bg-info px-2.5 py-1.5 text-[10px] font-semibold text-white"
        >
          {editing ? "Review changes" : "Edit suggestion"}
        </button>
        <button
          type="button"
          onClick={() => onApply(result, editedText)}
          disabled={!editedText.trim() || unresolvedPlaceholders}
          className="rounded-md border border-info/30 bg-background px-2.5 py-1.5 text-[10px] font-semibold text-info disabled:cursor-not-allowed disabled:opacity-45"
        >
          Use in essay
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-border px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground"
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}

function CriterionReviewDetails({
  criterion,
  priorities,
}: {
  criterion: EssayCriterionReview;
  priorities: EssayRevisionPriority[];
}) {
  const score = typeof criterion.score === "number" ? criterion.score : null;
  const displayLabel = criterion.criterion === "narrative_structure_flow_coherence"
    ? "Flow & Coherence"
    : criterion.label || labelize(criterion.criterion ?? "criterion");
  const feedback = criterion.coach_feedback;
  const related = priorities.filter((priority) => criterion.related_priority_ids?.includes(priority.id || ""));

  return (
    <section
      id="essay-review-criterion-detail"
      aria-live="polite"
      className="overflow-hidden rounded-xl border border-border bg-background"
    >
      <div className="border-b border-border bg-accent/25 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 text-[15px] font-semibold">{displayLabel}</div>
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="text-[11px] font-semibold text-foreground/80">{criterion.level || "Not scored"}</span>
            <span className="text-[18px] font-bold tabular-nums" style={score != null ? { color: scoreColor(score) } : undefined}>
              {score != null ? `${score}/100` : "Unavailable"}
            </span>
          </div>
        </div>
        {criterion.rubric?.description && (
          <p className="mt-1.5 text-[11px] italic leading-relaxed text-muted-foreground/70">{criterion.rubric.description}</p>
        )}
      </div>

      <div className="space-y-3 p-3">
        {(feedback?.grounded_praise || feedback?.main_gap) && (
          <section className="space-y-2 rounded-lg border border-info/20 bg-info/5 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-info">What is working</div>
            {feedback?.grounded_praise && (
              <p className="text-[12px] leading-relaxed text-foreground/90">{feedback.grounded_praise}</p>
            )}
            {feedback?.main_gap && (
              <div className="border-t border-info/15 pt-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-warning">Main gap</div>
                <p className="mt-1 text-[12px] leading-relaxed">{feedback.main_gap}</p>
              </div>
            )}
          </section>
        )}

        {!!related.length && (
          <section className="rounded-lg border border-success/20 bg-success/5 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-success">Related revision</div>
            {related.map((priority) => (
              <a key={priority.id} href={`#${priority.id}`} className="mt-1 block text-[12px] font-semibold text-info hover:underline">
                {priority.title}
              </a>
            ))}
          </section>
        )}

        {!!criterion.answers?.length && (
          <details className="rounded-lg border border-border bg-accent/15 p-3">
            <summary className="cursor-pointer text-[11px] font-semibold text-foreground">
              How this was evaluated
            </summary>
            <div className="mt-2 space-y-2">
              {criterion.answers.map((answer) => (
                <div key={answer.question_id} className="rounded-md bg-background p-2 text-[11px] leading-relaxed">
                  <div className="font-semibold">{answer.question}</div>
                  <div className="mt-0.5 text-muted-foreground">
                    {answer.answer_label} · {Math.round((criterion.normalized_question_weights?.[answer.question_id || ""] ?? 0) * 100)}% of this criterion
                  </div>
                  {answer.explanation && <p className="mt-1">{answer.explanation}</p>}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

function DraftProgressSection({ review }: { review: EssayReviewResult }) {
  const progress = review.draft_progress;
  if (!progress?.has_previous_draft) {
    return (
      <section className="rounded-xl border border-border bg-background p-3 text-[11px] text-muted-foreground">
        Draft progress will appear after your next evaluated revision.
      </section>
    );
  }
  const changes = (progress.criterion_changes ?? []).filter(
    (change) => change.level_changed || change.previous_gap_changed || change.score_change,
  );
  return (
    <section className="rounded-xl border border-border bg-background p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-info">Draft progress</div>
      <div className="mt-1 text-[12px]">
        Overall {Number(progress.overall_change) > 0 ? `improved by ${progress.overall_change}` : Number(progress.overall_change) < 0 ? `changed by ${progress.overall_change}` : "level is stable"}.
        {!!progress.resolved_gap_count && ` ${progress.resolved_gap_count} previous gap${progress.resolved_gap_count === 1 ? "" : "s"} changed or resolved.`}
      </div>
      {!!changes.length && (
        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {changes.slice(0, 6).map((change) => (
            <div key={change.criterion}>
              <span className="font-semibold text-foreground">{change.label}: </span>
              {change.previous_level} → {change.current_level}
              {change.previous_level === change.current_level && change.previous_gap_changed ? " · previous gap addressed" : ""}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function UnifiedEssayReview({
  review,
  updatedAt,
  draftChanged,
  now,
  onRevealPriority,
  revisionCoachStates,
  onRequestRevisionCoach,
  onApplyRevisionCoach,
  onDismissRevisionCoach,
}: {
  review: EssayReviewResult;
  updatedAt: number | null;
  draftChanged: boolean;
  now: number;
  onRevealPriority: (priority: EssayRevisionPriority) => void;
  revisionCoachStates: Record<string, RevisionCoachUiState>;
  onRequestRevisionCoach: (priority: EssayRevisionPriority) => void;
  onApplyRevisionCoach: (
    priority: EssayRevisionPriority,
    result: RevisionCoachResult,
    replacement: string,
  ) => void;
  onDismissRevisionCoach: (priority: EssayRevisionPriority) => void;
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
  const score = typeof review.overall_score === "number" ? review.overall_score : null;
  const scoredVersions = (user?.drafts ?? []).filter((version) => typeof version.reviewOverall === "number");
  const priorities = review.revision_priorities ?? review.revision_plan?.priorities ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <div className="text-muted-foreground">Last updated: {relativeTimeLabel(updatedAt, now)}</div>
        {draftChanged && (
          <>
            <span className="text-border" aria-hidden="true">•</span>
            <div className="font-medium text-warning">Essay changed since this review.</div>
          </>
        )}
      </div>

      <OverallEssayScoreCard score={score} level={review.overall_level} versions={scoredVersions} />

      {review.status === "scoring_success_coaching_partial" && (
        <section role="status" className="rounded-xl border border-warning/25 bg-warning/5 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-warning">
                Revision priorities unavailable
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">
                {review.status_message || "Your evaluation scores were verified, but revision priorities could not be safely completed."}
              </p>
              {import.meta.env.DEV && !!review.diagnostics?.error_codes?.length && (
                <details className="mt-2 text-[10px] text-muted-foreground">
                  <summary className="cursor-pointer font-semibold">Evaluation diagnostics</summary>
                  <div className="mt-1">
                    Stage: {review.diagnostics.failure_stage || "coaching"} · Codes: {review.diagnostics.error_codes.join(", ")}
                  </div>
                </details>
              )}
            </div>
          </div>
        </section>
      )}

      <RevisionPrioritiesSection
        priorities={priorities}
        onRevealPriority={onRevealPriority}
        revisionCoachStates={revisionCoachStates}
        onRequestRevisionCoach={onRequestRevisionCoach}
        onApplyRevisionCoach={onApplyRevisionCoach}
        onDismissRevisionCoach={onDismissRevisionCoach}
      />

      <div className="overflow-hidden rounded-xl border border-border bg-border">
        <div className="grid grid-cols-6 gap-px border-b border-border">
          <div className="col-span-3 bg-secondary/70 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-info">
            Content
          </div>
          <div className="bg-secondary/70 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-info">
            Structure
          </div>
          <div className="col-span-2 bg-secondary/70 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-info">
            Voice
          </div>
        </div>
        <div className="grid grid-cols-6 gap-px">
          {ESSAY_REVIEW_DIMENSIONS.map((key, index) => {
            const criterion = criteriaByKey[key];
            if (!criterion) return null;
            return (
              <CriterionScoreButton
                key={key}
                criterion={criterion}
                selected={selectedCriterionKey === key}
                onSelect={() => setSelectedCriterionKey(key)}
                edge={index === 0 ? "left" : index === ESSAY_REVIEW_DIMENSIONS.length - 1 ? "right" : undefined}
              />
            );
          })}
        </div>
      </div>

      {selectedCriterion && <CriterionReviewDetails criterion={selectedCriterion} priorities={priorities} />}
      <DraftProgressSection review={review} />
    </div>
  );
}

function WorkspaceEssayReviewTab({
  review,
  runError,
  loading,
  updatedAt,
  draftChanged,
  now,
  onRevealPriority,
  revisionCoachStates,
  onRequestRevisionCoach,
  onApplyRevisionCoach,
  onDismissRevisionCoach,
}: {
  review: EssayReviewResult | null;
  runError: string | null;
  loading: boolean;
  updatedAt: number | null;
  draftChanged: boolean;
  now: number;
  onRevealPriority: (priority: EssayRevisionPriority) => void;
  revisionCoachStates: Record<string, RevisionCoachUiState>;
  onRequestRevisionCoach: (priority: EssayRevisionPriority) => void;
  onApplyRevisionCoach: (
    priority: EssayRevisionPriority,
    result: RevisionCoachResult,
    replacement: string,
  ) => void;
  onDismissRevisionCoach: (priority: EssayRevisionPriority) => void;
}) {
  if (loading) {
    return (
      <CoachSkeleton />
    );
  }
  if (!review) {
    return (
      <PanelEmpty
        message={runError || "No review yet. Click “Evaluate” in the top-right corner to review your essay."}
      />
    );
  }
  if (!isCompleteEssayReview(review)) {
    return <PanelEmpty message={runError || review.status_message || "The evaluation could not be completed."} />;
  }
  return (
    <div className="space-y-3">
      {runError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3 text-[11px] leading-relaxed text-foreground">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>{runError}</span>
        </div>
      )}
      <UnifiedEssayReview
        review={review}
        updatedAt={updatedAt}
        draftChanged={draftChanged}
        now={now}
        onRevealPriority={onRevealPriority}
        revisionCoachStates={revisionCoachStates}
        onRequestRevisionCoach={onRequestRevisionCoach}
        onApplyRevisionCoach={onApplyRevisionCoach}
        onDismissRevisionCoach={onDismissRevisionCoach}
      />
    </div>
  );
}

function OverallEssayScoreCard({ score, level, versions }: { score: number | null; level?: string; versions: EssayDraft[] }) {
  const scored = versions.filter((v) => typeof v.reviewOverall === "number");
  const latest = scored[scored.length - 1] ?? null;
  const prev = scored.length > 1 ? scored[scored.length - 2] : null;
  const overall = score ?? latest?.reviewOverall ?? null;
  const overallDelta = prev && overall != null ? overall - (prev.reviewOverall ?? 0) : null;
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={overall == null ? "Overall essay score unavailable" : `Overall essay score ${overall} out of 100`}
              className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
            >
              <ScoreRing score={overall} />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="start"
            sideOffset={7}
            className="w-72 max-w-[calc(100vw-2rem)] p-3 text-left"
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground/70">
              {overall == null ? "Essay score: unavailable" : `Essay score: ${overall}/100`}
            </div>
            <div className="mt-1.5 text-[11px] leading-relaxed text-primary-foreground/85">
              {overall == null
                ? "Your overall score will be calculated using criteria weights tailored for this scholarship and essay prompt."
                : "Overall score calculated based on criteria weights tailored for this scholarship and essay prompt."}
            </div>
          </TooltipContent>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div>
              <div className="text-[13px] font-semibold">Overall essay score</div>
              {level && <div className="text-[11px] font-semibold text-info">{level}</div>}
            </div>
            {prev && overallDelta != null ? (
              <span
                className="text-[11px] font-semibold"
                style={{
                  color: overallDelta > 0
                    ? "var(--success)"
                    : overallDelta < 0
                      ? "var(--destructive)"
                      : "var(--muted-foreground)",
                }}
              >
                {overallDelta > 0
                  ? `▲ +${overallDelta} since Draft ${prev.version}`
                  : overallDelta < 0
                    ? `▼ ${overallDelta} since Draft ${prev.version}`
                    : `No change since Draft ${prev.version}`}
              </span>
            ) : latest ? (
              <span className="text-[11px] font-medium text-muted-foreground">First scored draft</span>
            ) : null}
          </div>
          {latest && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              Draft {latest.version} · {latest.wordCount} words · {scored.length} scored draft{scored.length === 1 ? "" : "s"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SuggestionCard({
  s,
  onAccept,
  onDismiss,
  onReveal,
  onAddToDictionary,
}: {
  s: Suggestion;
  onAccept: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
  onReveal: (s: Suggestion) => void;
  onAddToDictionary: (s: Suggestion) => void;
}) {
  const meta = CATEGORY_META[s.category];
  const [copied, setCopied] = useState(false);
  const canReplace = s.replacementAvailable !== false && s.replacement.length > 0;
  const canAddToDictionary = s.engineSource === "language_tool"
    && s.suggestionType?.startsWith("spelling")
    && /^\p{L}[\p{L}'’-]*$/u.test(s.original.trim());
  const possibleName = s.suggestionType === "spelling_name";
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
    <div
      className={`cursor-pointer rounded-lg border border-l-4 border-border bg-background p-2.5 ${meta.borderClass}`}
      onClick={(event) => {
        // Preserve the dedicated Accept/Ignore/dictionary/copy actions while
        // letting the card padding and other non-action surface reveal the fix.
        const target = event.target;
        if (!(target instanceof Element) || !target.closest("button")) onReveal(s);
      }}
    >
      <button type="button" onClick={() => onReveal(s)} className="block w-full text-left" title="Jump to this text in the editor">
        <div className="flex items-center gap-1.5">
          <span className={`text-[11px] font-semibold ${meta.textClass}`}>{s.title}</span>
          {s.source === "coach" && s.severity && (
            <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{s.severity}</span>
          )}
        </div>
        {canReplace ? (
          <div className="mt-1 text-[12px]">
            <span className="text-muted-foreground line-through decoration-muted-foreground/50">{s.original.trim() || "␠"}</span>
            <span className="mx-1 text-muted-foreground">→</span>
            <span className="font-medium text-foreground">{s.replacement.trim() || "(removed)"}</span>
          </div>
        ) : (
          <div className="mt-1 text-[12px] font-medium text-foreground">{s.original.trim()}</div>
        )}
        {s.source === "coach" && s.explanation && (
          <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{s.explanation}</div>
        )}
      </button>
      <div className="mt-2 flex items-center gap-1.5">
        {canReplace && (
          <button
            type="button"
            onClick={() => onAccept(s)}
            className={`flex-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              possibleName
                ? "border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                : "bg-info text-white hover:opacity-90"
            }`}
          >
            {possibleName ? "Use suggestion" : "Accept"}
          </button>
        )}
        <button type="button" onClick={() => onDismiss(s)} className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          Ignore
        </button>
        {canAddToDictionary && (
          <button
            type="button"
            onClick={() => onAddToDictionary(s)}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              possibleName
                ? "border-info bg-info text-white hover:opacity-90"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            Add word
          </button>
        )}
        {canReplace && (
          <button
            type="button"
            onClick={copy}
            title="Copy suggested text"
            aria-label="Copy suggested text"
            className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          </button>
        )}
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
  onAddToDictionary,
  fixesLoading,
  fixesWarning,
}: {
  isEvaluating: boolean;
  suggestions: Suggestion[];
  onAccept: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
  onReveal: (s: Suggestion) => void;
  onAddToDictionary: (s: Suggestion) => void;
  fixesLoading: boolean;
  fixesWarning: string | null;
}) {
  const counts = countByCategory(suggestions);

  if (isEvaluating) return <HighlightsSkeleton />;

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-semibold text-muted-foreground">{suggestions.length} open</div>

      {fixesLoading && !suggestions.length && <HighlightsSkeleton />}

      {fixesWarning && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {fixesWarning}
        </div>
      )}

      {!fixesLoading && !suggestions.length && (
        <div className="rounded-xl border border-dashed border-border bg-background p-4 text-[13px] leading-relaxed text-muted-foreground">
          No fixes found. Fixes update automatically as you type.
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
              <SuggestionCard
                key={s.id}
                s={s}
                onAccept={onAccept}
                onDismiss={onDismiss}
                onReveal={onReveal}
                onAddToDictionary={onAddToDictionary}
              />
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

/* ---------------- Step 5: Application Dashboard ---------------- */

function StepApplicationDashboard({ onNavigate }: { onNavigate: (slug: string) => void }) {
  const { user } = useUser();
  const scholarshipName = user?.activeScholarship?.name || "Your current scholarship";
  const submission = useSubmissionReadiness();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Application Dashboard
        </h1>
        <p className="mt-2 text-sm font-medium text-foreground">{scholarshipName}</p>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Review your saved versions, complete your submission checklist, and track the application.
        </p>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <VersionHistorySection onNavigate={onNavigate} />
        <SubmissionSummarySection submission={submission} onNavigate={onNavigate} />
      </div>
      <FinalChecklistSection submission={submission} onNavigate={onNavigate} />
      <ApplicationStatusSection />
    </div>
  );
}

function VersionHistorySection({ onNavigate }: { onNavigate: (slug: string) => void }) {
  const { user, updateProfile } = useUser();
  const drafts = user?.drafts ?? [];
  const current = user?.essayDraft ?? "";

  function addVersion() {
    if (!current.trim()) return;
    const nextVersion = (drafts[drafts.length - 1]?.version ?? 0) + 1;
    const wc = current.trim() ? current.trim().split(/\s+/).length : 0;
    const next: EssayDraft = {
      id: crypto.randomUUID(),
      version: nextVersion,
      content: current,
      wordCount: wc,
      savedAt: new Date().toISOString(),
      scholarshipName: user?.activeScholarship?.name,
      reviewOverall: user?.essayReviewResult?.overall_score ?? undefined,
      reviewOverallLevel: user?.essayReviewResult?.overall_level,
    };
    updateProfile({ drafts: [...drafts, next] });
  }

  function openVersion(version: EssayDraft) {
    updateProfile({ essayDraft: version.content });
    onNavigate("essay-workspace");
  }

  function deleteVersion(id: string) {
    updateProfile({ drafts: drafts.filter((draft) => draft.id !== id) });
  }

  const currentVersionId = [...drafts].reverse().find((draft) => draft.content === current)?.id;

  return (
    <section aria-labelledby="version-history-heading">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="version-history-heading" className="font-display text-xl font-semibold">
              Version History
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Open any saved version in the Essay Workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={addVersion}
            disabled={!current.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            <Plus className="size-4" />
            Save current as new version
          </button>
        </div>

        {drafts.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
            No versions saved yet. Save your current Essay Workspace draft to begin version history.
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {drafts.map((d) => {
              const isCurrent = d.id === currentVersionId;
              const preview = d.content.replace(/\s+/g, " ").trim();
              const title = d.scholarshipName || "Scholarship essay";
              return (
                <div key={d.id} className="relative min-w-0">
                  <button
                    type="button"
                    onClick={() => openVersion(d)}
                    className={`flex min-h-[190px] w-full min-w-0 flex-col rounded-xl border p-4 pb-11 text-left transition-colors ${
                      isCurrent ? "border-info/40 bg-info/5" : "border-border hover:bg-accent/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-display text-base font-semibold">Version {d.version}</div>
                      {isCurrent && <Pill tone="info">Current</Pill>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{new Date(d.savedAt).toLocaleString()}</span>
                      <span>{d.wordCount} words</span>
                      {typeof d.reviewOverall === "number" && (
                        <span className="font-medium text-info">{d.reviewOverall}/100</span>
                      )}
                    </div>
                    <div className="mt-3 truncate text-sm font-semibold text-foreground">{title}</div>
                    <p className="mt-1 line-clamp-3 text-xs leading-5 text-foreground/70">
                      {preview || "Empty version"}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteVersion(d.id)}
                    className="absolute bottom-3 right-3 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
                    aria-label={`Delete Version ${d.version}`}
                  >
                    Delete draft
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </section>
  );
}

function useSubmissionReadiness() {
  const { user } = useUser();
  const review = user?.essayReviewResult?.schema_version === 5 ? user.essayReviewResult : null;
  const docs = user?.documents ?? [];
  const hasDoc = (kind: string) => docs.some((doc) => doc.kind.toLowerCase().includes(kind));
  const [zipping, setZipping] = useState(false);
  const [zipStatus, setZipStatus] = useState<string | null>(null);

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

  return {
    checklist,
    done,
    percent,
    allDone,
    nextIncomplete,
    zipping,
    zipStatus,
    downloadSubmissionZip,
  };
}

type SubmissionReadinessState = ReturnType<typeof useSubmissionReadiness>;

function SubmissionSummarySection({
  submission,
  onNavigate,
}: {
  submission: SubmissionReadinessState;
  onNavigate: (slug: string) => void;
}) {
  const {
    checklist,
    done,
    percent,
    allDone,
    nextIncomplete,
    zipping,
    zipStatus,
    downloadSubmissionZip,
  } = submission;

  return (
    <section aria-labelledby="submission-readiness-heading">
      <Card className="border-primary/20 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="submission-readiness-heading" className="font-display text-xl font-semibold">
              Submission Readiness
            </h2>
            <div className="mt-2 text-sm font-semibold">
              {done} of {checklist.length} complete
            </div>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            allDone ? "bg-success/15 text-success" : "bg-warning/15 text-foreground"
          }`}>
            {percent}%
          </span>
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className={`h-full transition-[width] duration-500 ${allDone ? "bg-success" : "bg-warning"}`}
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="mt-4 rounded-xl bg-secondary/55 px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Next required action
          </div>
          <div className="mt-1 text-sm font-medium">
            {nextIncomplete?.item || "All submission requirements are complete."}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!allDone && nextIncomplete && (
            <button
              type="button"
              onClick={() => onNavigate(nextIncomplete.targetSlug)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Fix next
              <ArrowRight className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void downloadSubmissionZip()}
            disabled={zipping}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            <Download className="size-3.5" />
            {zipping ? "Zipping…" : "Download as ZIP"}
          </button>
        </div>
        {zipStatus && <p className="mt-3 text-xs leading-5 text-muted-foreground" role="status">{zipStatus}</p>}
      </Card>
    </section>
  );
}

function FinalChecklistSection({
  submission,
  onNavigate,
}: {
  submission: SubmissionReadinessState;
  onNavigate: (slug: string) => void;
}) {
  const { checklist, allDone } = submission;

  return (
    <section aria-labelledby="final-checklist-heading">
      <Card className="p-5 sm:p-6">
        <div>
          <h2 id="final-checklist-heading" className="font-display text-xl font-semibold">
            Final Checklist
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Complete each required item before submitting your application.
          </p>
        </div>
        <ul className="mt-3 divide-y divide-border">
          {checklist.map((item) => {
            const canUpload = !!item.documentKind && !item.done;
            const canNavigate = !item.done && !canUpload;
            return (
              <li key={item.item} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-2.5 sm:flex-nowrap">
                <div className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md ${item.done ? "bg-success text-white" : "border-2 border-warning"}`}>
                  {item.done && <Check className="size-3.5" strokeWidth={3} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${item.done ? "" : "font-medium text-foreground"}`}>{item.item}</div>
                  {!item.done && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.hint}</p>}
                </div>
                {!item.done && (
                  <div className="ml-8 flex w-full shrink-0 items-center justify-end gap-2 sm:ml-0 sm:w-auto">
                    <Pill tone="warn">action needed</Pill>
                    {canUpload && (
                      <button
                        type="button"
                        onClick={() => onNavigate(item.targetSlug)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      >
                        <FileUp className="size-3.5" /> Upload
                      </button>
                    )}
                    {canNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate(item.targetSlug)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label={`Go to ${item.item}`}
                      >
                        <ChevronRight className="size-4" />
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {allDone && (
          <div className="mt-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm font-medium text-success">
            Ready to submit — all checks passed.
          </div>
        )}
      </Card>
    </section>
  );
}

function ApplicationStatusSection() {
  const { user, updateProfile } = useUser();
  const scholarship = user?.activeScholarship;
  const review = user?.essayReviewResult?.schema_version === 5 ? user.essayReviewResult : null;
  const currentScore = typeof review?.overall_score === "number" ? review.overall_score : undefined;
  const applications = useMemo(() => user?.applications ?? [], [user?.applications]);
  const [openColumn, setOpenColumn] = useState<ApplicationStatus | null>(null);

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

  const drafting = applications.filter((application) => application.status === "Drafting");
  const submitted = applications.filter((application) => application.status === "Submitted");
  const awarded = applications.filter((application) => application.status === "Awarded");
  const pipeline: Array<{ status: ApplicationStatus; items: TrackedApplication[] }> = [
    { status: "Drafting", items: drafting },
    { status: "Submitted", items: submitted },
    { status: "Awarded", items: awarded },
  ];

  return (
    <section aria-labelledby="application-status-heading" className="space-y-4">
      <div>
        <h2 id="application-status-heading" className="font-display text-xl font-semibold">
          Application Status
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Track each application from drafting through award decisions.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {pipeline.map((column) => <StatusColumn key={column.status} status={column.status} items={column.items} onViewAll={() => setOpenColumn(column.status)} />)}
      </div>

      <Dialog open={openColumn !== null} onOpenChange={(open) => !open && setOpenColumn(null)}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle className="font-display text-xl">{openColumn}</DialogTitle><DialogDescription>{openColumn ? pipeline.find((column) => column.status === openColumn)?.items.length : 0} applications</DialogDescription></DialogHeader><div className="max-h-80 space-y-2 overflow-y-auto">{openColumn && pipeline.find((column) => column.status === openColumn)?.items.map((application) => <div key={application.id} className="rounded-lg border border-border p-3"><div className="truncate text-sm font-medium">{application.name}</div><div className="mt-2 flex items-center gap-2">{application.status === "Drafting" && <button type="button" onClick={() => updateStatus(application.id, "Submitted")} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"><Send className="size-3" /> Mark submitted</button>}{application.status === "Submitted" && <button type="button" onClick={() => updateStatus(application.id, "Awarded")} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"><ShieldCheck className="size-3" /> Mark awarded</button>}</div></div>)}</div></DialogContent>
      </Dialog>
    </section>
  );
}

function StatusColumn({ status, items, onViewAll }: { status: ApplicationStatus; items: TrackedApplication[]; onViewAll: () => void }) {
  const tone = status === "Drafting" ? "bg-warning/15 text-warning" : status === "Submitted" ? "bg-info/15 text-info" : "bg-success/15 text-success";
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{status}</h3>
        <span className={`rounded-full px-2.5 py-0.5 font-mono text-xs ${tone}`}>{items.length}</span>
      </div>
      {items.length > 0 ? (
        <>
          <ul className="mt-3 space-y-2">
            {items.slice(0, 2).map((application) => (
              <li key={application.id} className="truncate rounded-lg bg-secondary/50 px-3 py-2 text-sm">
                {application.name}
              </li>
            ))}
          </ul>
          <button type="button" onClick={onViewAll} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-foreground hover:text-info">
            View all <ChevronRight className="size-3.5" />
          </button>
        </>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">No applications in this status.</p>
      )}
    </Card>
  );
}
