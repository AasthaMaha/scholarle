// Uploaded document metadata is persisted in the profile, while File objects
// remain in memory for the current browser session so Step 6 can package them.
const files = new Map<string, File>();

export function storeFile(name: string, file: File) {
  files.set(name, file);
}

export function getFile(name: string): File | undefined {
  return files.get(name);
}

export function removeFile(name: string) {
  files.delete(name);
}
