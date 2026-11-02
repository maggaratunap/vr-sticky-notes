import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {resolve,extname,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {GET as handle} from './app/api/route.ts';
import {sqlite,storageMode,closeStorage} from './db/storage.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
 try{
  const origin=process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL||'http://'+req.headers.host;
  const url=new URL(req.url,origin);
  if(url.pathname==='/healthz'){sqlite().prepare('SELECT 1').get();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true}));return;}
  if(url.pathname==='/api/status'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({storage:storageMode}));return;}
  if(url.pathname.startsWith('/api/')){
   let body;if(req.method!=='GET'&&req.method!=='HEAD'){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>42*1024*1024){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Request exceeds the file size limit.'}));return;}chunks.push(chunk);}body=Buffer.concat(chunks);}
   const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
   const response=await handle(new Request(url,{method:req.method,headers,body}));res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)await pipeline(Readable.fromWeb(response.body),res);else res.end();return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  let path;try{path=decodeURIComponent(url.pathname);}catch{res.writeHead(400);res.end();return;}
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  let info;try{info=await stat(file);}catch{res.writeHead(404);res.end('Not found');return;}
  if(!info.isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':url.pathname.startsWith('/assets/')?'public,max-age=31536000,immutable':'no-cache','X-Content-Type-Options':'nosniff'});
  if(req.method==='HEAD')res.end();else await pipeline(createReadStream(file),res);
 }catch(e){if(!res.headersSent){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Server error.'}));}else res.destroy();console.error('Request failed:',e.message);}
});
sqlite();server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Pinspace listening on port '+(process.env.PORT||3000)+' ('+storageMode+' storage)'));
let shuttingDown=false;function stop(){if(shuttingDown)return;shuttingDown=true;server.close(()=>{closeStorage();process.exit(0);});setTimeout(()=>{server.closeAllConnections();closeStorage();process.exit(0);},10000).unref();}process.on('SIGTERM',stop);process.on('SIGINT',stop);
