import { essayDraft, essayPrompt, persona, scholarships } from "@/lib/persona";
import type { UserProfile } from "@/lib/userStore";

function formatExperiences(): string {
  const { experiences } = persona;
  const lines: string[] = [persona.shortBio, ""];

  const sections = [
    ["Research", experiences.research],
    ["Leadership", experiences.leadership],
    ["Work", experiences.work],
  ] as const;

  for (const [label, items] of sections) {
    lines.push(`${label}:`);
    for (const item of items) {
      lines.push(`${item.title} (${item.when})`);
      for (const bullet of item.bullets) lines.push(`- ${bullet}`);
      lines.push("");
    }
  }

  lines.push("Awards:");
  for (const award of experiences.awards) lines.push(`- ${award}`);

  return lines.join("\n").trim();
}

/** Demo profile from persona.ts — preserves profile name/email when provided. */
export function loadExampleProfile(
  account?: Pick<UserProfile, "name" | "email" | "id">,
): Partial<UserProfile> {
  const shpe = scholarships[0];
  const { experiences } = persona;

  return {
    name: account?.name ?? persona.name,
    email: account?.email ?? persona.email,
    id: account?.id,
    pronouns: persona.pronouns,
    location: persona.location,
    citizenshipStatus: "U.S. citizen",
    raceEthnicity: "Hispanic / Latina",
    hispanicLatino: "Yes",
    identity: persona.identity,
    firstGen: persona.firstGen,
    pellEligible: persona.pellEligible,
    careerGoal: persona.careerGoal,
    educationLevel: "undergrad",
    undergrad: {
      institution: persona.school,
      currentYear: "Sophomore",
      major: persona.major,
      minor: persona.minor,
      gpa: persona.gpa,
      experience: formatExperiences(),
      orgsLeadership:
        "VP Outreach — SHPE Rice Chapter; peer tutor at Rice OWL Center (CS & Calculus).",
      needsHelpWith: ["essay", "scholarship_discovery"],
    },
    optional: {
      resumeFileName: "Resume_Maya_Rodriguez_Fall2026.pdf",
      volunteering: experiences.volunteer
        .map((item) => `${item.title} (${item.when})\n${item.bullets.join("\n")}`)
        .join("\n\n"),
      societyInvolvement: "Society of Hispanic Professional Engineers — Rice Chapter",
      leadership: "VP Outreach organizing Code-with-Me nights for McAllen ISD high schoolers",
      projects:
        "ML diabetes risk prediction research at Rice DataLab; weekly virtual STEM tutoring for 40+ high schoolers",
    },
    prompts: {
      challenge:
        "Learning to code on a library Chromebook in McAllen while working at my family's restaurant",
      leadership: "VP Outreach for SHPE Rice — Code-with-Me nights and travel stipend fundraising",
      teamwork: "Peer tutoring intro CS students who feel behind like I once did",
    },
    documents: persona.documents.map(({ name, kind }) => ({ name, kind })),
    activeScholarship: {
      name: shpe.name,
      type: "Merit-based",
      url: `https://${shpe.source}`,
      awardAmount: shpe.amount,
      applicationDeadline: shpe.deadline,
      description: shpe.blurb,
      enrollmentLevel: "Undergraduate",
      citizenshipRequirement: "U.S. citizen or permanent resident",
      eligibleMajors: "STEM — Computer Science, Engineering, and related fields",
      otherEligibilityRules:
        "Hispanic heritage; active SHPE membership or community involvement; minimum 3.0 GPA",
      requiredDocumentTypes: ["Resume", "Transcript", "Recommendation letter", "Personal essay"],
      essayPrompts: essayPrompt,
      additionalNotes: `Sponsor: ${shpe.sponsor}. Tags: ${shpe.tags.join(", ")}.`,
    },
    essayDraft,
    drafts: undefined,
    applications: [
      {
        id: "shpe-2026",
        name: "SHPE Foundation Scholarship",
        type: "Merit-based",
        status: "Drafting",
        scoreHistory: [32, 48, 61, 70, 78],
        updatedAt: daysAgo(2),
      },
      {
        id: "hsf-2026",
        name: "Hispanic Scholarship Fund — General",
        type: "Need-based",
        status: "Drafting",
        scoreHistory: [40, 45],
        updatedAt: daysAgo(6),
      },
      {
        id: "google-wts-2026",
        name: "Generation Google Scholarship",
        type: "Merit-based",
        status: "Submitted",
        scoreHistory: [55, 66, 82],
        updatedAt: daysAgo(10),
      },
      {
        id: "texas-first-gen-2026",
        name: "Texas First-Gen Excellence Award",
        type: "Merit-based",
        status: "Awarded",
        scoreHistory: [60, 74, 88],
        updatedAt: daysAgo(30),
      },
    ],
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
