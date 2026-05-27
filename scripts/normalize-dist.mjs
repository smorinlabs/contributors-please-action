import { readFileSync, writeFileSync } from 'node:fs';

const file = 'dist/index.js';
const pattern = /^;\/\/ CONCATENATED MODULE: .*contributors-please\/dist\/lib\.js$/gm;
const canonical = ';// CONCATENATED MODULE: contributors-please/dist/lib.js';

const src = readFileSync(file, 'utf8');
const out = src.replace(pattern, canonical);

if (out === src) {
  console.error('normalize-dist: expected contributors-please/dist/lib.js stamp not found');
  process.exit(1);
}

writeFileSync(file, out);
