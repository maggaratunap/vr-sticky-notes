import {spawn} from 'node:child_process';
const args=process.argv.slice(2),portIndex=args.indexOf('--port'),port=portIndex>=0?args[portIndex+1]:'5173';
const publicOrigin=process.env.PUBLIC_ORIGIN||(port==='4173'?'http://terminal.local:4173':'http://localhost:'+port);
const api=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3001',PUBLIC_ORIGIN:publicOrigin},stdio:'inherit'});
const web=spawn(process.execPath,['node_modules/vite/bin/vite.js',...process.argv.slice(2)],{stdio:'inherit'});
function close(){api.kill('SIGTERM');web.kill('SIGTERM');}process.on('SIGTERM',close);process.on('SIGINT',close);web.on('exit',code=>{api.kill('SIGTERM');process.exit(code||0);});
