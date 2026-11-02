import {drizzle} from 'drizzle-orm/sqlite-proxy';
import {sqlite} from './storage.mjs';
import * as schema from './schema.ts';
let database:ReturnType<typeof createDatabase>|undefined;
function createDatabase(){return drizzle(async(query,params,method)=>{const statement=sqlite().prepare(query);const values=params.map(v=>v===undefined?null:v);if(method==='run'){statement.run(...values);return {rows:[]};}statement.setReturnArrays(true);return {rows:method==='get'?statement.get(...values) as any:statement.all(...values) as any};},{schema});}
export function getDb(){return database||=(createDatabase());}
