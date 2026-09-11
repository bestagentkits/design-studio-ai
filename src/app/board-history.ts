function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(key => Object.hasOwn(b, key) && same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
/** JSON document gesture drafts stay separate from incoming projections until an atomic commit. */
export class BoardHistory<T> {
  private value: T;
  private remote: T;
  private revision: number;
  private gesture?: { base: T; draft: T };
  private past: { before: T; after: T }[] = [];
  private future: { before: T; after: T }[] = [];

  constructor(initial: T, revision: number, private reconcile: (base: T, local: T, remote: T) => T, private limit = 80) {
    if (!Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid history bounds');
    this.value = structuredClone(initial); this.remote = structuredClone(initial); this.revision = revision;
  }

  get document(): T { return structuredClone(this.gesture?.draft ?? this.value); }
  get committed(): T { return structuredClone(this.value); }
  get active(): boolean { return !!this.gesture; }
  get undoCount(): number { return this.past.length; }
  get remoteRevision(): number { return this.revision; }

  begin(): void {
    if (this.gesture) throw new Error('A gesture is already active');
    this.gesture = { base: structuredClone(this.value), draft: structuredClone(this.value) };
  }

  update(change: (draft: T) => T): void {
    if (!this.gesture) throw new Error('No active gesture');
    this.gesture.draft = structuredClone(change(structuredClone(this.gesture.draft)));
  }

  receive(document: T, revision: number): boolean {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid revision');
    if (revision <= this.revision) return false;
    // Reconciliation may throw. In that case retain both local work and its old base.
    const next = this.reconcile(structuredClone(this.remote), structuredClone(this.value), structuredClone(document));
    this.value = structuredClone(next); this.remote = structuredClone(document); this.revision = revision;
    return true;
  }

  finish(): T {
    if (!this.gesture) throw new Error('No active gesture');
    const next = this.reconcile(structuredClone(this.gesture.base), structuredClone(this.gesture.draft), structuredClone(this.value));
    if (!same(next, this.value)) {
      this.past.push({ before: structuredClone(this.value), after: structuredClone(next) });
      if (this.past.length > this.limit) this.past.shift();
      this.future = [];
    }
    this.value = structuredClone(next); this.gesture = undefined;
    return this.committed;
  }

  cancel(): T { this.gesture = undefined; return this.committed; }

  undo(): T {
    if (this.gesture) throw new Error('Finish or cancel the gesture first');
    const entry = this.past.at(-1); if (!entry) return this.committed;
    const next = this.reconcile(structuredClone(entry.after), structuredClone(entry.before), structuredClone(this.value));
    this.past.pop(); this.future.push(entry); this.value = structuredClone(next);
    return this.committed;
  }

  redo(): T {
    if (this.gesture) throw new Error('Finish or cancel the gesture first');
    const entry = this.future.at(-1); if (!entry) return this.committed;
    const next = this.reconcile(structuredClone(entry.before), structuredClone(entry.after), structuredClone(this.value));
    this.future.pop(); this.past.push(entry); this.value = structuredClone(next);
    return this.committed;
  }
}
