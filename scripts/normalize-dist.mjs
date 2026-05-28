import { readFileSync } from 'node:fs';

const src = readFileSync('dist/index.js', 'utf8');
const bundledLibraryMarkers = [
  'CONCATENATED MODULE: contributors-please/dist/lib.js',
  'CONCATENATED MODULE: contributors-please/src/lib.ts',
  'CONCATENATED MODULE: ../contributors-please/src/lib.ts',
];

for (const marker of bundledLibraryMarkers) {
  if (src.includes(marker)) {
    console.error(`normalize-dist: action bundle unexpectedly contains ${marker}`);
    process.exit(1);
  }
}
