import { useEffect, useRef } from 'react';

export default function FlightControls({ onLift, onStep }: { onLift: (direction: number) => void; onStep: (direction: number) => void }) {
    const pointer = useRef<number | null>(null), lift = useRef(onLift);
    lift.current = onLift;
    const stop = () => { pointer.current = null; lift.current(0); };
    useEffect(() => {
        const hidden = () => { if (document.hidden) stop(); };
        window.addEventListener('blur', stop);
        document.addEventListener('visibilitychange', hidden);
        return () => {
            window.removeEventListener('blur', stop);
            document.removeEventListener('visibilitychange', hidden);
            lift.current(0);
        };
    }, []);
    return <div className="flight-controls" role="group" aria-label="Flight altitude">
        <span>ALTITUDE</span>
        {[1, -1].map(direction => <button key={direction} type="button" aria-label={direction > 0 ? 'Fly up' : 'Fly down'} title="Hold to move, or activate with keyboard for one step"
            onPointerDown={e => {
                if (pointer.current !== null) return;
                e.preventDefault();
                pointer.current = e.pointerId;
                e.currentTarget.setPointerCapture(e.pointerId);
                lift.current(direction);
            }}
            onPointerUp={e => { if (e.pointerId === pointer.current) stop(); }}
            onPointerCancel={stop} onLostPointerCapture={stop} onBlur={stop}
            onClick={e => { if (e.detail === 0) onStep(direction); }}>
            <b aria-hidden="true">{direction > 0 ? '↑' : '↓'}</b>{direction > 0 ? 'Up' : 'Down'}
        </button>)}
    </div>;
}
