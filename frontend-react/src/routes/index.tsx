import { createFileRoute, Link } from "@tanstack/react-router";
import { useUser, initials } from "@/lib/userStore";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Scholar-E — Your AI Scholarship Coach" },
      {
        name: "description",
        content:
          "Scholar-E guides students to discover scholarships, analyze fit, and strengthen essays — without writing them for you.",
      },
      { property: "og:title", content: "Scholar-E — Your AI Scholarship Coach" },
      {
        property: "og:description",
        content: "Discover scholarships, analyze fit, and strengthen essays with an AI coach that helps you sound more like you.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen">
      <Header />
      <main>
        <Hero />
        <StudentDemo />
        <Pillars />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  const { isAuthenticated, user, signOut } = useUser();
  return (
    <header className="border-b border-border/60 backdrop-blur sticky top-0 z-30 bg-background/70">
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LogoMark />
          <span className="font-display font-semibold text-lg tracking-tight">Scholar-E</span>
          <span className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground border border-border rounded px-1.5 py-0.5">
            SEIP MVP
          </span>
        </div>
        <nav className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
          <a href="#how" className="hover:text-foreground">How it works</a>
          <a href="#pillars" className="hover:text-foreground">What we deliver</a>
          <a href="#demo" className="hover:text-foreground">Student Demo</a>
        </nav>
        <div className="flex items-center gap-2">
          {isAuthenticated ? (
            <>
              <Link
                to="/journey"
                className="hidden sm:inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
              >
                Continue →
              </Link>
              <div className="flex items-center gap-2 rounded-full border border-border bg-card pl-1 pr-3 py-1">
                <div className="size-7 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs font-display">
                  {initials(user?.name)}
                </div>
                <span className="text-xs">{user?.name}</span>
                <button onClick={signOut} className="text-[11px] text-muted-foreground hover:text-foreground">
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <Link
                to="/auth"
                className="text-sm text-muted-foreground hover:text-foreground px-3 py-2"
              >
                Log in
              </Link>
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
              >
                Sign up →
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function LogoMark() {
  return (
    <div className="size-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-display font-bold">
      S<span className="text-gold">e</span>
    </div>
  );
}

function Hero() {
  const { isAuthenticated } = useUser();
  return (
    <section className="mx-auto max-w-7xl px-6 pt-20 pb-16 grid lg:grid-cols-12 gap-12 items-center">
      <div className="lg:col-span-7">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-gold" />
          A coach, not a ghostwriter
        </div>
        <h1 className="mt-5 font-display text-5xl md:text-7xl font-semibold leading-[1.02] text-balance">
          Win scholarships<br />
          <span className="italic text-primary">in your own voice.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-xl text-balance">
          Scholar-E walks you through 17 steps — from discovery to submission — analyzing fit, highlighting weak
          sentences, and tracking every deadline. You stay the author.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to={isAuthenticated ? "/journey" : "/auth"}
            className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-6 py-3 text-sm font-medium shadow-sm hover:opacity-90"
          >
            {isAuthenticated ? "Continue your journey →" : "Create your account →"}
          </Link>
          <a
            href="#how"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-6 py-3 text-sm font-medium hover:bg-accent"
          >
            See how it works
          </a>
        </div>
        <div className="mt-10 grid grid-cols-3 gap-6 max-w-md">
          {[
            { k: "17", v: "guided steps" },
            { k: "0", v: "essays written for you" },
            { k: "1", v: "voice — yours" },
          ].map((s) => (
            <div key={s.v}>
              <div className="font-display text-3xl text-primary">{s.k}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="lg:col-span-5">
        <HeroCard />
      </div>
    </section>
  );
}

function HeroCard() {
  return (
    <div className="relative">
      <div className="absolute -inset-4 bg-gradient-to-br from-gold/30 via-transparent to-primary/20 blur-2xl rounded-3xl" />
      <div className="relative rounded-2xl border border-border bg-card/95 backdrop-blur p-5 shadow-xl">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono">your-essay-draft.txt</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-success" /> Live feedback
          </span>
        </div>
        <div className="mt-4 text-[15px] leading-relaxed font-display text-foreground/90">
          Things were{" "}
          <span className="bg-gold/40 rounded px-0.5 underline decoration-gold decoration-2 underline-offset-4">
            hard sometimes
          </span>
          . The coach won't rewrite this — it just shows you which sentences need one concrete detail
          to land the way you want.
        </div>
        <div className="mt-4 rounded-xl border border-gold/40 bg-gold/10 p-3 text-sm">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">Specificity · Coach note</span>
            <span className="font-mono text-muted-foreground">12/100 → 78/100</span>
          </div>
          <p className="mt-1.5 text-foreground/80">
            Vague closer to a powerful paragraph. Try one concrete detail that <em>shows</em> the difficulty.
          </p>
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>Your draft · word count tracked live</span>
          <span>Draft v1</span>
        </div>
      </div>
    </div>
  );
}

function StudentDemo() {
  const { isAuthenticated } = useUser();
  return (
    <section id="demo" className="mx-auto max-w-7xl px-6 py-20">
      <div className="rounded-3xl border border-border bg-card p-8 md:p-12 grid md:grid-cols-12 gap-8 items-center">
        <div className="md:col-span-4 flex flex-col items-start gap-4">
          <div className="text-xs uppercase tracking-widest text-gold">Student Demo</div>
          <h2 className="font-display text-3xl md:text-4xl text-balance">
            Walk through the journey <span className="italic">as yourself</span>.
          </h2>
          <p className="text-sm text-muted-foreground">
            Create an account, fill in your real profile, paste your real essay — and see exactly
            what your scholarship workflow will feel like.
          </p>
        </div>
        <div className="md:col-span-8 grid sm:grid-cols-3 gap-3">
          {[
            { t: "Create your account", d: "Email + password, or sign in with Google." },
            { t: "Build your profile", d: "Branching questions based on your education level — plus optional context like resume, societies, sports, articles, and projects." },
            { t: "Personalized Coaching", d: "Get clarity, specificity, and impact coaching on your real essay — you keep authorship." },
          ].map((s, i) => (
            <div key={s.t} className="rounded-2xl border border-border bg-secondary/40 p-5">
              <div className="font-mono text-xs text-gold">0{i + 1}</div>
              <div className="font-display text-lg mt-1.5">{s.t}</div>
              <p className="text-sm text-muted-foreground mt-1">{s.d}</p>
            </div>
          ))}
          <div className="sm:col-span-3 flex items-center justify-end">
            <Link
              to={isAuthenticated ? "/journey" : "/auth"}
              className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:opacity-90"
            >
              {isAuthenticated ? "Continue your journey →" : "Start the Student Demo →"}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Pillars() {
  const items = [
    {
      t: "Personalized guidance",
      d: "Rule-based discovery maps your profile to scholarship buckets and curated sources — no scraping, no spam.",
    },
    {
      t: "Smart analysis",
      d: "Paste any scholarship link. AI extracts deadlines, eligibility, required docs, and prompts in seconds.",
    },
    {
      t: "Actionable feedback",
      d: "Grammarly-style highlights on your essay — clarity, specificity, leadership, storytelling, impact.",
    },
    {
      t: "Submission readiness",
      d: "Final check verifies every required document, word count, and recommender before you hit submit.",
    },
    {
      t: "Track & succeed",
      d: "One board for every application — Interested → Drafting → Submitted → Awarded.",
    },
  ];
  return (
    <section id="pillars" className="mx-auto max-w-7xl px-6 py-16">
      <div className="max-w-2xl">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">What Scholar-E delivers</div>
        <h2 className="font-display text-4xl mt-2">Five things every applicant needs.</h2>
      </div>
      <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-5 gap-4">
        {items.map((it, i) => (
          <div key={it.t} className="rounded-2xl border border-border bg-card p-5">
            <div className="font-mono text-xs text-gold">0{i + 1}</div>
            <div className="font-display text-lg mt-2">{it.t}</div>
            <p className="mt-2 text-sm text-muted-foreground">{it.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CTA() {
  const { isAuthenticated } = useUser();
  return (
    <section id="how" className="mx-auto max-w-7xl px-6 py-20">
      <div className="rounded-3xl bg-primary text-primary-foreground p-10 md:p-14 grid md:grid-cols-12 gap-8 items-center">
        <div className="md:col-span-8">
          <h2 className="font-display text-4xl md:text-5xl text-balance">
            Start now.
          </h2>
          <p className="mt-4 text-primary-foreground/80 max-w-2xl">
            Create your account, build your profile, and walk through the full scholarship workflow.
          </p>
        </div>
        <div className="md:col-span-4 md:text-right">
          <Link
            to={isAuthenticated ? "/journey" : "/auth"}
            className="inline-flex items-center gap-2 rounded-full bg-gold text-gold-foreground px-6 py-3 text-sm font-semibold hover:opacity-90"
          >
            {isAuthenticated ? "Enter the journey →" : "Create account →"}
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60 mt-10">
      <div className="mx-auto max-w-7xl px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <LogoMark />
          <span>Scholar-E · Rice SEIP Summer 2026 · Prototype</span>
        </div>
        <div>A coach, not a ghostwriter.</div>
      </div>
    </footer>
  );
}
