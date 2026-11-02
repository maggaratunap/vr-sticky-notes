import {DatabaseSync} from 'node:sqlite';
import {createReadStream,createWriteStream,mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {stat,rename,rm,mkdtemp} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash,randomUUID} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url));
export const dataDirectory=resolve(process.env.DATA_DIR||join(here,'../data'));
export const storageMode=process.env.STORAGE_MODE==='persistent'?'persistent':'preview';
let database;
export function sqlite(){
 if(database)return database;
 mkdirSync(dataDirectory,{recursive:true,mode:0o700});
 const db=new DatabaseSync(join(dataDirectory,'pinspace.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 db.exec('CREATE TABLE IF NOT EXISTS pinspace_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL)');
 const dir=join(here,'../migrations');
 try{for(const name of readdirSync(dir).filter(n=>/^\d{4}_.*\.sql$/.test(n)).sort()){
  const sql=readFileSync(join(dir,name),'utf8'),hash=createHash('sha256').update(sql).digest('hex');
  const applied=db.prepare('SELECT hash FROM pinspace_migrations WHERE name=?').get(name);
  if(applied){if(applied.hash!==hash)throw Error('Applied migration changed: '+name);continue;}
  db.exec('BEGIN IMMEDIATE');try{db.exec(sql);db.prepare('INSERT INTO pinspace_migrations(name,hash) VALUES(?,?)').run(name,hash);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 }database=db;return db;}catch(e){db.close();throw e;}
}
export function closeStorage(){if(database){database.close();database=undefined;}}
function filePath(id){if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('Invalid file identifier');return join(dataDirectory,'uploads',id);}
export const bucket={
 async get(id){const file=filePath(id);let s;try{s=await stat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}return {size:s.size,body:Readable.toWeb(createReadStream(file))};},
 async put(id,stream){const file=filePath(id);mkdirSync(dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.part';let size=0;const guard=new Transform({transform(chunk,encoding,done){size+=chunk.length;done(size>40*1024*1024?Error('File limit is 40 MB.'):null,chunk);}});try{await pipeline(Readable.fromWeb(stream),guard,createWriteStream(tmp,{flags:'wx',mode:0o600}));await rename(tmp,file);}catch(e){await rm(tmp,{force:true});throw e;}}
};
