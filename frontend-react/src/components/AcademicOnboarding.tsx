import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { type EducationHistoryEntry, type EducationLevel, type UserProfile } from "@/lib/userStore";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const ACADEMIC_LEVELS = [
  "High School",
  "Associate Degree",
  "Bachelor's Degree",
  "Master's Degree",
  "Doctoral Degree",
  "Professional Degree (JD, MD, DDS, etc.)",
  "Other",
] as const;

export type AcademicLevel = (typeof ACADEMIC_LEVELS)[number];
type Question = "level" | "school" | "major" | "graduation";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function questionsForLevel(level: string): Question[] {
  return level === "High School"
    ? ["level", "school", "graduation"]
    : ["level", "school", "major", "graduation"];
}

function levelCode(level: AcademicLevel): EducationLevel {
  if (level === "High School") return "high_school";
  if (level === "Associate Degree" || level === "Bachelor's Degree") return "undergrad";
  if (level === "Doctoral Degree") return "phd";
  return "grad";
}

function splitGraduation(value = "") {
  const normalized = value.trim();
  const complete = normalized.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (complete) return { month: complete[1], year: complete[2] };
  if (MONTHS.includes(normalized)) return { month: normalized, year: "" };
  if (/^\d{4}$/.test(normalized)) return { month: "", year: normalized };
  return { month: "", year: "" };
}

function promptFor(level: AcademicLevel, question: Question) {
  if (question === "school") {
    return level === "Other"
      ? "Which school or institution do you currently attend?"
      : "Which school do you currently attend?";
  }
  if (question === "major") {
    if (level === "Associate Degree") return "What is your major or field of study?";
    if (level === "Bachelor's Degree") return "What is your major?";
    if (level === "Master's Degree")
      return "What is your major, field of study, or graduate program?";
    if (level === "Doctoral Degree") return "What is your field of study or doctoral program?";
    if (level === "Professional Degree (JD, MD, DDS, etc.)")
      return "What professional program are you pursuing?";
    if (level === "Other") return "What program or field are you pursuing?";
    return "What is your major or field of study?";
  }
  return level === "Other"
    ? "When do you expect to complete it?"
    : "When do you expect to graduate?";
}

function programForLevel(level: AcademicLevel, major: string) {
  if (level === "High School") return "High school diploma";
  if (level === "Professional Degree (JD, MD, DDS, etc.)" || level === "Other") return major;
  return level;
}

function profilePatch(
  user: UserProfile,
  level: AcademicLevel,
  entry: EducationHistoryEntry,
): Partial<UserProfile> {
  const graduation = splitGraduation(entry.endDate);
  const code = levelCode(level);
  const base = {
    educationLevel: code,
    educationHistory: [entry, ...(user.educationHistory?.slice(1) ?? [])],
  };

  if (code === "high_school") {
    return {
      ...base,
      highSchool: {
        ...(user.highSchool ?? {}),
        institution: entry.institution,
        gradMonth: graduation.month,
        gradYear: graduation.year,
      },
    };
  }
  if (code === "undergrad") {
    return {
      ...base,
      undergrad: {
        ...(user.undergrad ?? {}),
        institution: entry.institution,
        major: entry.majorField,
        collegeType: level === "Associate Degree" ? "2-year" : user.undergrad?.collegeType,
      },
    };
  }
  return {
    ...base,
    graduate: {
      ...(user.graduate ?? {}),
      graduateLevel:
        level === "Doctoral Degree"
          ? "PhD"
          : level === "Master's Degree"
            ? "Master's"
            : level === "Professional Degree (JD, MD, DDS, etc.)"
              ? entry.majorField
              : "Other",
      institution: entry.institution,
      program: entry.majorField,
      researchArea: level === "Doctoral Degree" ? entry.majorField : user.graduate?.researchArea,
    },
  };
}

export function AcademicOnboarding({
  open,
  user,
  updateProfile,
  onComplete,
}: {
  open: boolean;
  user: UserProfile;
  updateProfile: (patch: Partial<UserProfile>) => void;
  onComplete: () => void;
}) {
  const initialEntry = user.educationHistory?.[0];
  const initialLevel =
    ACADEMIC_LEVELS.find((level) => level === initialEntry?.educationLevel) ?? "";
  const [level, setLevel] = useState<AcademicLevel | "">(initialLevel);
  const [step, setStep] = useState(0);
  const navigationLocked = useRef(false);
  const [entry, setEntry] = useState<EducationHistoryEntry>({
    id: initialEntry?.id || "edu-academic-onboarding",
    source: initialEntry?.source || "onboarding",
    isCurrent: initialEntry?.isCurrent ?? true,
    educationLevel: initialLevel,
    institution: initialEntry?.institution ?? "",
    degreeProgram: initialEntry?.degreeProgram ?? "",
    majorField: initialEntry?.majorField ?? "",
    department: initialEntry?.department ?? "",
    gpa: initialEntry?.gpa ?? "",
    startDate: initialEntry?.startDate ?? "",
    endDate: initialEntry?.endDate ?? "",
  });
  const questions = useMemo(() => questionsForLevel(level), [level]);
  const question = questions[Math.min(step, questions.length - 1)];
  const graduation = splitGraduation(entry.endDate);
  const years = useMemo(
    () => Array.from({ length: 16 }, (_, i) => String(new Date().getFullYear() + i)),
    [],
  );

  function save(nextLevel: AcademicLevel, nextEntry: EducationHistoryEntry) {
    updateProfile(profilePatch(user, nextLevel, nextEntry));
  }

  function chooseLevel(nextLevel: AcademicLevel) {
    if (navigationLocked.current) return;
    navigationLocked.current = true;
    const hadMajor = level !== "" && level !== "High School";
    const keepsMajor = nextLevel !== "High School";
    const nextEntry = {
      ...entry,
      educationLevel: nextLevel,
      majorField: hadMajor && !keepsMajor ? "" : entry.majorField,
      degreeProgram: programForLevel(
        nextLevel,
        hadMajor && !keepsMajor ? "" : (entry.majorField ?? ""),
      ),
    };
    setLevel(nextLevel);
    setEntry(nextEntry);
    setStep(1);
    save(nextLevel, nextEntry);
    requestAnimationFrame(() => {
      navigationLocked.current = false;
    });
  }

  function updateEntry(patch: Partial<EducationHistoryEntry>) {
    if (!level) return;
    const nextEntry = { ...entry, ...patch };
    if (patch.majorField !== undefined)
      nextEntry.degreeProgram = programForLevel(level, patch.majorField);
    setEntry(nextEntry);
    save(level, nextEntry);
  }

  const canContinue =
    question === "level"
      ? !!level
      : question === "school"
        ? !!entry.institution?.trim()
        : question === "graduation"
          ? !!graduation.month && !!graduation.year
          : !!entry.majorField?.trim();

  function next() {
    if (!canContinue || !level || navigationLocked.current) return;
    navigationLocked.current = true;
    if (step === questions.length - 1) {
      updateProfile({ ...profilePatch(user, level, entry), academicOnboardingCompleted: true });
      onComplete();
      return;
    }
    setStep((current) => current + 1);
    requestAnimationFrame(() => {
      navigationLocked.current = false;
    });
  }

  return (
    <Dialog open={open}>
      <DialogContent
        className="w-[calc(100%-1.5rem)] max-w-lg gap-0 overflow-hidden rounded-2xl p-0 [&>button]:hidden"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <div className="border-b border-border/70 px-4 pb-3 pt-4 sm:px-5">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={step === 0}
              aria-label="Previous question"
              className="grid size-9 place-items-center rounded-full hover:bg-accent disabled:opacity-30"
            >
              <ArrowLeft className="size-4" />
            </button>
            <span className="text-xs font-medium text-muted-foreground">
              Step {step + 1} of {questions.length}
            </span>
            <button
              type="button"
              onClick={next}
              disabled={!canContinue}
              aria-label={
                step === questions.length - 1 ? "Finish academic onboarding" : "Next question"
              }
              className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ArrowRight className="size-4" />
            </button>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${((step + 1) / questions.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="max-h-[min(70vh,540px)] overflow-y-auto px-5 py-5 sm:px-6">
          <DialogTitle className="font-display text-xl leading-snug sm:text-2xl">
            {question === "level"
              ? "Which education level are you currently pursuing?"
              : promptFor(level as AcademicLevel, question)}
          </DialogTitle>
          <DialogDescription className="mt-1.5 text-sm">
            {question === "major"
              ? level === "Professional Degree (JD, MD, DDS, etc.)"
                ? "For example, Law, Medicine, Dentistry, Pharmacy, or Veterinary Medicine."
                : "This helps personalize scholarship matches."
              : "This will be added to your student profile."}
          </DialogDescription>

          {question === "level" && (
            <div className="mt-4 grid gap-2">
              {ACADEMIC_LEVELS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={level === option}
                  onClick={() => chooseLevel(option)}
                  className={`flex min-h-11 items-center justify-between rounded-xl border px-4 py-2.5 text-left text-sm font-medium transition-colors ${level === option ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-accent"}`}
                >
                  <span>{option}</span>
                  {level === option && <Check className="size-4 shrink-0" />}
                </button>
              ))}
            </div>
          )}
          {question === "school" && (
            <input
              autoFocus
              value={entry.institution ?? ""}
              onChange={(event) => updateEntry({ institution: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") next();
              }}
              placeholder="School or institution name"
              className="mt-5 w-full rounded-lg border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
            />
          )}
          {question === "major" && (
            <input
              autoFocus
              value={entry.majorField ?? ""}
              onChange={(event) => updateEntry({ majorField: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") next();
              }}
              placeholder="Major, field, or program"
              className="mt-5 w-full rounded-lg border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
            />
          )}
          {question === "graduation" && (
            <div className="relative z-10 mt-5 grid grid-cols-2 gap-3">
              <label className="text-sm font-medium">
                Month
                <select
                  value={graduation.month}
                  onChange={(event) =>
                    updateEntry({
                      endDate: [event.target.value, graduation.year].filter(Boolean).join(" "),
                    })
                  }
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">Select month</option>
                  {MONTHS.map((month) => (
                    <option key={month}>{month}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                Year
                <select
                  value={graduation.year}
                  onChange={(event) =>
                    updateEntry({
                      endDate: [graduation.month, event.target.value].filter(Boolean).join(" "),
                    })
                  }
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">Select year</option>
                  {years.map((year) => (
                    <option key={year}>{year}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
