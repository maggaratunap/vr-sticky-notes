'use client';
import {useRef,useState,useEffect} from 'react';
import {joystickVector} from '../lib/vr-controls';
export default function Joystick({onMove}:{onMove:(x:number,z:number)=>void}){
 const ref=useRef<HTMLDivElement>(null),pointer=useRef<number|null>(null);const [knob,setKnob]=useState({x:0,y:0});const moveRef=useRef(onMove);moveRef.current=onMove;
 const stop=()=>{pointer.current=null;setKnob({x:0,y:0});moveRef.current(0,0)};
 useEffect(()=>{window.addEventListener('blur',stop);const hidden=()=>{if(document.hidden)stop()};document.addEventListener('visibilitychange',hidden);return()=>{window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',hidden);moveRef.current(0,0)}},[]);
 function move(e:React.PointerEvent){if(pointer.current!==e.pointerId||!ref.current)return;const r=ref.current.getBoundingClientRect(),v=joystickVector(e.clientX-r.left-r.width/2,e.clientY-r.top-r.height/2,38);setKnob({x:v.x*38,y:v.z*38});moveRef.current(v.x,v.z);}
 return <div className="joystick-wrap"><div ref={ref} className="joystick" role="group" aria-label="Movement joystick" onPointerDown={e=>{if(pointer.current!==null)return;pointer.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);move(e)}} onPointerMove={move} onPointerUp={e=>{if(e.pointerId===pointer.current)stop()}} onPointerCancel={stop} onLostPointerCapture={stop}><span className="joystick-ring"/><span className="joystick-knob" style={{transform:`translate(${knob.x}px,${knob.y}px)`}}/></div><span>MOVE · DRAG TO LOOK</span></div>
}
