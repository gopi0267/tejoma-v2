import fs from 'fs';
import path from 'path';
import admZip from 'adm-zip';

const filePath = 'c:/Users/gopiy/Downloads/tejoma-rec/resumes/DodleVinayKumar[5y_0m]_.net Backend_Hyd_immedi.docx';

async function main() {
  if (!fs.existsSync(filePath)) {
    console.error('File not found!');
    return;
  }
  try {
    const zip = new admZip(filePath);
    const zipEntries = zip.getEntries();
    
    console.log('=== XML FILES IN DOCX ===');
    for (const entry of zipEntries) {
      if (entry.entryName.endsWith('.xml')) {
        console.log(entry.entryName);
      }
    }
    
    // Let's search inside word/document.xml
    const documentXml = zip.readAsText('word/document.xml');
    
    // Simple regex to extract text between <w:t> tags
    const textMatches = documentXml.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
    const extractedText = textMatches.map(m => m.replace(/<[^>]+>/g, '')).join(' ');
    
    console.log('\n=== TEXT FROM word/document.xml ===');
    console.log(extractedText.substring(0, 1000));
    
    // Check if there are header/footer XML files and dump their text
    for (const entry of zipEntries) {
      if (entry.entryName.startsWith('word/header') || entry.entryName.startsWith('word/footer')) {
        console.log(`\n=== TEXT FROM ${entry.entryName} ===`);
        const xmlContent = zip.readAsText(entry.entryName);
        const headerMatches = xmlContent.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
        console.log(headerMatches.map(m => m.replace(/<[^>]+>/g, '')).join(' '));
      }
    }
    
  } catch (err: any) {
    console.error('Error parsing docx XML:', err.message);
  }
}

main();
