const KEY = 'pinspace-guest-token';
let pending: Promise<string> | null = null;
async function guest() {
    const stored = localStorage.getItem(KEY);
    if (stored)
        return stored;
    if (!pending)
        pending = fetch('/api/guest', { method: 'POST' }).then(async (r) => {
            const v: any = await r.json();
            if (!r.ok)
                throw Error(v.error || 'Unable to start guest session');
            localStorage.setItem(KEY, v.token);
            return v.token as string;
        }).finally(() => pending = null);
    return pending;
}
export async function api(path: string, method = 'GET', data?: any, retry = true): Promise<any> {
    const token = await guest();
    const r = await fetch('/api/' + path, { method, headers: { 'X-Pinspace-Session': token, ...(data instanceof FormData ? {} : data ? { 'Content-Type': 'application/json' } : {}) }, body: data instanceof FormData ? data : data ? JSON.stringify(data) : undefined });
    const value: any = await r.json();
    if (r.status === 401 && retry) {
        localStorage.removeItem(KEY);
        return api(path, method, data, false);
    }
    if (!r.ok)
        throw Error(value.error || 'Request failed');
    return value;
}
export function leaveRoom(room: string, id: string) {
    const token = localStorage.getItem(KEY);
    if (token)
        fetch('/api/rooms/' + room + '/leave', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pinspace-Session': token }, body: JSON.stringify({ id }), keepalive: true }).catch(() => { });
}
export function rememberRoom(id: string) {
    try {
        const recent: string[] = JSON.parse(localStorage.getItem('pinspace-recent-rooms') || '[]');
        localStorage.setItem('pinspace-recent-rooms', JSON.stringify([id, ...recent.filter(x => x !== id)].slice(0, 30)));
    }
    catch { }
}
