import { cp, rm } from 'node:fs/promises';

const SOURCE = 'site';
const DIST = 'dist';

await rm(DIST, { recursive: true, force: true });
await cp(SOURCE, DIST, { recursive: true });

console.log('Build AMURA AR MediaPipe V11.2: site/ copiado exactamente a dist/');
