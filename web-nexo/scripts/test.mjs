import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('..',import.meta.url));
const directory=resolve(root,'.test-build');
const files=['tests/backend.test.ts','tests/universe.test.ts','tests/chess.test.ts','tests/media.test.ts','tests/i18n.test.ts','tests/welcome.test.ts'];
if(dirname(directory)!==resolve(root))throw Error('Test output must stay in the project.');
await mkdir(directory,{recursive:true});
try {
  const compilation=spawnSync(process.execPath,[require.resolve('typescript/lib/tsc.js'),'--outDir',directory,'--module','commonjs','--moduleResolution','node','--target','ES2022','--esModuleInterop','--skipLibCheck','--resolveJsonModule','--allowJs',...files],{cwd:root,stdio:'inherit'});
  if(compilation.status!==0)process.exitCode=compilation.status??1;
  else {
    await writeFile(directory+'/package.json','{"type":"commonjs"}');
    const result=spawnSync(process.execPath,['--test',...files.map(file=>resolve(directory,file.replace(/\.ts$/,'.js')))],{cwd:root,stdio:'inherit'});
    process.exitCode=result.status ?? 1;
  }
} finally { await rm(directory,{recursive:true,force:true}); }
