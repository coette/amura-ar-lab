import { rm, mkdir, copyFile, cp, writeFile } from 'node:fs/promises';

const DIST='dist';
await rm(DIST,{recursive:true,force:true});
await mkdir(DIST,{recursive:true});
await copyFile('index.html',`${DIST}/index.html`);
await cp('vendor_v272',`${DIST}/vendor_v272`,{recursive:true});
await cp('models_v272',`${DIST}/models_v272`,{recursive:true});
await writeFile(`${DIST}/_headers`,`/*\n  Cache-Control: no-store, no-cache, must-revalidate\n\n/*.wasm\n  Content-Type: application/wasm\n  Cache-Control: public, max-age=31536000, immutable\n\n/*.glb\n  Cache-Control: public, max-age=31536000, immutable\n`);
await writeFile(`${DIST}/BUILD.txt`,`AMURA AR V2.9 PHYSICAL ANCHOR DIAGNOSTIC TOP3\nassets=repository-v272\ntime=${new Date().toISOString()}\n`);
console.log('Build consolidado: index.html + assets V272 versionados en el repo');
