import { createFileRoute, Link } from "@tanstack/react-router";
import scholarELogoUrl from "../../logo/logoPic.png";

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
    <div className="min-h-screen bg-gradient-to-br from-[#F9FAFF] via-[#EEF2FF] to-[#F5EFFF] font-['Roboto',ui-sans-serif,system-ui,sans-serif] text-[#1F2A44] [&_.font-display]:font-['Roboto',ui-sans-serif,system-ui,sans-serif]">
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
  return (
    <header className="border-b border-white/70 backdrop-blur sticky top-0 z-30 bg-white/80">
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LogoMark />
          <span className="font-display font-semibold text-lg tracking-tight">Scholar-E</span>
        </div>
        <nav className="hidden md:flex items-center gap-7 text-sm text-[#1F2A44]/70">
          <a href="#demo" className="hover:text-[#1F2A44]">How it works</a>
          <a href="#pillars" className="hover:text-[#1F2A44]">What we deliver</a>
          <a href="#demo" className="hover:text-[#1F2A44]">Student Demo</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            to="/auth"
            className="hidden sm:inline-flex items-center rounded-full px-4 py-2 text-sm font-medium text-[#1F2A44]/80 hover:text-[#1F2A44]"
          >
            Sign in
          </Link>
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-full bg-[#1F2A44] text-white px-4 py-2 text-sm font-medium hover:bg-[#151D33]"
          >
            Create account →
          </Link>
        </div>
      </div>
    </header>
  );
}

function LogoMark() {
  return (
    <div className="size-8 overflow-hidden rounded-lg shadow-sm">
      <img src={scholarELogoUrl} alt="" className="size-full object-contain" />
    </div>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-7xl px-6 pt-20 pb-16 grid lg:grid-cols-12 gap-12 items-center">
      <div className="lg:col-span-7">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs text-[#1F2A44]/70 shadow-sm">
          <span className="size-1.5 rounded-full bg-[#6D5DF6]" />
          A coach, not a ghostwriter
        </div>
        <h1 className="mt-5 font-display text-5xl md:text-7xl font-semibold leading-[1.02] text-balance">
          Win scholarships<br />
          <span className="italic text-[#1F2A44]">in your own voice.</span>
        </h1>
        <p className="mt-6 text-lg text-[#1F2A44]/75 max-w-xl text-balance">
          Scholar-E walks you through 7 steps — from discovery to submission — analyzing fit, highlighting weak
          sentences, and tracking every deadline. You stay the author.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/journey"
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#1F2A44] to-[#5B5FEF] text-white px-6 py-3 text-sm font-medium shadow-lg shadow-[#6D5DF6]/20 hover:opacity-95"
          >
            Start your journey →
          </Link>
          <a
            href="#demo"
            className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/75 px-6 py-3 text-sm font-medium text-[#1F2A44] shadow-sm hover:bg-white"
          >
            See how it works
          </a>
        </div>
        <div className="mt-10 grid grid-cols-3 gap-6 max-w-md">
          {[
            { k: "7", v: "guided steps" },
            { k: "0", v: "essays written for you" },
            { k: "1", v: "voice — yours" },
          ].map((s) => (
            <div key={s.v}>
              <div className="font-display text-3xl text-[#1F2A44]">{s.k}</div>
              <div className="text-xs text-[#1F2A44]/65 mt-1">{s.v}</div>
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
      <div className="absolute -inset-4 bg-gradient-to-br from-[#6D5DF6]/25 via-[#8AB4F8]/25 to-[#E6B8FF]/25 blur-2xl rounded-3xl" />
      <div className="relative rounded-2xl border border-white/80 bg-white/82 backdrop-blur p-5 shadow-xl shadow-[#1F2A44]/10">
        <div className="flex items-center justify-between text-xs text-[#1F2A44]/65">
          <span className="font-mono">your-essay-draft.txt</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-[#6D5DF6]" /> Live feedback
          </span>
        </div>
        <div className="mt-4 text-[15px] leading-relaxed font-display text-[#1F2A44]/90">
          Things were{" "}
          <span className="bg-[#EDEBFF] rounded px-0.5 underline decoration-[#6D5DF6] decoration-2 underline-offset-4">
            hard sometimes
          </span>
          . The coach won't rewrite this — it just shows you which sentences need one concrete detail
          to land the way you want.
        </div>
        <div className="mt-4 rounded-xl border border-[#DDD8FF] bg-[#F4F2FF] p-3 text-sm">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[#1F2A44]">Specificity · Coach note</span>
            <span className="font-mono text-[#1F2A44]/65">12/100 → 78/100</span>
          </div>
          <p className="mt-1.5 text-[#1F2A44]/80">
            Vague closer to a powerful paragraph. Try one concrete detail that <em>shows</em> the difficulty.
          </p>
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-[#1F2A44]/65">
          <span>Your draft · word count tracked live</span>
          <span>Draft v1</span>
        </div>
      </div>
    </div>
  );
}

function StudentDemo() {
  return (
    <section id="demo" className="mx-auto max-w-7xl px-6 py-20">
      <div className="rounded-3xl border border-white/80 bg-white/82 backdrop-blur p-8 shadow-xl shadow-[#1F2A44]/5 md:p-12 grid md:grid-cols-12 gap-8 items-center">
        <div className="md:col-span-4 flex flex-col items-start gap-4">
          <div className="text-xs uppercase tracking-widest text-[#1F2A44]/70">Student Demo</div>
          <h2 className="font-display text-3xl md:text-4xl text-balance">
            Walk through the journey <span className="italic">as yourself</span>.
          </h2>
          <p className="text-sm text-[#1F2A44]/70">
            Fill in your real profile, paste your real essay — and see exactly
            what your scholarship workflow will feel like.
          </p>
        </div>
        <div className="md:col-span-8 grid sm:grid-cols-3 gap-3">
          {[
            { t: "Build your profile", d: "Branching questions based on your education level — plus optional context like resume, societies, sports, articles, and projects." },
            { t: "Import a scholarship", d: "Add the scholarship details and prompt you want to apply for." },
            { t: "Personalized Coaching", d: "Get clarity, specificity, and impact coaching on your real essay — you keep authorship." },
          ].map((s, i) => (
            <div key={s.t} className="rounded-2xl border border-white/80 bg-gradient-to-br from-white/90 to-[#EEF2FF]/80 p-5">
              <div className="font-mono text-xs text-[#1F2A44]/70">0{i + 1}</div>
              <div className="font-display text-lg mt-1.5">{s.t}</div>
              <p className="text-sm text-[#1F2A44]/70 mt-1">{s.d}</p>
            </div>
          ))}
          <div className="sm:col-span-3 flex items-center justify-end">
            <Link
              to="/journey"
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#1F2A44] to-[#5B5FEF] text-white px-5 py-2.5 text-sm font-medium hover:opacity-95"
            >
              Start the Student Demo →
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
        <div className="text-xs uppercase tracking-widest text-[#1F2A44]/70">What Scholar-E delivers</div>
        <h2 className="font-display text-4xl mt-2">Five things every applicant needs.</h2>
      </div>
      <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-5 gap-4">
        {items.map((it, i) => (
          <div key={it.t} className="rounded-2xl border border-white/80 bg-white/82 backdrop-blur p-5 shadow-sm shadow-[#1F2A44]/5">
            <div className="font-mono text-xs text-[#1F2A44]/70">0{i + 1}</div>
            <div className="font-display text-lg mt-2">{it.t}</div>
            <p className="mt-2 text-sm text-[#1F2A44]/70">{it.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section id="how" className="mx-auto max-w-7xl px-6 py-20">
      <div className="rounded-3xl bg-gradient-to-r from-[#1F2A44] via-[#3B3C8F] to-[#6D5DF6] text-white p-10 md:p-14 grid md:grid-cols-12 gap-8 items-center shadow-xl shadow-[#1F2A44]/15">
        <div className="md:col-span-8">
          <h2 className="font-display text-4xl md:text-5xl text-balance">
            Start now.
          </h2>
          <p className="mt-4 text-white/75 max-w-2xl">
            Build your profile and walk through the full scholarship workflow.
          </p>
        </div>
        <div className="md:col-span-4 md:text-right">
          <Link
            to="/journey"
            className="inline-flex items-center gap-2 rounded-full bg-[#EDEBFF] text-[#1F2A44] px-6 py-3 text-sm font-semibold hover:bg-[#DDD8FF]"
          >
            Enter the journey →
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/70 mt-10">
      <div className="mx-auto max-w-7xl px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-[#1F2A44]/65">
        <div className="flex items-center gap-2">
          <LogoMark />
          <span>Scholar-E</span>
        </div>
        <div>A coach, not a ghostwriter.</div>
      </div>
    </footer>
  );
}
