// Per-target SSRF guard for outbound provider fetches. Complements the operator
// origin allowlist in provider-connections: even an allowlisted origin must not resolve
// to (or literally be) a loopback, private, link-local, CGNAT or reserved address.
// Pure predicates — no Hono/database imports — so the rules stay unit-testable.

function parseIPv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function isPrivateIPv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8, 10.0.0.0/8, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24, TEST-NET-1
  if (a === 198 && b >= 18 && b <= 19) return true; // benchmark 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast and reserved 224.0.0.0/4, 240.0.0.0/4
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === '::' || lower === '::1') return true; // unspecified, loopback
  if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link-local
  const mapped = /^::ffff:(.+)$/.exec(lower);
  if (mapped) { const ipv4 = parseIPv4(mapped[1]); if (ipv4) return isPrivateIPv4(ipv4); }
  return false;
}

export function isBlockedHostname(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, '').toLowerCase().trim();
  if (!value) return true;
  if (value.includes(':')) return isPrivateIPv6(value);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) { const ipv4 = parseIPv4(value); if (ipv4) return isPrivateIPv4(ipv4); }
  if (value === 'localhost' || value.endsWith('.localhost')) return true;
  if (/\.(local|internal)$/.test(value)) return true;
  return false;
}
