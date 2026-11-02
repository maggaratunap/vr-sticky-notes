import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
const project=join(dirname(fileURLToPath(import.meta.url)),'..');
test('portable server preserves presentation, uploads, notes, voice and shortcuts through restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pinspace-test-'));
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const origin='http://127.0.0.1:'+port;let server,logs='';
 async function start(){server=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server.mjs'],{cwd:project,env:{...process.env,PORT:String(port),DATA_DIR:dir,STORAGE_MODE:'persistent',PUBLIC_ORIGIN:origin},stdio:['ignore','pipe','pipe']});server.stdout.on('data',v=>logs+=v);server.stderr.on('data',v=>logs+=v);for(let i=0;i<60;i++){if(server.exitCode!==null)throw Error(logs);try{if((await fetch(origin+'/healthz')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Server failed to become ready: '+logs);}
 async function stop(){if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}}
 async function req(token,path,method='GET',body){const r=await fetch(origin+'/api/'+path,{method,headers:{Origin:origin,...(token?{'X-Pinspace-Session':token}:{}),...(body instanceof FormData?{}:body?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 try{
 await start();assert.equal((await req(null,'status')).data.storage,'persistent');
 const host=(await req(null,'guest','POST')).data.token,guest=(await req(null,'guest','POST')).data.token;
 const a=(await req(host,'rooms','POST',{title:'Presentation test'})).data.id,b=(await req(host,'rooms','POST',{title:'Linked room'})).data.id,path='rooms/'+a;
 assert.equal((await req(host,path)).data.room.canManage,true);
 const link=await req(host,path+'/shortcuts','POST',{target:b,position:[0,1.5,4]});assert.equal(link.status,200);assert.equal((await req(guest,path+'/shortcuts','POST',{target:b,position:[0,1.5,4]})).status,403);assert.equal((await req(guest,path)).data.shortcuts[0].target,b);
 const upload=new FormData();upload.set('file',new File(['%PDF-1.7\nfixture'],'test.pdf',{type:'application/pdf'}));const file=await req(host,path+'/assets','POST',upload);assert.equal(file.status,200);assert.equal((await fetch(origin+'/api/asset/'+file.data.id)).headers.get('Content-Type'),'application/pdf');
 const deck=[{id:'view',title:'Opening view',kind:'model',asset:null,page:1,camera:{position:[22,15,25],target:[0,3,0]},notes:'PRIVATE_CUE'},{id:'pdf',title:'Drawing page 2',kind:'pdf',asset:file.data.id,page:2,camera:null,notes:''}];
 assert.equal((await req(host,path+'/presentation','POST',{action:'save',revision:0,deck})).status,200);assert.equal((await req(host,path+'/presentation','POST',{action:'save',revision:0,deck})).status,409);assert.equal((await req(guest,path+'/presentation','POST',{action:'start'})).status,403);assert.equal(JSON.stringify((await req(guest,path)).data).includes('PRIVATE_CUE'),false);
 assert.equal((await req(host,path+'/presence','POST',{id:'host',name:'Presenter',pose:[0,1.6,8],mic:1})).status,200);await req(guest,path+'/presence','POST',{id:'audience',name:'Audience',pose:[0,1.6,8],mic:1});
 assert.equal((await req(host,path+'/presentation','POST',{action:'start',peer:'host',name:'Presenter'})).status,200);assert.equal((await req(guest,path)).data.presentation.state.live,true);await req(host,path+'/presentation','POST',{action:'go',slideId:'pdf'});assert.equal((await req(guest,path)).data.presentation.state.slideId,'pdf');
 const voice=Buffer.alloc(8000,1).toString('base64');assert.equal((await req(host,path+'/audio','POST',{from:'host',seq:0,data:voice})).status,200);const audio=await req(guest,path+'/audio?peer=audience&after=0');assert.equal(audio.data.packets[0].data,voice);assert.equal((await req(guest,path+'/audio','POST',{from:'host',seq:1,data:voice})).status,403);await req(host,path+'/audio','DELETE',{from:'host'});assert.equal((await req(guest,path+'/audio?peer=audience')).data.packets.length,0);
 assert.equal((await req(host,path+'/notes','POST',{body:'Review this detail',author:'Presenter',color:'yellow',position:[0,1,0],asset:null})).status,200);
 await stop();await start();const restored=(await req(host,path)).data;assert.equal(restored.presentation.deck.length,2);assert.equal(restored.shortcuts.length,1);assert.equal(restored.notes[0].body,'Review this detail');assert.equal(restored.assets[0].id,file.data.id);assert.equal((await fetch(origin+'/api/asset/'+file.data.id)).status,200);
 await req(host,path+'/shortcuts/'+link.data.id,'DELETE');assert.equal((await req(guest,path)).data.shortcuts.length,0);assert.equal((await req(guest,'rooms/'+b)).status,200);await req(host,path+'/shortcuts/'+link.data.id+'/restore','POST',{});assert.equal((await req(guest,path)).data.shortcuts.length,1);
 const denied=await fetch(origin+'/api/rooms',{method:'POST',headers:{Origin:'https://other.invalid','X-Pinspace-Session':host,'Content-Type':'application/json'},body:JSON.stringify({title:'Forged'})});assert.equal(denied.status,403);
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
