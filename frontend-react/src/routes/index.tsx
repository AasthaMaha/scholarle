import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Award, Check, ChevronDown, ChevronLeft, ChevronRight, FileText, Folder, ListChecks, Search, Sparkles, UserRound } from "lucide-react";
import scholarELogoUrl from "../../logo/logoPic.jpeg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Scholar-E — Win scholarships in your own voice" },
      { name: "description", content: "One intelligent workspace to discover scholarships, understand requirements, strengthen your writing, and submit with confidence." },
      { property: "og:title", content: "Scholar-E — Your scholarship journey, connected" },
      { property: "og:description", content: "Find the right opportunities and build stronger applications without giving up your voice." },
    ],
  }),
  component: Landing,
});

const stages = [
  { id: "profile", label: "Profile", eyebrow: "Know your story", title: "Your context, ready once.", copy: "Scholar-E learns your goals, experience, and strengths—then carries them through every application." },
  { id: "discover", label: "Discover", eyebrow: "Find the right fit", title: "Opportunities worth your time.", copy: "See scholarships matched to your profile, with the award, deadline, and fit made clear." },
  { id: "analyze", label: "Analyze", eyebrow: "Know before you apply", title: "Every requirement, understood.", copy: "Turn dense application pages into a clean, verifiable checklist before you commit." },
  { id: "write", label: "Write", eyebrow: "A coach beside you", title: "Stronger writing. Still yours.", copy: "Get specific, sentence-level guidance that helps you revise without writing the essay for you." },
  { id: "submit", label: "Submit", eyebrow: "Finish with confidence", title: "Nothing important gets missed.", copy: "Scholar-E checks your materials, limits, and deadline so you know exactly what is ready." },
] as const;

function Landing() {
  return (
    <div className="scholar-landing min-h-screen w-full max-w-full overflow-x-hidden bg-white text-[#111b36]">
      <Header />
      <main><Hero /><Workflow /><Benefits /><FinalCTA /></main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[#111b36]/[.07] bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 lg:px-8">
        <Link to="/" aria-label="Scholar-E home" className="group flex items-center gap-2.5">
          <img src={scholarELogoUrl} alt="" className="size-8 rounded-full object-cover transition-transform group-hover:-rotate-6" />
          <span className="text-[17px] font-bold tracking-[-.03em]">Scholar-E</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-medium text-[#5e6578] md:flex" aria-label="Main navigation">
          <a href="#workflow" className="transition-colors hover:text-[#111b36]">How it works</a>
          <a href="#benefits" className="transition-colors hover:text-[#111b36]">Why Scholar-E</a>
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link to="/auth" className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-[#4b5368] transition-colors hover:text-[#111b36] sm:block">Sign in</Link>
          <Link to="/auth" className="group inline-flex items-center gap-2 rounded-xl bg-[#111b36] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-10px_#111b36] transition-all hover:-translate-y-0.5 hover:bg-[#202d50]">
            Get started <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative px-5 pb-10 pt-24 lg:px-8 lg:pb-12 lg:pt-28">
      <div className="hero-glow absolute left-1/2 top-20 -z-10 h-[480px] w-[760px] -translate-x-1/2 rounded-full opacity-80 blur-3xl" />
      <div className="relative mx-auto max-w-[1120px] text-center">
        <HeroFloaters />
        <div className="relative z-10">
        <div className="reveal-up mx-auto inline-flex items-center gap-2 rounded-full border border-[#7567f8]/20 bg-[#f7f5ff] px-3.5 py-1.5 text-xs font-semibold text-[#5d50cf] shadow-sm">
          <Sparkles className="size-3.5" /> Personalized guidance that keeps you the author
        </div>
        <h1 className="reveal-up delay-1 mx-auto mt-7 max-w-[930px] text-balance text-[clamp(3.2rem,6.9vw,6.65rem)] font-bold leading-[.91] tracking-[-.067em]">
          Win scholarships<br /><span className="hero-voice">in your own voice.</span>
        </h1>
        <p className="reveal-up delay-2 mx-auto mt-7 max-w-[620px] text-balance text-lg leading-8 text-[#5b6377] md:text-xl">
          One intelligent workspace to find the right opportunities, build stronger applications, and submit with confidence.
        </p>
        <div className="reveal-up delay-3 mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/journey" className="button-lift group inline-flex items-center gap-2 rounded-xl bg-[#6757e8] px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_35px_-14px_#6757e8]">
            Start your journey <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <a href="#workflow" className="inline-flex items-center gap-2 rounded-xl border border-[#dcdde4] bg-white px-6 py-3.5 text-sm font-bold text-[#202a46] shadow-sm transition-all hover:border-[#b9b5df] hover:shadow-md">See it in action <ChevronDown className="size-4" /></a>
        </div>
        </div>
      </div>
    </section>
  );
}

function HeroFloaters() {
  return (
    <div aria-hidden="true" className="hero-floaters pointer-events-none absolute inset-0">
      <div className="hero-icon-pair hero-pair-profile-document">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M 89 31 C 98 41, 90 55, 69 67" />
        </svg>
        <div className="hero-orbit-icon hero-orbit-profile">
          <UserRound strokeWidth={1.45} />
          <span className="hero-orbit-success"><Check /></span>
        </div>
        <div className="hero-orbit-icon hero-orbit-document">
          <FileText strokeWidth={1.45} />
        </div>
      </div>
      <div className="hero-orbit-icon hero-orbit-folder">
        <Folder strokeWidth={1.45} />
      </div>
      <svg className="hero-tail-connector hero-tail-right-head" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M 30 18 C 34 43, 51 66, 72 82" />
      </svg>
      <div className="hero-icon-pair hero-pair-search-checklist">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M 38 35 C 27 42, 20 51, 27 62" />
        </svg>
        <div className="hero-orbit-icon hero-orbit-search">
          <Search strokeWidth={1.45} />
        </div>
        <div className="hero-orbit-icon hero-orbit-checklist">
          <ListChecks strokeWidth={1.45} />
        </div>
      </div>
      <div className="hero-orbit-icon hero-orbit-award">
        <Award strokeWidth={1.45} />
      </div>
      <div className="hero-orbit-icon hero-orbit-sparkle">
        <Sparkles strokeWidth={1.35} />
      </div>
      <svg className="hero-tail-connector hero-tail-left" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M 27 20 C 29 38, 44 57, 72 74" />
      </svg>
      <svg className="hero-tail-connector hero-tail-right" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M 76 20 C 72 35, 64 45, 51 48 C 39 51, 31 60, 30 71" />
      </svg>
      <span className="hero-accent hero-accent-one">+</span>
      <span className="hero-accent hero-accent-two">+</span>
      <span className="hero-accent hero-accent-three">·</span>
    </div>
  );
}

function WindowShell({ children, progress = 0.22 }: { children: React.ReactNode; progress?: number }) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-[#1a2440]/10 bg-white shadow-[0_35px_90px_-34px_rgba(24,31,57,.35)]">
      <div className="flex h-10 items-center border-b border-[#1b2440]/10 bg-[#f8f8fa] px-4">
        <div className="flex gap-1.5"><i className="size-2.5 rounded-full bg-[#d9d9df]" /><i className="size-2.5 rounded-full bg-[#d9d9df]" /><i className="size-2.5 rounded-full bg-[#d9d9df]" /></div>
        <div className="mx-auto rounded-md border border-[#e2e2e7] bg-white px-14 py-1 font-mono text-[8px] text-[#858b99] sm:px-24">app.scholar-e.com</div>
      </div>
      <div className="h-1 bg-[#eeeef3]"><div className="h-full bg-[#7464ef] transition-all duration-700" style={{ width: `${progress * 100}%` }} /></div>
      {children}
    </div>
  );
}

function Workflow() {
  const carouselRef = useRef<HTMLDivElement>(null);
  const interactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeStartRef = useRef<number | null>(null);
  const autoplayStartedRef = useRef(false);
  const [active, setActive] = useState(0);
  const [visited, setVisited] = useState(() => new Set([0]));
  const [hovered, setHovered] = useState(false);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const [resumeNow, setResumeNow] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(media.matches);
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible");
    updateMotion(); updateVisibility();
    media.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      media.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
      if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.25 },
    );
    observer.observe(carousel);
    return () => observer.disconnect();
  }, []);

  const showSlide = useCallback((index: number, manual = false) => {
    const next = Math.max(0, Math.min(stages.length - 1, index));
    setActive(next);
    setVisited((current) => new Set(current).add(next));
    if (manual) {
      autoplayStartedRef.current = true;
      setAnnouncement(`Step ${next + 1} of ${stages.length}: ${stages[next].label}`);
      setManuallyPaused(true);
      setResumeNow(false);
      if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
      interactionTimerRef.current = setTimeout(() => {
        setManuallyPaused(false);
        setResumeNow(true);
      }, 6000);
    }
  }, []);

  useEffect(() => {
    if (!resumeNow || reducedMotion || hovered || !pageVisible || !inView) return;
    setResumeNow(false);
    showSlide((active + 1) % stages.length);
  }, [active, hovered, inView, pageVisible, reducedMotion, resumeNow, showSlide]);

  useEffect(() => {
    if (resumeNow || reducedMotion || hovered || manuallyPaused || !pageVisible || !inView) return;
    const delay = autoplayStartedRef.current ? 4500 : 2750;
    const timer = window.setTimeout(() => {
      autoplayStartedRef.current = true;
      showSlide((active + 1) % stages.length);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [active, hovered, inView, manuallyPaused, pageVisible, reducedMotion, resumeNow, showSlide]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); showSlide(active - 1, true); }
    if (event.key === "ArrowRight") { event.preventDefault(); showSlide(active + 1, true); }
  };

  return (
    <section id="workflow" className="scroll-mt-16 bg-[#fbfbfd] px-5 pb-20 pt-10 lg:px-8 lg:pb-28 lg:pt-12">
      <div
        ref={carouselRef}
        role="region"
        aria-roledescription="carousel"
        aria-label="Scholar-E scholarship workflow"
        className="mx-auto max-w-[1200px]"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => { swipeStartRef.current = event.clientX; }}
        onPointerUp={(event) => {
          if (swipeStartRef.current === null) return;
          const distance = event.clientX - swipeStartRef.current;
          swipeStartRef.current = null;
          if (Math.abs(distance) > 45) showSlide(active + (distance < 0 ? 1 : -1), true);
        }}
        onPointerCancel={() => { swipeStartRef.current = null; }}
      >
        <div className="grid items-center gap-9 lg:grid-cols-[.72fr_1.45fr] lg:gap-16">
          <div className="relative z-10 min-h-[280px] lg:min-h-[330px]">
            <div key={`copy-${active}`} className="carousel-copy-in">
              <div className="text-xs font-bold uppercase tracking-[.14em] text-[#7164df]">0{active + 1} / 05 · {stages[active].eyebrow}</div>
              <h3 className="mt-4 text-balance text-[clamp(2.35rem,4.1vw,4.2rem)] font-bold leading-[.98] tracking-[-.055em]">{stages[active].title}</h3>
              <p className="mt-5 max-w-md text-base leading-7 text-[#626a7e] md:text-lg">{stages[active].copy}</p>
              <div className="mt-7 flex items-center gap-2 text-sm font-bold text-[#27314c]"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#eeeaff] text-[#6757e8]"><Check className="size-3.5" /></span>{["One profile for every application", "Fit explained, not guessed", "Sources stay visible", "Feedback—not ghostwriting", "A clear next step"][active]}</div>
            </div>
          </div>
          <WorkflowWindow
            active={active}
            onPrevious={() => showSlide(active - 1, true)}
            onNext={() => showSlide(active + 1, true)}
          />
        </div>

        <div className="mx-auto mt-8 max-w-[720px]" aria-label="Choose a workflow step">
          <div className="relative flex items-start justify-between before:absolute before:left-[7%] before:right-[7%] before:top-3 before:h-px before:bg-[#dcdde4]">
            {stages.map((stage, index) => (
              <button
                key={stage.id}
                type="button"
                aria-label={`Go to step ${index + 1}: ${stage.label}`}
                aria-current={active === index ? "step" : undefined}
                onClick={() => showSlide(index, true)}
                className="carousel-step group relative z-10 flex min-w-12 flex-col items-center gap-2 rounded-lg text-[10px] font-semibold text-[#7a8192] outline-none focus-visible:ring-2 focus-visible:ring-[#6757e8] focus-visible:ring-offset-4"
              >
                <span className={`grid size-6 place-items-center rounded-full border transition-all duration-300 ${active === index ? "border-[#6757e8] bg-[#6757e8] text-white shadow-[0_0_0_4px_#eeebff]" : visited.has(index) ? "border-[#aaa5cc] bg-white text-[#625a9c]" : "border-[#d4d5dc] bg-[#fbfbfd] text-[#8b91a0]"}`}>{visited.has(index) && index < active ? <Check className="size-3" /> : index + 1}</span>
                <span className={active === index ? "text-[#30285f]" : ""}>{stage.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>
      </div>
    </section>
  );
}

function WorkflowWindow({ active, onPrevious, onNext }: { active: number; onPrevious: () => void; onNext: () => void }) {
  return (
    <div className="relative min-w-0">
      <div className="absolute -inset-10 -z-10 rounded-full bg-[#7567ef]/[.08] blur-3xl" />
      <WorkflowFloaters active={active} />
      <button type="button" aria-label="Previous workflow step" onClick={onPrevious} disabled={active === 0} className="carousel-arrow absolute -left-5 top-1/2 z-20 hidden -translate-x-1/2 -translate-y-1/2 lg:grid"><ChevronLeft className="size-5" /></button>
      <div className="workflow-browser">
        <WindowShell progress={(active + 1) / 5}>
          <div className="min-h-[410px] overflow-hidden bg-[#fcfcfd] p-5 sm:min-h-[480px] sm:p-8">
            <div key={`scene-${active}`} className="carousel-preview-in">{active === 0 ? <ProfileScene /> : active === 1 ? <DiscoveryScene /> : active === 2 ? <AnalyzeScene /> : active === 3 ? <WritingScene /> : <SubmitScene />}</div>
          </div>
        </WindowShell>
      </div>
      <button type="button" aria-label="Next workflow step" onClick={onNext} disabled={active === stages.length - 1} className="carousel-arrow absolute -right-5 top-1/2 z-20 hidden translate-x-1/2 -translate-y-1/2 lg:grid"><ChevronRight className="size-5" /></button>
      <div className="mt-4 flex justify-center gap-3 lg:hidden">
        <button type="button" aria-label="Previous workflow step" onClick={onPrevious} disabled={active === 0} className="carousel-arrow"><ArrowLeft className="size-4" /></button>
        <button type="button" aria-label="Next workflow step" onClick={onNext} disabled={active === stages.length - 1} className="carousel-arrow"><ArrowRight className="size-4" /></button>
      </div>
    </div>
  );
}

const floaterStatuses = [
  { label: "Profile synced", tone: "complete" },
  { label: "Strong match", tone: "complete" },
  { label: "Requirements extracted", tone: "complete" },
  { label: "Voice preserved", tone: "coaching" },
  { label: "Ready to submit", tone: "complete" },
] as const;

function WorkflowFloaters({ active }: { active: number }) {
  const status = floaterStatuses[active];

  return (
    <div aria-hidden="true" className={`workflow-floaters pointer-events-none absolute inset-0 z-20 workflow-step-${active + 1}`}>
      <div key={`floater-a-${active}`} className="workflow-fragment workflow-fragment-primary">
        <WorkflowFragment active={active} variant="primary" />
      </div>
      <div key={`floater-b-${active}`} className="workflow-fragment workflow-fragment-secondary">
        <WorkflowFragment active={active} variant="secondary" />
      </div>
      <div key={`status-${active}`} className={`workflow-fragment-status workflow-fragment-status-${status.tone}`}>
        <span />
        {status.label}
      </div>
      <div key={`connector-${active}`} className={`workflow-fragment-connector fragment-connector-${active + 1}`}><i /></div>
    </div>
  );
}

function WorkflowFragment({ active, variant }: { active: number; variant: "primary" | "secondary" }) {
  if (active === 0) {
    return variant === "primary" ? (
      <div className="fragment-card fragment-profile">
        <div className="fragment-avatar"><span /><i>✓</i></div>
        <div><b>Student profile</b><small>12 details synced</small></div>
        <span className="fragment-meter"><i /></span>
      </div>
    ) : (
      <div className="fragment-file"><span className="fragment-file-fold" /><b>Resume.pdf</b><small>Added to profile</small><i className="fragment-file-check">✓</i></div>
    );
  }
  if (active === 1) {
    return variant === "primary" ? (
      <div className="fragment-card fragment-award">
        <span className="fragment-ribbon">$</span>
        <div><b>Future Leaders</b><small>$5,000 award</small></div>
        <strong>94%</strong>
      </div>
    ) : (
      <div className="fragment-bookmark"><i /><div><b>Saved</b><small>Deadline Oct 17</small></div></div>
    );
  }
  if (active === 2) {
    return variant === "primary" ? (
      <div className="fragment-card fragment-requirements">
        <b>Requirements</b>
        <span><i>✓</i> GPA 3.5+</span>
        <span><i>✓</i> Personal essay</span>
        <span><i>✓</i> Transcript</span>
      </div>
    ) : (
      <div className="fragment-eligibility"><span>✓</span><div><b>Eligible</b><small>4 of 4 verified</small></div></div>
    );
  }
  if (active === 3) {
    return variant === "primary" ? (
      <div className="fragment-card fragment-essay">
        <small>Essay draft</small>
        <span />
        <span className="fragment-highlight" />
        <span />
      </div>
    ) : (
      <div className="fragment-coach"><b>Coach note</b><p>Add one concrete moment.</p><span>Student decides</span></div>
    );
  }
  return variant === "primary" ? (
    <div className="fragment-card fragment-submit">
      <b>Submission check</b>
      <span><i>✓</i> Essay ready</span>
      <span><i>✓</i> Materials attached</span>
      <span><i>✓</i> Deadline confirmed</span>
    </div>
  ) : (
    <div className="fragment-deadline"><small>Deadline</small><b>OCT 17</b><span>Tracked</span></div>
  );
}

function SceneHead({ icon, kicker, title }: { icon: React.ReactNode; kicker: string; title: string }) { return <div className="scene-in flex items-center gap-3 border-b border-[#e7e7ec] pb-5"><div className="grid size-10 place-items-center rounded-xl bg-[#eeeaff] text-[#6757e8]">{icon}</div><div><div className="text-[9px] font-bold uppercase tracking-[.13em] text-[#858b9b]">{kicker}</div><h3 className="text-lg font-bold tracking-[-.03em] sm:text-xl">{title}</h3></div></div>; }
function ProfileScene() { return <><SceneHead icon={<UserRound className="size-5" />} kicker="Student profile" title="Tell us what makes you, you." /><div className="mt-5 flex items-center gap-3"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#ececf1]"><div className="profile-progress h-full rounded-full bg-[#6757e8]" /></div><span className="text-[10px] font-bold text-[#6258a8]">100%</span></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{[["First name","Maya"],["School","University of Houston"],["Field of study","Computer Science"],["GPA","3.8"]].map(([l,v],i)=><label key={l} className="profile-field text-[10px] font-bold text-[#72798a]" style={{animationDelay:`${i*.08}s`}}>{l}<span className="mt-1.5 flex items-center justify-between rounded-lg border border-[#dddde4] bg-white px-3 py-2.5 text-xs font-medium text-[#202a46]">{v}{i < 2 && <Check className="size-3 text-[#37866f]" />}</span></label>)}</div><div className="profile-confirm mt-5 rounded-xl border border-[#cce8df] bg-[#eff9f5] p-4 text-xs text-[#32755f]">✓ <strong>Profile complete.</strong> Twelve details are ready to personalize your matches.</div></>; }
function DiscoveryScene() { return <><SceneHead icon={<Search className="size-5" />} kicker="Scholarship discovery" title="4 new matches for your profile" /><div className="mt-6 space-y-3">{[["Future Leaders Scholarship","$5,000","94%"],["Community Impact Award","$2,500","89%"],["Women in STEM Grant","$8,000","87%"]].map(([t,a,f],i)=><div key={t} className={`discovery-result flex items-center justify-between rounded-xl border bg-white p-4 ${i === 0 ? "discovery-strong border-[#cfc9fa]" : "border-[#e4e4e9]"}`} style={{animationDelay:`${i*.11}s`}}><div><div className="text-xs font-bold sm:text-sm">{t}</div><div className="mt-1 text-[10px] text-[#747b8c]">{a} · Deadline Oct {17+i*4}</div></div><div className="fit-reveal rounded-full bg-[#edf8f4] px-2.5 py-1 text-[10px] font-bold text-[#34836c]" style={{animationDelay:`${.2+i*.11}s`}}>{f} fit</div></div>)}</div></>; }
function AnalyzeScene() { const rows=["U.S. undergraduate student","Minimum 3.5 GPA","500-word personal essay","Official transcript"]; return <div className="relative"><div className="extraction-loader absolute inset-0 z-10 grid place-items-center rounded-xl bg-[#fcfcfd]"><span className="inline-flex items-center gap-2 rounded-full border border-[#ddd9fb] bg-white px-4 py-2 text-[10px] font-bold text-[#5b50b2]"><span className="size-2 animate-pulse rounded-full bg-[#6757e8]" /> Reading scholarship requirements…</span></div><SceneHead icon={<FileText className="size-5" />} kicker="Requirements analysis" title="Future Leaders Scholarship" /><div className="mt-6 grid gap-4 md:grid-cols-[1fr_.7fr]"><div className="rounded-xl border border-[#e4e4e9] bg-white p-4"><div className="text-[10px] font-bold uppercase tracking-[.1em] text-[#777e90]">Eligibility & materials</div>{rows.map((r,i)=><div key={r} className="check-row flex items-center gap-3 border-b border-[#eeeeF2] py-3 text-xs last:border-0" style={{animationDelay:`${.45+i*.12}s`}}><span className="grid size-5 place-items-center rounded-full bg-[#eaf7f2] text-[#37866f]"><Check className="size-3" /></span>{r}</div>)}</div><div className="scene-in rounded-xl bg-[#151e39] p-5 text-white"><div className="text-[10px] text-white/60">Your fit</div><div className="mt-1 text-4xl font-bold">94%</div><div className="mt-3 h-1.5 rounded-full bg-white/15"><div className="score-fill h-full rounded-full bg-[#9387ff]" /></div><p className="mt-4 text-[11px] leading-5 text-white/70">Your academics and community work align strongly.</p></div></div></div>; }
function WritingScene() { return <><SceneHead icon={<Sparkles className="size-5" />} kicker="Essay workspace" title="Your draft, with a thoughtful coach" /><div className="mt-5 grid gap-4 md:grid-cols-[1.2fr_.8fr]"><div className="scene-in rounded-xl border border-[#e1e1e7] bg-white p-5 text-[12px] leading-7 text-[#374059]">When I started the neighborhood coding club, <mark className="typing-highlight rounded bg-[#ede9ff] px-1 text-[#302778]">I thought leadership meant having every answer.</mark> I learned it meant asking better questions—and listening long enough to hear them.</div><aside className="coach-open rounded-xl border border-[#dcd7ff] bg-[#f7f5ff] p-4"><div className="flex items-center gap-2 text-xs font-bold text-[#5146aa]"><Sparkles className="size-3.5" /> Coach note</div><p className="mt-3 text-[11px] leading-5 text-[#62637c]">Strong reflection. Add one specific moment that shows what changed.</p><div className="mt-4 flex items-center justify-between border-t border-[#ddd7fb] pt-3 text-[10px]"><span>Specificity</span><strong className="score-count text-[#5146aa]">78 / 100</strong></div></aside></div></>; }
function SubmitScene() { return <><SceneHead icon={<Check className="size-5" />} kicker="Readiness & tracking" title="Ready when you are." /><div className="mt-5 flex items-center gap-3"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#ececf1]"><div className="readiness-progress h-full rounded-full bg-[#4b9b82]" /></div><span className="text-[10px] font-bold text-[#387763]">4 of 4</span></div><div className="mt-4 rounded-xl border border-[#e3e3e8] bg-white px-5">{[["Essay within word limit","Ready"],["Transcript attached","Ready"],["Recommendation letter","Ready"],["Deadline confirmed","October 17"]].map(([l,s],i)=><div key={l} className="check-row flex items-center justify-between border-b border-[#ececf0] py-3 text-xs last:border-0" style={{animationDelay:`${i*.13}s`}}><span className="flex items-center gap-3"><i className="grid size-6 place-items-center rounded-full bg-[#eaf7f2] text-[#36866f]"><Check className="size-3.5" /></i>{l}</span><span className="font-semibold text-[#4a806f]">{s}</span></div>)}</div><div className="tracking-move mt-4 flex items-center justify-between rounded-xl bg-[#151e39] p-4 text-white"><div><div className="text-[9px] uppercase tracking-[.12em] text-white/55">Application tracker</div><div className="mt-1 text-sm font-bold">Future Leaders Scholarship</div></div><span className="rounded-full bg-[#8f82ff] px-3 py-1 text-[10px] font-bold">Ready to submit</span></div></>; }

function Benefits() {
  const data=[{n:"01",t:"Everything stays connected",d:"Your profile, requirements, drafts, and deadlines move together—so you never start from zero."},{n:"02",t:"Guidance you can verify",d:"See the source behind extracted requirements and understand why an opportunity fits your profile."},{n:"03",t:"Your voice stays yours",d:"Scholar-E points to what can be stronger. The choices and the final words always belong to you."}];
  return <section id="benefits" className="scroll-mt-16 bg-white px-5 py-16 lg:px-8 lg:py-20"><div className="mx-auto max-w-[1120px]"><div className="grid gap-5 md:grid-cols-[1fr_.9fr] md:items-end"><div><div className="text-xs font-bold uppercase tracking-[.15em] text-[#7164df]">Built for the whole journey</div><h2 className="mt-3 max-w-2xl text-balance text-[clamp(2.6rem,5vw,4.8rem)] font-bold leading-[.98] tracking-[-.055em]">Less guesswork.<br />More momentum.</h2></div><p className="max-w-md text-lg leading-8 text-[#646b7d] md:justify-self-end">Scholar-E turns a scattered, stressful process into one clear path forward.</p></div><div className="mt-10 grid gap-px overflow-hidden rounded-3xl border border-[#e3e3e8] bg-[#e3e3e8] md:grid-cols-3">{data.map((x)=><article key={x.n} className="benefit-card bg-white p-7"><h3 className="text-xl font-bold tracking-[-.035em]">{x.t}</h3><p className="mt-3 text-sm leading-6 text-[#687083]">{x.d}</p></article>)}</div></div></section>;
}

function FinalCTA() { return <section className="px-5 pb-10 lg:px-8"><div className="cta-glow mx-auto max-w-[1120px] overflow-hidden rounded-[32px] border border-[#ddd9ff] px-6 py-14 text-center shadow-[0_30px_80px_-48px_#6757e8] sm:px-10 sm:py-16"><h2 className="mx-auto max-w-3xl text-balance text-[clamp(2.5rem,5vw,4.8rem)] font-bold leading-[.98] tracking-[-.055em]">Your best application is still your story.</h2><p className="mx-auto mt-4 max-w-xl text-base leading-7 text-[#62677c]">Bring the ambition. Scholar-E will help you find the opportunity, understand the path, and do your strongest work.</p><Link to="/auth" className="button-lift group mt-7 inline-flex items-center gap-2 rounded-xl bg-[#6757e8] px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_35px_-14px_#6757e8]">Create your free account <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></Link></div></section>; }
function Footer() { return <footer className="px-5 py-8 lg:px-8"><div className="mx-auto flex max-w-[1120px] flex-col items-center justify-between gap-4 border-t border-[#e6e6eb] pt-8 text-xs text-[#747b8d] sm:flex-row"><div className="flex items-center gap-2 font-bold text-[#26304b]"><img src={scholarELogoUrl} alt="" className="size-6 rounded-full" /> Scholar-E</div><span>A coach, not a ghostwriter.</span><div className="flex gap-5"><Link to="/auth" className="hover:text-[#111b36]">Sign in</Link><a href="#workflow" className="hover:text-[#111b36]">How it works</a></div></div></footer>; }
