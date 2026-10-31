const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** Extract, lowercase and de-duplicate every valid email address found in `text`. */
export function extractEmails(text: string): string[] {
  const found = text.match(EMAIL_REGEX) ?? [];
  return Array.from(new Set(found.map((e) => e.toLowerCase())));
}

export function isValidEmail(value: string) {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value.trim());
}
