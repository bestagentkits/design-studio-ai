/** WebMCP accepts base64 bytes; the existing asset endpoint receives multipart. */
export function assetUploadBody(body: Record<string, unknown>): FormData {
  if (typeof body.name !== 'string' || typeof body.mimeType !== 'string' || typeof body.base64 !== 'string') throw new Error('Asset upload needs name, mimeType and base64.');
  if (body.base64.length > 28_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)) throw new Error('Invalid or oversized asset bytes.');
  const bytes = Uint8Array.from(atob(body.base64), char => char.charCodeAt(0));
  const form = new FormData(); form.append('file', new Blob([bytes], { type: body.mimeType }), body.name); return form;
}
