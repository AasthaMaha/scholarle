import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useUser } from "@/lib/userStore";
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
    <div className="min-h-screen grid lg:grid-cols-2">
      <AsidePanel />
      <div className="flex flex-col">
        <header className="flex items-center justify-between px-6 h-16 border-b border-border/60">
          <Link to="/" className="flex items-center gap-2">
            <img src={scholarELogoUrl} alt="" className="size-8 rounded-full object-cover" />
            <span className="font-display font-semibold tracking-tight">Scholar-E</span>
          </Link>
          <Link to="/journey" className="text-sm text-muted-foreground hover:text-foreground">
            Continue as guest →
          </Link>
        </header>

        <div className="flex-1 grid place-items-center px-6 py-12">
          <div className="w-full max-w-md">
            <div className="inline-flex rounded-full border border-border bg-card p-1 text-sm">
              <button
                type="button"
                onClick={() => setMode("signin")}
                className={`rounded-full px-4 py-1.5 transition-colors ${
                  mode === "signin"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setMode("create")}
                className={`rounded-full px-4 py-1.5 transition-colors ${
                  mode === "create"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Create account
              </button>
            </div>

            <div className="mt-6">
              {mode === "signin" ? <SignInForm /> : <CreateAccountForm />}
            </div>

            <p className="mt-6 text-center text-xs text-muted-foreground">
              No verification required for this demo — your details are saved
              locally on this device only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AsidePanel() {
  return (
    <aside className="hidden lg:flex flex-col justify-between bg-primary text-primary-foreground p-12">
      <Link to="/" className="flex items-center gap-2">
        <img src={scholarELogoUrl} alt="" className="size-9 rounded-full object-cover" />
        <span className="font-display font-semibold text-lg tracking-tight">Scholar-E</span>
      </Link>
      <div>
        <h1 className="font-display text-4xl leading-tight text-balance">
          Win scholarships <span className="italic text-gold">in your own voice.</span>
        </h1>
        <p className="mt-4 text-primary-foreground/80 max-w-sm">
          Create your account to save your profile, track applications, and get
          AI coaching on your real essays — we never write them for you.
        </p>
      </div>
      <div className="text-xs text-primary-foreground/70">A coach, not a ghostwriter.</div>
    </aside>
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
      <span className="text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/40"
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
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-6">
      <div>
        <h2 className="font-display text-2xl">Welcome back</h2>
        <p className="text-sm text-muted-foreground mt-1">Sign in to continue your journey.</p>
      </div>
      <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@school.edu" autoComplete="email" />
      <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" autoComplete="current-password" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        className="w-full rounded-full bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:opacity-90"
      >
        Sign in →
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
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">Create your account</h2>
          <p className="text-sm text-muted-foreground mt-1">Start building your scholarship profile.</p>
        </div>
        <button
          type="button"
          onClick={fillDemo}
          className="shrink-0 rounded-full border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-medium hover:bg-gold/20"
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
        className="w-full rounded-full bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:opacity-90"
      >
        Create account →
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
