export type ScholarshipInputSource = "url" | "pdf" | "text";

export function isValidScholarshipUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname;
  } catch {
    return false;
  }
}

export function isMeaningfulScholarshipText(value: string): boolean {
  return value.trim().length >= 20;
}

export function scholarshipSourceIsReady(
  source: ScholarshipInputSource | null,
  options: { url: string; pdfReady: boolean; copiedText: string },
): boolean {
  if (source === "url") return isValidScholarshipUrl(options.url);
  if (source === "pdf") return options.pdfReady;
  if (source === "text") return isMeaningfulScholarshipText(options.copiedText);
  return false;
}

export function formatUploadSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
