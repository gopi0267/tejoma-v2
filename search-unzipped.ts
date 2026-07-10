import fs from 'fs';
import path from 'path';

const baseDir = 'c:/Users/gopiy/Downloads/tejoma-rec/temp_dodle_unzipped';

function walk(dir: string, callback: (filePath: string) => void) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, callback);
    } else {
      callback(fullPath);
    }
  }
}

function main() {
  if (!fs.existsSync(baseDir)) {
    console.error('Directory not found!');
    return;
  }
  console.log('--- Scanning unzipped docx XMLs ---');
  walk(baseDir, (filePath) => {
    if (filePath.endsWith('.xml')) {
      const content = fs.readFileSync(filePath, 'utf8');
      const matches = content.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
      if (matches.length > 0) {
        const text = matches.map(m => m.replace(/<[^>]+>/g, '')).join(' ');
        if (text.trim()) {
          console.log(`\nFile: ${path.relative(baseDir, filePath)}`);
          console.log(text.substring(0, 1000));
        }
      }
    }
  });
}

main();
