/**
 * PEM key normalization - converts literal "\n" sequences to actual newlines.
 * Environment variable systems commonly deliver multi-line PEM with literal "\n"
 * rather than real newlines (e.g., AWS Secrets Manager).
 */
export function normalizePem(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}
