// Ported verbatim from the monolith's src/api/upload.routes.ts's extractTextFromFile - the shared
// helper both the recruiter-facing (upload.routes.ts) and candidate-facing
// (candidate-resume.routes.ts, which imported it FROM upload.routes.ts) paths already used before
// this extraction. Now lives once, here, used by both of this service's own routes.
import fs from 'fs';
import path from 'path';
import * as pdf from 'pdf-parse';
import WordExtractor from 'word-extractor';

export async function extractTextFromFile(filePath: string, originalName: string): Promise<string> {
  const extension = path.extname(originalName).toLowerCase();
  const fileBuffer = fs.readFileSync(filePath);

  if (extension === '.pdf') {
    // pdf-parse's own type declarations don't expose a `default` property on the namespace
    // import for this version - cast to `any` before the property access (not just the whole
    // expression after) so strict mode doesn't flag it; runtime behavior is unchanged from the
    // monolith's original (which tolerates this implicitly, having no "strict": true).
    const pdfLib = ((pdf as any).default || pdf) as any;
    // Support newer pdf-parse 2.x class structure
    if (pdfLib.PDFParse) {
      const parser = new pdfLib.PDFParse({ data: fileBuffer });
      const pdfData = await parser.getText();
      return pdfData.text || '';
    } else {
      // Fallback for legacy pdf-parse 1.x function structure
      const pdfData = await pdfLib(fileBuffer);
      return pdfData.text || '';
    }
  } else if (extension === '.docx' || extension === '.doc') {
    const extractor = new WordExtractor();
    const doc = await extractor.extract(fileBuffer);
    return doc.getBody();
  } else if (extension === '.txt') {
    return fileBuffer.toString('utf-8');
  } else {
    throw new Error(`Unsupported file type: ${extension}`);
  }
}
