/** A canonical resource may cover an endpoint subtree, but never another origin or query. */
export function mcpResourceMatchesEndpoint(resource:string,endpoint:string) {
  try { const r=new URL(resource), e=new URL(endpoint);
    return !r.hash && !e.hash && r.origin===e.origin && r.search===e.search &&
      (e.pathname===r.pathname || e.pathname.startsWith(r.pathname.endsWith('/') ? r.pathname : r.pathname+'/'));
  } catch { return false; }
}
