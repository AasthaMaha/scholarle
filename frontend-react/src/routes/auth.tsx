import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useUser } from "@/lib/userStore";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · Scholar-E" },
      { name: "description", content: "Create your Scholar-E account or sign in to walk through the journey." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { signIn } = useUser();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    signIn(email, mode === "signup" ? name || email.split("@")[0] : undefined);
    navigate({ to: "/journey" });
  }

  function handleGoogle() {
    signIn("you@gmail.com", "Google User");
    navigate({ to: "/journey" });
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-primary text-primary-foreground">
        <Link to="/" className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-primary-foreground text-primary grid place-items-center font-display font-bold">
            S<span className="text-gold">e</span>
          </div>
          <span className="font-display font-semibold text-lg">Scholar-E</span>
        </Link>
        <div>
          <h1 className="font-display text-4xl md:text-5xl leading-tight text-balance">
            Win scholarships <span className="italic">in your own voice.</span>
          </h1>
          <p className="mt-4 text-primary-foreground/80 max-w-md">
            Create an account to walk through the full 17-step Scholar-E journey as yourself —
            your profile, your essay, your applications.
          </p>
        </div>
        <div className="text-xs text-primary-foreground/60">A coach, not a ghostwriter.</div>
      </div>

      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">← Back to home</Link>
          <h2 className="font-display text-3xl mt-4">
            {mode === "signup" ? "Create your account" : "Welcome back"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "signup"
              ? "It only takes a moment — we don't ask for anything you don't need."
              : "Sign in to continue your scholarship journey."}
          </p>

          <button
            onClick={handleGoogle}
            className="mt-6 w-full inline-flex items-center justify-center gap-3 rounded-full border border-border bg-card px-4 py-3 text-sm font-medium hover:bg-accent"
          >
            <GoogleIcon /> Continue with Google
          </button>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            or use email
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <Field label="Full name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jordan Chen"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
                />
              </Field>
            )}
            <Field label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@university.edu"
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
              />
            </Field>

            <button
              type="submit"
              className="w-full rounded-full bg-primary text-primary-foreground px-4 py-3 text-sm font-medium hover:opacity-90"
            >
              {mode === "signup" ? "Create account & start" : "Sign in"} →
            </button>
          </form>

          <div className="mt-5 text-sm text-muted-foreground text-center">
            {mode === "signup" ? "Already have an account?" : "New to Scholar-E?"}{" "}
            <button
              onClick={() => setMode(mode === "signup" ? "login" : "signup")}
              className="text-primary font-medium hover:underline"
            >
              {mode === "signup" ? "Sign in" : "Create an account"}
            </button>
          </div>

          <p className="mt-6 text-[11px] text-muted-foreground text-center">
            Prototype mode — any email and password are accepted.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.63z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A9 9 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.29-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.33z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
    </svg>
  );
}
