/** Materialize the adapter's lightweight request before native middleware copies it. */
export function materializeNodeRequest(request: Request): Request {
  const init: RequestInit & { duplex: 'half' } = {
    method: request.method,
    headers: request.headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    signal: request.signal,
    duplex: 'half',
  };
  return new Request(request.url, init);
}
