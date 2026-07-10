export function extractPhone(text: string) {
  const regex = /(?:\+91[-.\s]?)?\d{10}|\+91\d{10}/g;
  const phones = text.match(regex);
  if (!phones) return "N/A";
  return phones[0].replace(/\D/g, '').slice(-10);
}