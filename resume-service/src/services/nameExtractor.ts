// Ported verbatim from the monolith's nameExtractor.ts.
export function extractName(text: string) {
  const lines = text.split('\n').slice(0, 5).join(' ');
  const nameRegex = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/;
  const match = lines.match(nameRegex);
  return match ? match[1] : "N/A";
}
