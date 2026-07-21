import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  ClipboardList,
  Gauge,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import scholarELogoUrl from "../../logo/logoPic.jpeg";

export const Route = createFileRoute("/student-demo")({
  head: () => ({
    meta: [
      { title: "Student Demo — Scholar-E" },
      {
        name: "description",
        content:
          "A guided tour of the real Scholar-E product — five steps from building your profile to a submission-ready application.",
      },
    ],
  }),
  component: StudentDemoPage,
});

type Step = {
  icon: typeof UserRound;
  title: string;
  description: string;
};

const STEPS: Step[] = [
  {
    icon: UserRound,
    title: "Build Your Profile",
    description: "Add your resume, experiences, skills, background, and eligibility details.",
  },
  {
    icon: ClipboardList,
    title: "Add an Opportunity",
    description: "Paste scholarship or internship details, requirements, deadlines, and prompts.",
  },
  {
    icon: Gauge,
    title: "See Fit + Readiness",
    description:
      "Scholar-E compares your profile against the opportunity and shows strengths, gaps, and missing requirements.",
  },
  {
    icon: Sparkles,
    title: "Get Revision Guidance",
    description:
      "Use coaching and writing support to improve your application while keeping your own voice.",
  },
  {
    icon: ShieldCheck,
    title: "Prepare to Submit",
    description: "Review the checklist, required materials, and final readiness before applying.",
  },
];

const FLOW = ["Profile", "Opportunity", "Fit Score", "Writing Support", "Submission Checklist"];

function StudentDemoPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F9FAFF] via-[#EEF2FF] to-[#F5EFFF] font-['Roboto',ui-sans-serif,system-ui,sans-serif] text-[#1F2A44] [&_.font-display]:font-['Roboto',ui-sans-serif,system-ui,sans-serif]">
      <header className="border-b border-white/70 backdrop-blur sticky top-0 z-30 bg-white/80">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={scholarELogoUrl} alt="" className="size-8 object-contain" />
            <span className="font-display font-semibold text-lg tracking-tight">Scholar-E</span>
          </Link>
          <Link to="/" className="text-sm text-[#1F2A44]/70 hover:text-[#1F2A44]">
            ← Back to home
          </Link>
        </div>
      </header>

      <main>
        <Intro />

        <div className="mx-auto max-w-6xl px-6 pb-8 flex flex-col gap-16">
          {STEPS.map((step, i) => (
            <StepBlock key={step.title} index={i + 1} step={step} reverse={i % 2 === 1} />
          ))}
        </div>

        <FlowDiagram />

        <div className="mx-auto max-w-6xl px-6 py-16 flex justify-center">
          <Link
            to="/journey"
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#1F2A44] to-[#5B5FEF] text-white px-6 py-3 text-sm font-medium shadow-lg shadow-[#6D5DF6]/20 hover:opacity-95"
          >
            Start your journey <ArrowRight className="size-4" />
          </Link>
        </div>
      </main>

      <footer className="border-t border-white/70">
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-[#1F2A44]/65">
          <div className="flex items-center gap-2">
            <img src={scholarELogoUrl} alt="" className="size-8 object-contain" />
            <span>Scholar-E</span>
          </div>
          <div>A coach, not a ghostwriter.</div>
        </div>
      </footer>
    </div>
  );
}

function Intro() {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-16 pb-14 text-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs text-[#1F2A44]/70 shadow-sm">
        <span className="size-1.5 rounded-full bg-[#6D5DF6]" />A guided tour, not a form to fill in
      </div>
      <h1 className="mt-5 font-display text-5xl md:text-7xl font-semibold leading-[1.02] text-balance">
        The 5-step journey, explained.
      </h1>
      <p className="mt-4 text-lg text-[#1F2A44]/70 max-w-2xl mx-auto text-balance">
        Every step below is a preview of the real product. Scroll through to see how Scholar-E takes
        you from a blank profile to a submission-ready application — then try it yourself with your
        own information.
      </p>
    </section>
  );
}

function StepBlock({ index, step, reverse }: { index: number; step: Step; reverse?: boolean }) {
  const Icon = step.icon;
  return (
    <div
      className={`grid lg:grid-cols-12 gap-10 items-center ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}
    >
      <div className="lg:col-span-5 flex flex-col items-start gap-4">
        <div className="font-mono text-sm text-[#1F2A44]/60">Step 0{index} of 05</div>
        <div className="size-14 rounded-full bg-[#EDEBFF] grid place-items-center text-[#6D5DF6]">
          <Icon className="size-6" />
        </div>
        <h2 className="font-display text-3xl md:text-4xl text-balance">{step.title}</h2>
        <p className="text-lg text-[#1F2A44]/70 leading-relaxed">{step.description}</p>
      </div>
      <div className="lg:col-span-7">
        <div className="relative">
          <div className="absolute -inset-3 bg-gradient-to-br from-[#6D5DF6]/15 via-[#8AB4F8]/15 to-[#E6B8FF]/15 blur-2xl rounded-3xl" />
          <div className="relative select-none pointer-events-none">
            <StepMock index={index} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MockShell({
  fileName,
  badge,
  children,
}: {
  fileName: string;
  badge: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/82 backdrop-blur p-5 shadow-xl shadow-[#1F2A44]/10">
      <div className="flex items-center justify-between text-xs text-[#1F2A44]/65">
        <span className="font-mono">{fileName}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-[#6D5DF6]" /> {badge}
        </span>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function StepMock({ index }: { index: number }) {
  switch (index) {
    case 1:
      return (
        <MockShell fileName="your-profile.json" badge="Step 1 preview">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full bg-[#EDEBFF] grid place-items-center text-[#6D5DF6]">
              <UserRound className="size-5" />
            </div>
            <div>
              <div className="font-display text-sm">Maya Rodriguez</div>
              <div className="text-xs text-[#1F2A44]/60">Undergraduate · Computer Science</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            {[
              ["Resume", "Uploaded"],
              ["Experiences", "3 added"],
              ["Skills", "Python, ML, Outreach"],
              ["Eligibility", "First-gen · Pell eligible"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-[#DDD8FF] bg-[#F4F2FF] px-3 py-2">
                <div className="text-[#1F2A44]/55">{k}</div>
                <div className="mt-0.5 font-medium">{v}</div>
              </div>
            ))}
          </div>
        </MockShell>
      );
    case 2:
      return (
        <MockShell fileName="add-opportunity" badge="Step 2 preview">
          <div className="rounded-xl border border-[#DDD8FF] bg-[#F4F2FF] p-3">
            <div className="flex items-center justify-between">
              <div className="font-display text-sm">SHPE Rising Engineers Grant</div>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-[#1F2A44]/70 border border-[#DDD8FF]">
                Scholarship
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              {[
                ["Amount", "$2,500"],
                ["Deadline", "Oct 14"],
                ["Requirements", "Transcript, essay"],
                ["Prompt", "1 essay · 500 words"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-white bg-white/70 px-3 py-2">
                  <div className="text-[#1F2A44]/55">{k}</div>
                  <div className="mt-0.5 font-medium">{v}</div>
                </div>
              ))}
            </div>
          </div>
        </MockShell>
      );
    case 3:
      return (
        <MockShell fileName="fit-and-readiness" badge="Step 3 preview">
          <div className="flex items-center justify-between rounded-xl border border-[#DDD8FF] bg-[#F4F2FF] p-3">
            <div className="flex items-center gap-2">
              <Gauge className="size-4 text-[#6D5DF6]" />
              <span className="text-sm font-medium">Overall Fit</span>
            </div>
            <span className="font-mono text-sm">86 / 100</span>
          </div>
          <div className="mt-3 flex flex-col gap-2 text-xs">
            <div className="flex items-center gap-2 rounded-lg border border-[#DDD8FF] bg-white/70 px-3 py-2">
              <Check className="size-3.5 text-[#6D5DF6]" /> Strong: GPA, major, first-gen status
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-[#DDD8FF] bg-white/70 px-3 py-2">
              <Check className="size-3.5 text-[#6D5DF6]" /> Gap: no recommendation letter yet
            </div>
          </div>
        </MockShell>
      );
    case 4:
      return (
        <MockShell fileName="your-essay-draft.txt" badge="Step 4 preview">
          <div className="text-[15px] leading-relaxed font-display text-[#1F2A44]/90">
            Things were{" "}
            <span className="bg-[#EDEBFF] rounded px-0.5 underline decoration-[#6D5DF6] decoration-2 underline-offset-4">
              hard sometimes
            </span>
            . The coach won't rewrite this — it just shows you which sentences need one concrete
            detail.
          </div>
          <div className="mt-4 rounded-xl border border-[#DDD8FF] bg-[#F4F2FF] p-3 text-sm">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">Specificity · Coach note</span>
              <span className="font-mono text-[#1F2A44]/65">12/100 → 78/100</span>
            </div>
            <p className="mt-1.5 text-[#1F2A44]/80">
              Vague closer to a powerful paragraph. Try one concrete detail that <em>shows</em> the
              difficulty.
            </p>
          </div>
        </MockShell>
      );
    case 5:
      return (
        <MockShell fileName="submission-checklist" badge="Step 5 preview">
          <div className="flex flex-col gap-2">
            {[
              "Word count within range",
              "Transcript uploaded",
              "Recommendation letter received",
              "Deadline confirmed · Oct 14",
            ].map((label) => (
              <div
                key={label}
                className="flex items-center gap-2.5 rounded-lg border border-[#DDD8FF] bg-[#F4F2FF] px-3 py-2 text-xs"
              >
                <span className="size-4 rounded-full bg-[#6D5DF6] text-white grid place-items-center">
                  <Check className="size-3" />
                </span>
                {label}
              </div>
            ))}
          </div>
        </MockShell>
      );
    default:
      return null;
  }
}

function FlowDiagram() {
  return (
    <section className="mx-auto max-w-6xl px-6">
      <div className="rounded-3xl border border-white/80 bg-white/82 backdrop-blur p-8 md:p-10 shadow-xl shadow-[#1F2A44]/5">
        <div className="text-xs uppercase tracking-widest text-[#1F2A44]/60 text-center">
          The flow
        </div>
        <div className="mt-6 flex flex-col md:flex-row items-center justify-between gap-3">
          {FLOW.map((label, i) => (
            <div key={label} className="flex items-center gap-3 w-full md:w-auto">
              <div className="flex-1 md:flex-none rounded-full border border-[#DDD8FF] bg-gradient-to-br from-white to-[#EEF2FF] px-5 py-2.5 text-center">
                <span className="font-display text-sm md:text-base">{label}</span>
              </div>
              {i < FLOW.length - 1 && (
                <ArrowRight className="hidden md:block size-5 text-[#6D5DF6] shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
