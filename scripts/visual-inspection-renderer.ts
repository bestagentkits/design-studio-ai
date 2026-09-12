import type { DesignDocument } from '../src/shared/schema';
import { inspectionLayout, type InspectionRenderOptions } from '../src/shared/visual-inspection';
import { mountExportPage, rasterizeExportPage } from '../src/app/export-page';

export async function inspectVisual(doc: DesignDocument, options: InspectionRenderOptions) {
  const layout = inspectionLayout(doc, options);
  const canvas = document.createElement('canvas'); canvas.width = layout.width; canvas.height = layout.height;
  const context = canvas.getContext('2d')!;
  if (options.mode === 'overview') { context.fillStyle = '#eef0f4'; context.fillRect(0, 0, canvas.width, canvas.height); }
  document.body.style.cssText = 'margin:0;background:transparent';
  for (const [position, index] of options.pageIndices.entries()) {
    const mounted = await mountExportPage(doc, index, options.time);
    try {
      const bounds = layout.tiles[position];
      const image = await rasterizeExportPage(mounted.host, bounds.width, bounds.height);
      context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height);
      if (options.mode === 'overview') {
        const columns = Math.min(options.columns, options.pageIndices.length);
        const x = (position % columns) * options.tileSize + 8;
        const y = Math.floor(position / columns) * (options.tileSize + 40) + options.tileSize + 24;
        context.fillStyle = '#202634'; context.font = '14px Arial';
        // Canvas text never interprets project content as markup.
        context.fillText(`${index + 1}. ${doc.pages[index].name}`, x, y, options.tileSize - 16);
      }
    } finally { mounted.dispose(); }
  }
  return canvas.toDataURL('image/png').split(',')[1];
}
