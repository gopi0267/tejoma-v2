const fs = require('fs');
const mammoth = require('mammoth');

async function main() {
  const filePath = 'resumes/EswarRatnaTejaAaripaka[6y_6m] (1)_Cybress Test(1).docx';
  const res = await mammoth.extractRawText({ path: filePath });
  console.log('--- Length:', res.value.length);
  console.log('--- Snippet:', res.value.substring(0, 300));
}

main().catch(console.error);
