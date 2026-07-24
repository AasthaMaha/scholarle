import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useUser } from "@/lib/userStore";
import {
  ArrowRight,
  Check,
  FileCheck2,
  FileText,
  ListChecks,
  Search,
  UserRound,
} from "lucide-react";
import scholarELogoUrl from "../../logo/logoPic.jpeg";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · Scholar-E" },
      {
        name: "description",
        content: "Sign in or create your Scholar-E account to start your scholarship journey.",
      },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "create";

// Demo values used by the autofill button on the create-account form. These are
// only for demonstration — they pre-fill the form so reviewers can try the flow
// without typing real details.
const DEMO = {
  name: "Maya Rodriguez",
  email: "maya.rodriguez@example.edu",
  password: "demo-password",
};

function AuthPage() {
  const [mode, setMode] = useState<Mode>("signin");

  return (
    <div className="scholar-landing min-h-screen bg-white font-sans text-[#111b36] md:grid md:grid-cols-[minmax(260px,38%)_1fr] lg:grid-cols-[45%_55%]">
      <AsidePanel />
      <div className="flex min-h-[620px] flex-col bg-white md:min-h-screen">
        <header className="flex h-16 items-center justify-between border-b border-[#111b36]/[.07] px-5 sm:px-8">
          <Link
            to="/"
            aria-label="Scholar-E home"
            className="group flex items-center gap-2.5 md:hidden"
          >
            <img src={scholarELogoUrl} alt="" className="size-8 rounded-full object-cover" />
            <span className="text-[17px] font-bold tracking-[-.03em]">Scholar-E</span>
          </Link>
          <span className="hidden md:block" />
          <Link
            to="/journey"
            className="group inline-flex items-center gap-1.5 text-sm font-semibold text-[#697084] transition-colors hover:text-[#4f43c5] focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6757e8]/30"
          >
            Continue as guest
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </header>

        <main className="grid flex-1 place-items-center px-5 py-8 sm:px-8 md:py-10">
          <div className="w-full max-w-[500px]">
            <div
              className="grid w-full grid-cols-2 rounded-xl bg-[#f2f0ff] p-1 text-sm"
              aria-label="Authentication mode"
            >
              <button
                type="button"
                onClick={() => setMode("signin")}
                aria-pressed={mode === "signin"}
                className={`rounded-lg px-4 py-2.5 font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6757e8]/40 focus-visible:ring-offset-2 ${
                  mode === "signin"
                    ? "bg-[#6757e8] text-white shadow-[0_6px_18px_-10px_#6757e8]"
                    : "text-[#626a7e] hover:bg-white/65 hover:text-[#111b36]"
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setMode("create")}
                aria-pressed={mode === "create"}
                className={`rounded-lg px-4 py-2.5 font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6757e8]/40 focus-visible:ring-offset-2 ${
                  mode === "create"
                    ? "bg-[#6757e8] text-white shadow-[0_6px_18px_-10px_#6757e8]"
                    : "text-[#626a7e] hover:bg-white/65 hover:text-[#111b36]"
                }`}
              >
                Create account
              </button>
            </div>

            <div className="mt-4">
              {mode === "signin" ? <SignInForm /> : <CreateAccountForm />}
            </div>

            <p className="mt-5 text-center text-xs leading-5 text-[#7b8191]">
              No verification required for this demo — your details are saved
              locally on this device only.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

function AsidePanel() {
  return (
    <aside className="relative flex overflow-hidden border-b border-[#dcd9ef] bg-[#f8f7ff] px-5 py-7 md:min-h-screen md:flex-col md:justify-between md:border-b-0 md:border-r md:px-8 md:py-8 lg:px-12 lg:py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_43%_48%,rgba(188,180,242,0.16),transparent_64%)]" />
      <Link
        to="/"
        aria-label="Scholar-E home"
        className="group relative z-10 hidden items-center gap-2.5 md:flex"
      >
        <img
          src={scholarELogoUrl}
          alt=""
          className="size-9 rounded-full object-cover transition-transform group-hover:-rotate-6"
        />
        <span className="text-lg font-bold tracking-[-.03em]">Scholar-E</span>
      </Link>

      <div className="relative z-10 w-full md:my-auto">
        <h1 className="max-w-[520px] text-balance text-[2.15rem] font-bold leading-[.98] tracking-[-.055em] sm:text-[2.6rem] md:text-[clamp(2.45rem,4.2vw,4.6rem)]">
          Win scholarships
          <br />
          <span className="text-[#6757e8]">in your own voice.</span>
        </h1>
        <p className="mt-4 max-w-[470px] text-sm leading-6 text-[#5b6377] sm:text-base md:mt-6 md:leading-7">
          Build your profile once, understand each opportunity, and strengthen your
          application without giving up authorship.
        </p>
        <ScholarWorkflow />
      </div>

      <div className="relative z-10 mt-5 hidden text-xs font-medium tracking-wide text-[#72798b] md:block">
        A coach, not a ghostwriter.
      </div>
    </aside>
  );
}

const workflowSteps = [
  { label: "Profile", icon: UserRound, verified: true },
  { label: "Discover", icon: Search, verified: false },
  { label: "Analyze", icon: ListChecks, verified: false },
  { label: "Write", icon: FileText, verified: false },
  { label: "Submit", icon: FileCheck2, verified: false },
] as const;

function ScholarWorkflow() {
  return (
    <div
      aria-label="Scholar-E workflow: Profile, Discover, Analyze, Write, Submit"
      className="relative mt-8 flex w-full max-w-[450px] items-center justify-between md:-mx-4 md:w-[calc(100%+2rem)] lg:mx-0 lg:w-full"
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute left-[22px] top-0 h-11 w-[calc(100%-44px)] lg:left-6 lg:h-12 lg:w-[calc(100%-48px)]"
        viewBox="0 0 400 40"
        preserveAspectRatio="none"
      >
        <path
          d="M 0 20 C 48 10, 72 30, 110 20 S 182 10, 220 20 S 302 30, 400 20"
          fill="none"
          stroke="#beb6ea"
          strokeWidth="1.2"
          strokeDasharray="4 7"
          strokeLinecap="round"
          opacity="0.72"
        />
      </svg>
      {workflowSteps.map(({ label, icon: Icon, verified }) => (
        <div key={label} className="relative z-10">
          <div className="relative grid size-11 place-items-center rounded-full border border-[#d9d5ef] bg-white/90 text-[#77758a] shadow-[0_8px_20px_-17px_rgba(30,37,62,.45)] lg:size-12">
            <Icon className="size-[18px] lg:size-5" strokeWidth={1.45} />
            {verified && (
              <span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full border-2 border-white bg-[#438e76] text-white">
                <Check className="size-2.5" strokeWidth={2.5} />
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-[#27314c]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="mt-1.5 w-full rounded-xl border border-[#dcdde7] bg-[#fcfbff] px-3.5 py-3 text-sm text-[#111b36] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-[#9a9ead] hover:border-[#c7c3df] focus:border-[#8d80ef] focus:bg-white focus:ring-4 focus:ring-[#6757e8]/15"
      />
    </label>
  );
}

function SignInForm() {
  const { user, signIn } = useUser();
  const navigate = useNavigate();
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("Enter the email you used for your profile.");
      return;
    }
    // No authentication — sign in restores any saved work for this email on this device.
    signIn(email.trim(), user?.name || nameFromEmail(email));
    navigate({ to: "/journey" });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-5 rounded-[20px] border border-[#dedbea] bg-white p-6 shadow-[0_28px_70px_-42px_rgba(55,45,130,.42)] sm:p-8"
    >
      <div>
        <h2 className="text-3xl font-bold tracking-[-.045em]">Welcome back</h2>
        <p className="mt-1.5 text-sm text-[#697084]">Sign in to continue your journey.</p>
      </div>
      <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@school.edu" autoComplete="email" />
      <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" autoComplete="current-password" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#6757e8] py-3 text-sm font-bold text-white shadow-[0_16px_35px_-16px_#6757e8] transition-all hover:-translate-y-0.5 hover:bg-[#5b4bd9] hover:shadow-[0_20px_40px_-16px_#6757e8] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#6757e8]/25"
      >
        Sign in <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </button>
    </form>
  );
}

function CreateAccountForm() {
  const { signIn } = useUser();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  function fillDemo() {
    setName(DEMO.name);
    setEmail(DEMO.email);
    setPassword(DEMO.password);
    setConfirm(DEMO.password);
    setError("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError("Add your name and email to create your account.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    // No authentication — create the account locally and continue.
    signIn(email.trim(), name.trim());
    navigate({ to: "/journey" });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-[20px] border border-[#dedbea] bg-white p-6 shadow-[0_28px_70px_-42px_rgba(55,45,130,.42)] sm:p-8"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-[-.04em] sm:text-3xl">Create your account</h2>
          <p className="mt-1.5 text-sm text-[#697084]">Start building your scholarship profile.</p>
        </div>
        <button
          type="button"
          onClick={fillDemo}
          className="shrink-0 rounded-lg border border-[#d4cff8] bg-[#f7f5ff] px-3 py-2 text-xs font-semibold text-[#5d50cf] transition-colors hover:border-[#bcb4f2] hover:bg-[#efecff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6757e8]/30"
        >
          Fill demo details
        </button>
      </div>
      <Field label="Full name" value={name} onChange={setName} placeholder="Maya Rodriguez" autoComplete="name" />
      <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@school.edu" autoComplete="email" />
      <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="Create a password" autoComplete="new-password" />
      <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} placeholder="Re-enter password" autoComplete="new-password" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#6757e8] py-3 text-sm font-bold text-white shadow-[0_16px_35px_-16px_#6757e8] transition-all hover:-translate-y-0.5 hover:bg-[#5b4bd9] hover:shadow-[0_20px_40px_-16px_#6757e8] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#6757e8]/25"
      >
        Create account <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </button>
    </form>
  );
}

function nameFromEmail(email: string) {
  const local = email.split("@")[0] ?? "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(" ");
}
