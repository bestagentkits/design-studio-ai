import type { DesignDocument } from './schema';
import { resolveColor, wrappedLines } from './render';

export interface DesignIssue {
  code: string;
  severity: 'warning' | 'info';
  pageId?: string;
  nodeId?: string;
  message: string;
  suggestion: string;
}
function luminance(hex: string): number | null {
  if (/^#[0-9a-f]{3}$/i.test(hex)) hex = '#' + [...hex.slice(1)].map(c => c + c).join('');
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

/** Deterministic preflight findings are actionable hints, not an aesthetic score. */
export function inspectDesign(document: DesignDocument) {
  const issues: DesignIssue[] = [];
  let warnings = 0, information = 0;
  const add = (issue: DesignIssue) => {
    if (issue.severity === 'warning') warnings++; else information++;
    if (issues.length < 200) issues.push(issue);
  };
  for (const page of document.pages) {
    const byId = new Map(page.nodes.map(node => [node.id, node]));
    if (!page.nodes.some(node => node.visible !== false)) add({code:'empty-page', severity:'warning', pageId:page.id, message:'This page has no visible content.', suggestion:'Add content or remove the unused page before sharing.'});
    for (const node of page.nodes) {
      if (node.visible === false) continue;
      const finding = (code: string, message: string, suggestion: string, severity: DesignIssue['severity'] = 'warning') => add({code, severity, pageId:page.id, nodeId:node.id, message, suggestion});
      if (node.width === 0 || node.height === 0) finding('zero-size', 'This layer has no visible area.', 'Set a positive width and height, or hide the layer.');
      if (node.x < 0 || node.y < 0 || node.x + node.width > page.width || node.y + node.height > page.height)
        finding('outside-page', 'Part of this layer lies outside the page bounds.', 'Check whether the crop is intentional; otherwise move or resize the layer.');
      if (['image', 'audio', 'video'].includes(node.type) && !node.src)
        finding('missing-media', 'This media layer has no source.', 'Upload an asset and assign its URL before export.');
      if (node.src?.startsWith('https:')) finding('remote-media', 'This layer depends on a remote URL; cloud binary export requires an imported asset.', 'Import the media into this project and use its owned asset URL.');
      if (node.type === 'chart' && (!Array.isArray(node.data?.values) || !node.data.values.length))
        finding('empty-chart', 'This chart has no data values.', 'Provide chart data and labels.');
      if (node.type !== 'text') continue;
      if (!node.text?.trim()) { finding('empty-text', 'This text layer is empty.', 'Add final copy or remove the unused layer.'); continue; }
      const size = typeof node.style?.fontSize === 'number' ? Math.min(1000, Math.max(1, node.style.fontSize)) : 24;
      const leading = typeof node.style?.lineHeight === 'number' ? Math.min(4, Math.max(.5, node.style.lineHeight)) : 1.2;
      const lines = wrappedLines(node.text, node.width, size);
      if (size + (lines.length - 1) * size * leading > node.height + 1)
        finding('text-overflow', 'Rendered text is likely to extend below its layer bounds.', 'Increase height/width, shorten the copy, or adjust font size and line height.');
      if (size < 12) finding('small-text', `Text is ${size}px at the native page size.`, 'Check readability at the intended viewing size.', 'info');
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      const background = parent && ['frame','shape'].includes(parent.type) ? parent.style?.fill ?? '$surface' : page.background;
      const foregroundL = luminance(resolveColor(node.style?.fill ?? '$text', document.theme));
      const backgroundL = luminance(resolveColor(background, document.theme));
      if (foregroundL === null || backgroundL === null || node.opacity !== undefined && node.opacity < 1) continue;
      const ratio = (Math.max(foregroundL, backgroundL) + .05) / (Math.min(foregroundL, backgroundL) + .05);
      const large = size >= 24 || size >= 18.67 && Number(node.style?.fontWeight ?? 400) >= 700;
      if (ratio < (large ? 3 : 4.5)) finding('text-contrast', `Estimated text contrast is ${ratio.toFixed(2)}:1 against its declared background.`, 'Check the actual composite preview; adjust text or background color if needed.');
    }
    if (page.nodes.length > 500) add({code:'dense-page',severity:'info',pageId:page.id,message:`This page contains ${page.nodes.length} layers.`,suggestion:'Check interaction speed on a phone and remove unnecessary layers.'});
  }
  if (document.timeline && document.timeline.duration > 60) add({code:'export-duration',severity:'warning',message:'The timeline exceeds the 60-second cloud video export limit.',suggestion:'Split the work into shorter scenes for cloud video export.'});
  return {issues, counts:{warnings, information, total:warnings+information}, truncated:warnings+information>issues.length, limitations:['Checks describe document geometry before animation; motion extremes and rotated bounds need visual inspection.', 'Contrast estimates use opaque hex colors and the immediate declared background; overlapping layers and media are not composited.', 'Text fitting follows the renderer wrapping estimate; font-specific metrics and visual quality still require preview.']};
}
