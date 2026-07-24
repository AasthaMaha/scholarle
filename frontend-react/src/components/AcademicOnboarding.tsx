import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import scholarELogoUrl from "../../logo/logoPic.jpeg";

import { EducationAutocomplete } from "@/components/EducationAutocomplete";
import { searchMajors, searchSchools } from "@/lib/api/educationCatalog";
import { type EducationHistoryEntry, type EducationLevel, type UserProfile } from "@/lib/userStore";

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
    return "What is your major?";
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
  const [leaving, setLeaving] = useState(false);
  const [manualSchool, setManualSchool] = useState(false);
  const [manualMajor, setManualMajor] = useState(false);
  const navigationLocked = useRef(false);
  const questionHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const completionTimerRef = useRef<number | null>(null);
  const [entry, setEntry] = useState<EducationHistoryEntry>({
    id: initialEntry?.id || "edu-academic-onboarding",
    source: initialEntry?.source || "onboarding",
    isCurrent: initialEntry?.isCurrent ?? true,
    educationLevel: initialLevel,
    institution: initialEntry?.institution ?? "",
    institutionId: initialEntry?.institutionId ?? "",
    institutionType: initialEntry?.institutionType,
    institutionLocation: initialEntry?.institutionLocation ?? "",
    degreeProgram: initialEntry?.degreeProgram ?? "",
    majorField: initialEntry?.majorField ?? "",
    majorCipCode: initialEntry?.majorCipCode ?? "",
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

  useEffect(() => {
    if (!open) return;
    questionHeadingRef.current?.focus();
  }, [open, step]);

  useEffect(() => () => {
    if (completionTimerRef.current !== null) window.clearTimeout(completionTimerRef.current);
  }, []);

  function save(nextLevel: AcademicLevel, nextEntry: EducationHistoryEntry) {
    updateProfile(profilePatch(user, nextLevel, nextEntry));
  }

  function chooseLevel(nextLevel: AcademicLevel) {
    if (navigationLocked.current) return;
    navigationLocked.current = true;
    const hadMajor = level !== "" && level !== "High School";
    const keepsMajor = nextLevel !== "High School";
    const changesInstitutionKind = level !== "" && (level === "High School") !== (nextLevel === "High School");
    const nextEntry = {
      ...entry,
      educationLevel: nextLevel,
      majorField: hadMajor && !keepsMajor ? "" : entry.majorField,
      majorCipCode: hadMajor && !keepsMajor ? "" : entry.majorCipCode,
      institutionId: changesInstitutionKind ? "" : entry.institutionId,
      institutionType: changesInstitutionKind ? undefined : entry.institutionType,
      institutionLocation: changesInstitutionKind ? "" : entry.institutionLocation,
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
      setLeaving(true);
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      completionTimerRef.current = window.setTimeout(onComplete, reduceMotion ? 0 : 200);
      return;
    }
    setStep((current) => current + 1);
    requestAnimationFrame(() => {
      navigationLocked.current = false;
    });
  }

  if (!open) return null;

  return (
    <div
      className={`academic-onboarding min-h-screen overflow-y-auto bg-[radial-gradient(circle_at_50%_20%,rgba(109,93,246,0.10),transparent_36%),linear-gradient(180deg,#fbfaff_0%,#f4f2fb_100%)] font-sans text-foreground transition-opacity duration-200 motion-reduce:transition-none ${leaving ? "opacity-0" : "opacity-100"}`}
    >
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center px-3 pb-10 pt-[clamp(1.25rem,4vh,2.5rem)] sm:px-6">
        <div className="mb-3 flex items-center justify-center gap-2">
          <img src={scholarELogoUrl} alt="" className="size-8 rounded-full object-cover" />
          <span className="font-display text-sm font-semibold tracking-tight text-foreground">Scholar-E</span>
        </div>

        <div className="text-center">
          <h1 className="onboarding-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Set up your profile
          </h1>
          <p className="mt-1.5 text-base font-medium text-foreground/75 sm:text-lg">
            Answer a few quick questions so Scholar-E can personalize your experience.
          </p>
        </div>

        <section
          aria-labelledby="academic-onboarding-question"
          className="mt-7 w-full max-w-xl overflow-hidden rounded-2xl border border-info/15 bg-white shadow-[0_24px_64px_-36px_rgba(31,42,68,0.38)] motion-reduce:animate-none"
        >
        <div className="border-b border-info/10 px-4 pb-3 pt-5 sm:px-5">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={step === 0}
              aria-label="Previous question"
              className="grid size-9 place-items-center rounded-full text-foreground transition-colors hover:bg-info/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30 disabled:opacity-30"
            >
              <ArrowLeft className="size-4" />
            </button>
            <span className="text-xs font-medium text-muted-foreground">
              Step {step + 1} of {questions.length}
            </span>
            <span className="size-9" aria-hidden="true" />
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-info/10">
            <div
              className="h-full rounded-full bg-info transition-[width]"
              style={{ width: `${((step + 1) / questions.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="px-5 py-5 sm:px-6">
          <h2
            id="academic-onboarding-question"
            ref={questionHeadingRef}
            tabIndex={-1}
            className="onboarding-heading text-xl font-semibold leading-snug text-foreground outline-none sm:text-2xl"
          >
            {question === "level"
              ? "Which education level are you currently pursuing?"
              : promptFor(level as AcademicLevel, question)}
          </h2>
          <p className={`mt-1.5 ${question === "major" ? "text-sm text-muted-foreground" : "text-[15px] font-medium text-foreground/70"}`}>
            {question === "major"
              ? level === "Professional Degree (JD, MD, DDS, etc.)"
                ? "For example, Law, Medicine, Dentistry, Pharmacy, or Veterinary Medicine."
                : "This helps personalize scholarship matches."
              : "This will be added to your student profile."}
          </p>

          {question === "level" && (
            <div className="mt-4 grid gap-2">
              {ACADEMIC_LEVELS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={level === option}
                  onClick={() => chooseLevel(option)}
                  className={`flex min-h-11 items-center justify-between rounded-xl border px-4 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30 ${level === option ? "border-info/55 bg-info/[0.08] text-info" : "border-info/15 bg-white text-foreground hover:border-info/35 hover:bg-info/[0.025]"}`}
                >
                  <span>{option}</span>
                  {level === option && <Check className="size-4 shrink-0" />}
                </button>
              ))}
            </div>
          )}
          {question === "school" && (
            manualSchool ? (
              <div className="mt-5">
                <input
                  autoFocus
                  value={entry.institution ?? ""}
                  onChange={(event) => updateEntry({ institution: event.target.value, institutionId: "", institutionType: "manual", institutionLocation: "" })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") next();
                  }}
                  aria-label="Enter your school manually"
                  placeholder="School or institution name"
                  className="w-full rounded-lg border border-info/15 bg-white px-3 py-3 text-sm text-foreground outline-none transition-colors hover:border-info/30 focus:border-info/60 focus:ring-2 focus:ring-info/20"
                />
                <button type="button" onClick={() => setManualSchool(false)} className="mt-2 text-xs font-medium text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30">
                  Search for my school instead
                </button>
              </div>
            ) : (
              <EducationAutocomplete
                value={entry.institution ?? ""}
                placeholder="Search by school name"
                minimumCharacters={2}
                ariaLabel="Search for your school"
                noResultsText="No matching schools found."
                accent="info"
                fallbackOption={{ id: "manual-school", label: "I can’t find my school" }}
                search={async (query, signal) =>
                  (await searchSchools(query, level === "High School" ? "high_school" : "postsecondary", signal)).map((school) => ({
                    id: school.id,
                    label: school.name,
                    secondary: school.location,
                    institutionType: school.institutionType,
                    location: school.location,
                  }))
                }
                onSelect={(option, query) => {
                  if (option.id === "manual-school") {
                    const manualValue = query.trim() || entry.institution || "";
                    setManualSchool(true);
                    updateEntry({ institution: manualValue, institutionId: "", institutionType: "manual", institutionLocation: "" });
                    return;
                  }
                  updateEntry({
                    institution: option.label,
                    institutionId: option.id,
                    institutionType: option.institutionType,
                    institutionLocation: option.location ?? "",
                  });
                }}
              />
            )
          )}
          {question === "major" && (
            manualMajor ? (
              <div className="mt-5">
                <input
                  autoFocus
                  value={entry.majorField ?? ""}
                  onChange={(event) => updateEntry({ majorField: event.target.value, majorCipCode: "" })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") next();
                  }}
                  aria-label="Enter your major manually"
                  placeholder="Major, field, or program"
                  className="w-full rounded-lg border border-info/15 bg-white px-3 py-3 text-sm text-foreground outline-none transition-colors hover:border-info/30 focus:border-info/60 focus:ring-2 focus:ring-info/20"
                />
                <button type="button" onClick={() => setManualMajor(false)} className="mt-2 text-xs font-medium text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30">
                  Search standardized majors instead
                </button>
              </div>
            ) : (
              <EducationAutocomplete
                value={entry.majorField ?? ""}
                placeholder="Search for your major"
                ariaLabel="Search for your major"
                accent="info"
                pinnedOptions={[
                  { id: "major-undecided", label: "Undecided" },
                  { id: "major-other", label: "Other" },
                ]}
                noResultsText="No matching majors found."
                search={async (query, signal) =>
                  (await searchMajors(query, signal)).map((major) => ({
                    id: `cip-${major.cipCode}`,
                    label: major.name,
                    cipCode: major.cipCode,
                  }))
                }
                onSelect={(option, query) => {
                  if (option.id === "major-other") {
                    const typedValue = query.trim();
                    const manualValue = typedValue && typedValue.toLowerCase() !== "other" ? typedValue : "";
                    setManualMajor(true);
                    updateEntry({ majorField: manualValue, majorCipCode: "" });
                    return;
                  }
                  updateEntry({ majorField: option.label, majorCipCode: option.cipCode ?? "" });
                }}
              />
            )
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
                  className="mt-1.5 w-full rounded-lg border border-info/15 bg-white px-3 py-3 text-sm text-foreground outline-none transition-colors hover:border-info/30 focus:border-info/60 focus:ring-2 focus:ring-info/20"
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
                  className="mt-1.5 w-full rounded-lg border border-info/15 bg-white px-3 py-3 text-sm text-foreground outline-none transition-colors hover:border-info/30 focus:border-info/60 focus:ring-2 focus:ring-info/20"
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
        <div className="flex justify-end border-t border-info/10 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={next}
            disabled={!canContinue}
            aria-label={
              step === questions.length - 1 ? "Finish academic onboarding" : "Next question"
            }
            className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm transition-[background-color,box-shadow,opacity] hover:bg-primary/90 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none"
          >
            <ArrowRight className="size-4" />
          </button>
        </div>
        </section>
      </main>
    </div>
  );
}
