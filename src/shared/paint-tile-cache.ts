import { PAINT_TILE_SIZE } from './paint-pixels';

export const PAINT_TILE_BYTES = PAINT_TILE_SIZE * PAINT_TILE_SIZE * 4;
export interface PaintTileStore {
  read(key: string): Promise<Uint8Array | undefined>;
  write(key: string, bytes: Uint8Array): Promise<void>;
}
type Entry = { bytes: Uint8Array; dirty: boolean; used: number; creating: boolean };
/** Serialized tile access bounds working memory; persistent bytes outlive LRU eviction. */
export class PaintTileCache {
  private entries = new Map<string, Entry>();
  private clock = 0;
  private pending = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private store: PaintTileStore, readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 256) throw new Error('Invalid tile cache capacity');
  }
  get residentBytes() { return this.entries.size * PAINT_TILE_BYTES; }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    if (this.pending >= 256) return Promise.reject(new Error('Tile cache queue is full'));
    this.pending++;
    const result = this.queue.then(action).finally(() => { this.pending--; });
    this.queue = result.catch(() => undefined);
    return result;
  }
  private key(key: string) {
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(key)) throw new Error('Invalid tile key');
  }
  private async get(key: string, create = false): Promise<Entry> {
    this.key(key);
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.capacity) {
        const [oldKey, old] = [...this.entries].reduce((a, b) => a[1].used < b[1].used ? a : b);
        if (old.dirty) await this.store.write(oldKey, old.bytes.slice());
        this.entries.delete(oldKey);
      }
      const stored = await this.store.read(key);
      if (!stored && !create) throw new Error('Paint tile is missing');
      if (stored && stored.byteLength !== PAINT_TILE_BYTES) throw new Error('Invalid stored tile size');
      // Node Buffers implement slice as a view; normalize before using copy-on-write.
      entry = { bytes: stored ? new Uint8Array(stored) : new Uint8Array(PAINT_TILE_BYTES), dirty: false, used: 0, creating: !stored };
      this.entries.set(key, entry);
    }
    entry.used = ++this.clock;
    return entry;
  }
  read(key: string): Promise<Uint8Array> {
    return this.serial(async () => (await this.get(key)).bytes.slice());
  }
  edit(key: string, apply: (bytes: Uint8Array) => void, create = false): Promise<void> {
    return this.serial(async () => {
      const entry = await this.get(key, create), draft = entry.bytes.slice();
      try {
        const result: unknown = apply(draft);
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(result).catch(() => undefined);
          throw new Error('Tile edits must be synchronous');
        }
        if (draft.byteLength !== PAINT_TILE_BYTES) throw new Error('Invalid edited tile size');
        // Callbacks and callers cannot retain aliases to cache-owned data.
        entry.bytes = draft.slice(); entry.dirty = true; entry.creating = false;
      } catch (error) {
        if (entry.creating) this.entries.delete(key);
        throw error;
      }
    });
  }
  flush(): Promise<void> {
    return this.serial(async () => {
      for (const [key, entry] of this.entries) {
        if (!entry.dirty) continue;
        await this.store.write(key, entry.bytes.slice()); entry.dirty = false;
      }
    });
  }
}
