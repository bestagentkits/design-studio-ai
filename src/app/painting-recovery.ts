import type { DesignDocument } from '../shared/schema';
import type { Painting } from '../shared/painting-schema';
import { PaintingTileDraft, type PaintingDraft } from '../shared/painting-fill';
import { writePaintingDraft, deletePaintingDraft, paintingDraftKey, type StoredPaintingDraft } from './painting-draft-store';
import { mutateDocument } from '../shared/operations';
import { PaintingSession } from './painting-session';

/** One bounded local transaction survives transport failures and rejected merges. */
export class PaintingRecovery {
  private prepared?: DesignDocument;
  constructor(readonly session: PaintingSession, readonly stroke?: PaintingDraft, readonly settings?: Painting, readonly accountId?: string) {}
  static async restore(stored: StoredPaintingDraft) {
    const session = new PaintingSession(stored.base, stored.painting, stored.layerId, stored.editMask); await session.initialize();
    const recovery = new PaintingRecovery(session, stored.tiles ? new PaintingTileDraft(new Map(stored.tiles)) : undefined, stored.settings, stored.accountId);
    recovery.prepared = stored.prepared; return recovery;
  }
  async persist() {
    if (!this.accountId) return;
    await writePaintingDraft({ key: paintingDraftKey(this.accountId, this.base.id, this.session.painting.id), accountId: this.accountId, projectId: this.base.id, paintingId: this.session.painting.id, base: this.base, painting: this.session.painting, layerId: this.session.layerId, editMask: this.session.editMask, settings: this.settings, prepared: this.prepared, tiles: this.stroke?.dirtyKeys.map(key => { const [x, y] = key.split(',').map(Number); return [key, this.stroke!.copyTile(x, y)!]; }) });
  }
  get base() { return this.session.document; }
  async prepare() {
    if (this.prepared) return this.prepared;
    const draft = structuredClone(this.base);
    const result = this.stroke ? await this.session.finish(this.stroke) : {
      painting: structuredClone(this.settings!), assets: [] as DesignDocument['assets'],
    };
    if (!this.stroke) result.assets.push(...await this.session.finishSettings(result.painting));
    draft.assets.push(...result.assets);
    this.prepared = mutateDocument(draft, [{ op: 'replace-painting', expectedGeneration: this.session.painting.generation, painting: result.painting }]);
    await this.persist();
    return this.prepared;
  }
  async preview(canvas: HTMLCanvasElement) { await this.session.preview(canvas, this.stroke, this.settings ?? this.session.painting); }
  release() { this.stroke?.cancel(); }
  discard() { if (this.accountId) void deletePaintingDraft(paintingDraftKey(this.accountId, this.base.id, this.session.painting.id)).catch(() => {}); this.stroke?.cancel(); this.prepared = undefined; }
}
