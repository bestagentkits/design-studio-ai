import { hasConnectorQueryCredentials } from '../src/shared/connector-url-policy';
export class ConnectorTransportError extends Error {}

// Conservative public-unicast policy, based on the IANA special-purpose registries:
// https://www.iana.org/assignments/iana-ipv4-special-registry/
// https://www.iana.org/assignments/iana-ipv6-special-registry/
// Special-purpose globally reachable exceptions are intentionally not connector destinations.
const blockedV4 = [
  [0, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
  [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
  [0xc01fc400, 24], [0xc034c100, 24], [0xc0586300, 24], [0xc0a80000, 16],
  [0xc0af3000, 24], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24],
  [0xe0000000, 3],
] as const;

export function isPublicConnectorAddress(address: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) {
    const bytes = address.split('.');
    if (bytes.some(byte => !/^(0|[1-9]\d{0,2})$/.test(byte) || Number(byte) > 255)) return false;
    const value = bytes.reduce((value, byte) => value * 256 + Number(byte), 0);
    return !blockedV4.some(([network, prefix]) => Math.floor(value / 2 ** (32 - prefix)) === Math.floor(network / 2 ** (32 - prefix)));
  }
  // URL parsing normalizes embedded IPv4 and compressed IPv6 without Node-only imports.
  if (!address.includes(':') || address.includes('%') || /[\[\]/]/.test(address)) return false;
  let normalized: string;
  try { normalized = new URL(`https://[${address}]/`).hostname.slice(1, -1); } catch { return false; }
  const halves = normalized.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].map(word => parseInt(word, 16));
  // Only native global unicast; excludes mapped, NAT64, local, multicast, and future allocations.
  if (words[0] < 0x2000 || words[0] > 0x3fff) return false;
  if (words[0] === 0x2001 && (words[1] < 0x200 || words[1] === 0xdb8)) return false;
  if (words[0] === 0x2002 || (words[0] === 0x3fff && words[1] < 0x1000)) return false;
  if (words[0] === 0x2620 && words[1] === 0x4f && words[2] === 0x8000) return false;
  return true;
}

export function assertPublicConnectorAddresses(addresses: readonly { address: string; family: number }[]): void {
  if (!addresses.length || addresses.length > 64 || addresses.some(({ address, family }) =>
    (family !== 4 && family !== 6) || (family === 4) !== !address.includes(':') || !isPublicConnectorAddress(address))) {
    throw new ConnectorTransportError('Connector DNS must resolve exclusively to public unicast addresses');
  }
}

export function validateConnectorUrl(input: string | URL): URL {
  const value = String(input);
  if (value.length > 8192 || /[\x00-\x20\\]/.test(value)) throw new ConnectorTransportError('Invalid connector URL');
  let url: URL;
  try { url = new URL(value); } catch { throw new ConnectorTransportError('Invalid connector URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || value.includes('#')) throw new ConnectorTransportError('Connector URL requires HTTPS without credentials or fragment');
  const hostname = url.hostname.replace(/\.$/, '');
  const literal = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  if (literal.includes(':') || /^\d+(\.\d+){3}$/.test(literal)) {
    if (!isPublicConnectorAddress(literal)) throw new ConnectorTransportError('Connector address is not public unicast');
  } else {
    if (hostname.length > 253 || !hostname.includes('.') || hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ||
      /(?:^|\.)(?:localhost|local|localdomain|internal|home|lan|invalid|test|example|onion|arpa|alt)$/.test(hostname)) throw new ConnectorTransportError('Connector hostname is not a public DNS name');
    if (/(?:^|\.)example\.(?:com|net|org)$/.test(hostname)) throw new ConnectorTransportError('Connector hostname is reserved for documentation');
  }
  if (hasConnectorQueryCredentials(url)) throw new ConnectorTransportError('Connector URL must not contain query credentials');
  url.hostname = hostname;
  return url;
}
