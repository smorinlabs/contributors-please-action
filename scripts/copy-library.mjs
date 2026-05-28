import { copyFileSync } from 'node:fs';

copyFileSync('../contributors-please/dist/lib.js', 'dist/contributors-please-lib.js');
