const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export type SchoolSearchResult = {
  id: string;
  name: string;
  institutionType: "high_school" | "postsecondary";
  city: string;
  state: string;
  location: string;
};

export type MajorSearchResult = {
  cipCode: string;
  name: string;
};

async function getResults<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const response = await fetch(`${API_BASE}${path}`, { signal });
  if (!response.ok) throw new Error("Search is temporarily unavailable.");
  const payload = (await response.json()) as { results?: T[] };
  return payload.results ?? [];
}

export function searchSchools(
  query: string,
  institutionType: SchoolSearchResult["institutionType"],
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ q: query, kind: institutionType, limit: "10" });
  return getResults<SchoolSearchResult>(`/api/education/schools?${params}`, signal);
}

export function searchMajors(query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query, limit: "10" });
  return getResults<MajorSearchResult>(`/api/education/majors?${params}`, signal);
}
