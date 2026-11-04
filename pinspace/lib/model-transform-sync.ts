import { normalizeModelTransform, type ModelTransform } from './model-transform.ts';
export type TransformRecord = { asset: string | null; transform: ModelTransform; revision: number };
type Pending = { room: string; asset: string | null; transform: ModelTransform };
const key = (room: string, asset: string | null) => room + ':' + (asset || 'sample');

/** Collapse animation frames into ordered writes, with revision checks on the server. */
export class ModelTransformSync {
    records = new Map<string, TransformRecord>();
    pending = new Map<string, Pending>();
    writing: string | null = null;
    timer: ReturnType<typeof setTimeout> | null = null;
    generation = 0;
    closed = false;
    save: (room: string, body: { asset: string | null; transform: ModelTransform; revision: number }) => Promise<{ record: TransformRecord }>;
    onConflict: ((room: string, record: TransformRecord, message: string) => void) | null = null;
    onError: ((message: string) => void) | null = null;
    constructor(save: ModelTransformSync['save']) { this.save = save; }
    get(room: string, asset: string | null): TransformRecord { return this.records.get(key(room, asset)) || { asset, transform: normalizeModelTransform(null), revision: 0 }; }
    busy(room: string, asset: string | null) { const id = key(room, asset); return this.writing === id || this.pending.has(id); }
    receive(room: string, values: TransformRecord[], activeAsset?: string | null) {
        for (const record of values) {
            if (record.asset === activeAsset || this.busy(room, record.asset)) continue;
            const id = key(room, record.asset), old = this.records.get(id);
            if (Number.isSafeInteger(record.revision) && record.revision >= (old?.revision || 0)) this.records.set(id, { ...record, transform: normalizeModelTransform(record.transform) });
        }
        if (this.pending.size && !this.timer && !this.writing) this.schedule(200);
    }
    queue(room: string, asset: string | null, transform: ModelTransform, final = false) {
        if (this.closed || !room) return;
        this.pending.set(key(room, asset), { room, asset, transform: normalizeModelTransform(transform) });
        this.schedule(final ? 0 : 200);
    }
    schedule(delay: number) {
        if (this.closed || this.writing || (this.timer && delay !== 0)) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, delay);
    }
    async flush() {
        if (this.closed || this.writing || !this.pending.size) return;
        if (this.timer) clearTimeout(this.timer); this.timer = null;
        const [id, operation] = this.pending.entries().next().value!;
        const generation = this.generation;
        this.pending.delete(id); this.writing = id;
        let retry = false;
        try {
            const response = await this.save(operation.room, { asset: operation.asset, transform: operation.transform, revision: this.get(operation.room, operation.asset).revision });
            if (generation === this.generation && !this.closed) this.records.set(id, { ...response.record, transform: normalizeModelTransform(response.record.transform) });
        } catch (error) {
            if (generation !== this.generation || this.closed) return;
            const e = error as { status?: number; data?: { record?: TransformRecord }; message?: string };
            if (e.status === 409 && e.data?.record) {
                const record = { ...e.data.record, transform: normalizeModelTransform(e.data.record.transform) };
                this.records.set(id, record); this.pending.delete(id); this.onConflict?.(operation.room, record, e.message || 'The model changed in another browser.');
            } else if (e.status && e.status < 500) {
                this.pending.delete(id); this.onError?.(e.message || 'Unable to save the model placement.');
            } else {
                if (!this.pending.has(id)) this.pending.set(id, operation);
                retry = true; this.onError?.('Model placement is waiting to save. Reconnecting…');
            }
        } finally {
            this.writing = null;
            if (this.pending.size && !this.closed) this.schedule(retry ? 1500 : 200);
        }
    }
    clear() { this.generation++; this.records.clear(); this.pending.clear(); if (this.timer) clearTimeout(this.timer); this.timer = null; }
    close() { this.clear(); this.closed = true; }
}
