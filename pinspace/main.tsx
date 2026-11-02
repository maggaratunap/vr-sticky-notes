import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Lobby from './app/lobby';
import Workspace from './app/workspace';
import './app/globals.css';
import './preview.css';
function App(){const [preview,setPreview]=useState(false);useEffect(()=>{fetch('/api/status').then(r=>r.json()).then(s=>setPreview(s.storage==='preview')).catch(()=>{});},[]);const p=new URLSearchParams(location.search);return <>{preview&&<div className="storage-preview" role="status">Temporary preview · Rooms, notes and uploads may reset when the server restarts. Keep a separate copy of important work.</div>}{p.has('room')||p.has('demo')||p.has('space')?<Workspace/>:<Lobby/>}</>;}
createRoot(document.getElementById('root')!).render(<App/>);
