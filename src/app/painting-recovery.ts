import type { DesignDocument } from '../shared/schema';
import type { Painting } from '../shared/painting-schema';
import type { PaintStroke } from '../shared/paint-stroke';
import { mutateDocument } from '../shared/operations';
import { PaintingSession } from './painting-session';

/** One bounded local transaction survives transport failures and rejected merges. */
export class PaintingRecovery {
  private prepared?: DesignDocument;
  constructor(readonly session: PaintingSession, readonly stroke?: PaintStroke, readonly settings?: Painting) {}
  get base() { return this.session.document; }
  async prepare() {
    if (this.prepared) return this.prepared;
    const draft = structuredClone(this.base);
    const result = this.stroke ? await this.session.finish(this.stroke) : {
      painting: structuredClone(this.settings!), assets: [] as DesignDocument['assets'],
    };
    if (!this.stroke) result.assets.push(await this.session.finishSettings(result.painting));
    draft.assets.push(...result.assets);
    this.prepared = mutateDocument(draft, [{ op: 'replace-painting', expectedGeneration: this.session.painting.generation, painting: result.painting }]);
    return this.prepared;
  }
  async preview(canvas: HTMLCanvasElement) { await this.session.preview(canvas, this.stroke, this.settings ?? this.session.painting); }
  discard() { this.stroke?.cancel(); this.prepared = undefined; }
}
