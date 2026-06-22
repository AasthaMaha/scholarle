// Real persona data — Maya Rodriguez, our example Scholar-E user.
// Everything in the prototype reads from here so the journey feels real.

export const persona = {
  name: "Maya Rodriguez",
  initials: "MR",
  pronouns: "she/her",
  email: "maya.rodriguez@rice.edu",
  level: "Undergraduate — Sophomore",
  school: "Rice University",
  location: "Houston, TX",
  hometown: "McAllen, TX",
  major: "Computer Science",
  minor: "Cognitive Sciences",
  gpa: "3.87",
  firstGen: true,
  pellEligible: true,
  identity: ["Hispanic / Latina", "First-generation college student", "Woman in STEM"],
  careerGoal:
    "Become a machine learning researcher focused on accessible healthcare tools for underserved communities.",
  shortBio:
    "Daughter of two restaurant workers from the Rio Grande Valley. Started coding on a library Chromebook in 10th grade. Now researching ML for early diabetes screening.",
  experiences: {
    research: [
      {
        title: "Undergraduate Researcher — Rice DataLab",
        when: "Jan 2026 – present",
        bullets: [
          "Building a logistic-regression baseline for early diabetes risk prediction on de-identified clinic data (n≈12k).",
          "Co-authoring poster submission to RUR Symposium 2026.",
        ],
      },
    ],
    leadership: [
      {
        title: "VP Outreach — Society of Hispanic Professional Engineers, Rice Chapter",
        when: "Aug 2025 – present",
        bullets: [
          "Organize monthly Code-with-Me nights for 40+ McAllen ISD high schoolers (virtual).",
          "Raised $4,200 for travel stipends so first-gen members could attend SHPE National.",
        ],
      },
    ],
    work: [
      {
        title: "Peer Tutor — Rice OWL Center (CS & Calculus)",
        when: "Sep 2025 – present",
        bullets: ["8 hrs/week tutoring intro CS and Calc II to ~15 students per semester."],
      },
      {
        title: "Server — La Casita Restaurant (family business)",
        when: "Summers 2019 – 2024",
        bullets: ["Managed weekend dinner shifts and trained 4 new hires."],
      },
    ],
    volunteer: [
      {
        title: "Library Volunteer — McAllen Public Library",
        when: "2021 – 2024",
        bullets: ["Ran weekly STEM reading hour for K–5 students in Spanish and English."],
      },
    ],
    awards: [
      "Rice Century Scholars — Top 5% of incoming class (2024)",
      "Texas Future Engineers Award — $2,500 (2024)",
      "AP Scholar with Distinction (2024)",
    ],
  },
  documents: [
    { name: "Resume_Maya_Rodriguez_Fall2026.pdf", kind: "Resume", uploaded: true, size: "186 KB" },
    { name: "Rice_Transcript_Unofficial.pdf", kind: "Transcript", uploaded: true, size: "92 KB" },
    { name: "Recommendation_Dr_Chen.pdf", kind: "Rec letter", uploaded: true, size: "210 KB" },
    { name: "Recommendation_Prof_Alvarez.pdf", kind: "Rec letter", uploaded: false, size: "—" },
  ],
};

export type JourneyStep = {
  id: number;
  slug: string;
  title: string;
  goal: string;
  group: "Discover" | "Analyze" | "Apply" | "Track";
};

export const journeySteps: JourneyStep[] = [
  { id: 1, slug: "land", title: "Land on Platform", goal: "Learn & onboard", group: "Discover" },
  { id: 2, slug: "profile", title: "Create Profile", goal: "Get started", group: "Discover" },
  { id: 3, slug: "discovery", title: "Scholarship Discovery", goal: "Find opportunities", group: "Discover" },
  { id: 4, slug: "opportunities", title: "Identify Opportunities", goal: "Choose opportunities", group: "Discover" },
  { id: 5, slug: "import", title: "Import Scholarship Info", goal: "Provide details", group: "Analyze" },
  { id: 6, slug: "requirements", title: "Analyze Requirements & Fit", goal: "Understand fit", group: "Analyze" },
  { id: 7, slug: "essay-outline", title: "Personalized Outline", goal: "Plan your draft", group: "Apply" },
  { id: 8, slug: "essay-upload", title: "Upload Essay Draft", goal: "Submit your draft", group: "Apply" },
  { id: 9, slug: "scores", title: "Application Evaluation", goal: "Get evaluation", group: "Apply" },
  { id: 10, slug: "highlights", title: "Review Highlights", goal: "Understand gaps", group: "Apply" },
  { id: 11, slug: "revise", title: "Revise Essay", goal: "Make it stronger", group: "Apply" },
  { id: 12, slug: "resubmit", title: "Resubmit for Review", goal: "Improve score", group: "Apply" },
  { id: 13, slug: "final-check", title: "Final Submission Check", goal: "Ensure readiness", group: "Track" },
  { id: 14, slug: "tracker", title: "Track Application Status", goal: "Stay organized", group: "Track" },
];

// Curated scholarships matched to Maya's profile
export const scholarships = [
  {
    id: "shpe-2026",
    name: "SHPE Foundation Scholarship",
    sponsor: "Society of Hispanic Professional Engineers",
    amount: "$5,000",
    deadline: "April 30, 2026",
    daysLeft: 47,
    matchScore: 94,
    eligibilityScore: 100,
    tags: ["Hispanic/Latinx", "STEM", "Undergraduate"],
    blurb: "Awarded to Hispanic students pursuing STEM degrees with leadership in the SHPE community.",
    source: "shpe.org/scholarships",
    state: "Applying",
  },
  {
    id: "gem-2026",
    name: "Hispanic Scholarship Fund — General",
    sponsor: "HSF",
    amount: "$500 – $5,000",
    deadline: "February 15, 2026",
    daysLeft: 12,
    matchScore: 91,
    eligibilityScore: 100,
    tags: ["Hispanic/Latinx", "Any major", "Need-based"],
    blurb: "Renewable award for Hispanic-heritage students of any major demonstrating academic merit.",
    source: "hsf.net",
    state: "Drafting",
  },
  {
    id: "google-wts-2026",
    name: "Generation Google Scholarship",
    sponsor: "Google",
    amount: "$10,000",
    deadline: "December 5, 2026",
    daysLeft: 174,
    matchScore: 88,
    eligibilityScore: 100,
    tags: ["Women in CS", "Undergraduate", "Merit"],
    blurb: "For students who identify with a group historically excluded from the tech industry.",
    source: "buildyourfuture.withgoogle.com",
    state: "Interested",
  },
  {
    id: "jkc-2026",
    name: "Jack Kent Cooke Undergraduate Transfer",
    sponsor: "JKC Foundation",
    amount: "Up to $55,000/yr",
    deadline: "Not eligible — non-transfer",
    daysLeft: null,
    matchScore: 22,
    eligibilityScore: 0,
    tags: ["Transfer students only"],
    blurb: "For community college students transferring to a 4-year institution.",
    source: "jkcf.org",
    state: "Not eligible",
  },
  {
    id: "tfe-2026",
    name: "Texas First-Gen Excellence Award",
    sponsor: "Greater Texas Foundation",
    amount: "$3,000",
    deadline: "March 22, 2026",
    daysLeft: 27,
    matchScore: 96,
    eligibilityScore: 100,
    tags: ["First-gen", "Texas resident", "Undergraduate"],
    blurb: "Supports first-generation Texas undergraduates with a record of community impact.",
    source: "greatertexasfoundation.org",
    state: "Interested",
  },
];

export const discoveryResources = [
  { name: "SHPE Foundation", reason: "Matches your Hispanic + STEM profile", url: "shpe.org" },
  { name: "Hispanic Scholarship Fund", reason: "Largest Latino-serving scholarship org", url: "hsf.net" },
  { name: "I'm First!", reason: "Curated lists for first-gen students", url: "imfirst.org" },
  { name: "Bold.org", reason: "Quick-apply scholarships for women in CS", url: "bold.org" },
  { name: "Greater Texas Foundation", reason: "Texas-specific awards", url: "greatertexasfoundation.org" },
  { name: "Rice OFA Database", reason: "Institutional & departmental awards", url: "ofa.rice.edu" },
];

// Maya's essay for the SHPE Foundation Scholarship prompt
export const essayPrompt =
  "In 500 words or fewer, describe a challenge you have overcome and how it has prepared you to contribute to the SHPE community.";

export const essayDraft = `Growing up in McAllen, Texas, I did not know what an engineer was until I was fifteen years old. My parents work at a small restaurant and the closest thing I had to a computer was a shared family phone. Things were hard sometimes.

In tenth grade, my school got a grant for Chromebooks and I checked one out from the library every single day. I taught myself Python from free YouTube videos. I would stay up late and code while my mom prepped for the next day's lunch service. I really liked it.

When I got to Rice, I felt very behind. A lot of my classmates had been coding since middle school and already had internships. I almost dropped out of CS after my first midterm in COMP 215. But I joined SHPE and I met other Latina students who had been through the same thing. They told me to keep going.

Now I am a peer tutor and I help intro CS students who feel the way I felt. I also run Code-with-Me nights for high schoolers in McAllen ISD over Zoom. Last semester we had 42 students show up consistently. I think it is important.

If I receive this scholarship, I will use it to attend SHPE National and continue my research on machine learning for diabetes screening, which affects so many people in my community. Thank you for considering my application.`;

// Highlighted feedback — Grammarly-style
export const essayFeedback = [
  {
    quote: "Things were hard sometimes.",
    category: "Specificity",
    severity: "high",
    note: "Vague closer to a powerful paragraph. Replace with one concrete detail that shows the difficulty.",
    suggestion:
      "Some nights I did homework on the restaurant counter between checking out tables, my AP Calc book stained with red salsa.",
  },
  {
    quote: "I really liked it.",
    category: "Specificity",
    severity: "high",
    note: "Tells instead of shows. What did the moment of liking it feel like?",
    suggestion:
      "The first time my script printed the right answer to a problem, I yelled loud enough that my mom came running.",
  },
  {
    quote: "They told me to keep going.",
    category: "Storytelling",
    severity: "medium",
    note: "Strong moment — name a person or a specific exchange to land it.",
    suggestion:
      "Ana, a junior, slid her own midterm across the table — a 62 — and said, 'You don't quit because of one number.'",
  },
  {
    quote: "I think it is important.",
    category: "Impact",
    severity: "medium",
    note: "Close on quantified impact instead of an opinion.",
    suggestion:
      "Three of those students applied to college this fall — two to Rice — and one told me she's majoring in CS because of those Tuesday nights.",
  },
  {
    quote: "Thank you for considering my application.",
    category: "Structure",
    severity: "low",
    note: "Generic closer. SHPE essays land best when the final line reinforces your contribution to the community.",
    suggestion:
      "SHPE was the room that kept me in engineering. I'd like the chance to keep building that room for the students coming up behind me.",
  },
];

export const submissionChecklist = [
  { item: "Resume uploaded (PDF, < 2 pages)", done: true },
  { item: "Unofficial transcript uploaded", done: true },
  { item: "Recommendation letter — Dr. Chen", done: true },
  { item: "Recommendation letter — Prof. Alvarez", done: false },
  { item: "Personal essay — 487 / 500 words", done: true },
  { item: "Short answer (250 words) — community impact", done: true },
  { item: "FAFSA Student Aid Index verified", done: true },
  { item: "Confirm mailing address with SHPE portal", done: false },
];
