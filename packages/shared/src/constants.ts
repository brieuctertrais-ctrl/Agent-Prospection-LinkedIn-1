export const LEAD_STATUSES = [
  "to_contact",
  "invitation_sent",
  "accepted",
  "replied",
  "meeting",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const COMPANY_SIZES = [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5000+",
] as const;

/** Subset of the LinkedIn industry taxonomy (V2). IDs are used to build search URLs. */
export const INDUSTRIES: { label: string; id?: string }[] = [
  { label: "Business Consulting and Services", id: "11" },
  { label: "IT Services and IT Consulting", id: "96" },
  { label: "Marketing Services", id: "1862" },
  { label: "Advertising Services", id: "80" },
  { label: "Professional Services", id: "1810" },
  { label: "Software Development", id: "4" },
  { label: "Staffing and Recruiting", id: "104" },
  { label: "Technology, Information and Internet", id: "6" },
  { label: "Technology, Information and Media", id: "1594" },
  { label: "Financial Services", id: "43" },
  { label: "Real Estate", id: "44" },
  { label: "Renewable Energy Power Generation", id: "3240" },
  { label: "Manufacturing", id: "25" },
  { label: "Retail", id: "27" },
  { label: "Education", id: "1999" },
];

/** LinkedIn geo URNs for common locations. Unknown locations fall back to a keyword. */
export const LOCATIONS: { label: string; geoUrn?: string }[] = [
  { label: "France", geoUrn: "105015875" },
  { label: "Belgique", geoUrn: "100565514" },
  { label: "Suisse", geoUrn: "106693272" },
  { label: "Canada", geoUrn: "101174742" },
  { label: "United States", geoUrn: "103644278" },
  { label: "United Kingdom", geoUrn: "101165590" },
  { label: "Germany", geoUrn: "101282230" },
  { label: "Spain", geoUrn: "105646813" },
  { label: "Paris" },
  { label: "Lyon" },
  { label: "Madrid" },
];

export const MAX_JOB_TITLES = 5;
export const MAX_KEYWORDS = 5;
export const INVITATION_MAX_CHARS = 300;
export const INVITATION_TARGET_MIN = 220;
export const INVITATION_TARGET_MAX = 280;

export const TRIAL_DAYS = 7;
export const TRIAL_MAX_PERSONAS = 3;

/** Prudent default automation quotas (editable in settings). */
export const DEFAULT_QUOTAS = {
  dailyProfileViews: 80,
  dailyInvitations: 20,
  weeklyInvitations: 100,
  dailyMessages: 50,
  minDelaySeconds: 45,
  maxDelaySeconds: 180,
  workStartHour: 9,
  workEndHour: 19,
  withdrawPendingAfterDays: 21,
  minMatchScore: 60,
} as const;
