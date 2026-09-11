/** URL queries may select a tenant or resource, but must never carry credentials. */
export function hasConnectorQueryCredentials(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/(?:token|secret|password|passwd|credential|authorization|signature|apikey|accesskey|cookie)/.test(normalized)
      || /^(?:key|sig|auth|code|codeverifier|jwt|sessionid|sessionkey|se|sp|sv|sr|srt|ss|skoid|sktid|skt|ske|sks|skv)$/.test(normalized)) return true;
  }
  return false;
}
