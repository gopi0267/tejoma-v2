export function extractEmail(text: string) {
  const regex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = text.match(regex);
  return emails ? emails[0] : "N/A";
}