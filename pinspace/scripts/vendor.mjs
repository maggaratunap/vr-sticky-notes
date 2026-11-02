import {mkdir,copyFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
const require=createRequire(import.meta.url),three=dirname(dirname(require.resolve('three'))),pdf=dirname(require.resolve('pdfjs-dist/package.json'));
await mkdir('public/draco',{recursive:true});
for(const file of ['draco_decoder.js','draco_decoder.wasm','draco_wasm_wrapper.js'])await copyFile(join(three,'examples/jsm/libs/draco',file),join('public/draco',file));
await copyFile(join(pdf,'build/pdf.worker.min.mjs'),'public/pdf.worker.min.mjs');
