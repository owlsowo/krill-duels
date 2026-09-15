import type { PeerOptions } from 'peerjs';

const configurationError = (detail: string): Error => new Error(`Live-room configuration: ${detail}`);

function validIceUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(stun|turn|turns):(?:\[[a-f\d:.]+\]|[a-z\d._-]+)(?::(\d{1,5}))?(\?transport=(?:udp|tcp))?$/i.exec(value);
  return !!match && (!match[2] || Number(match[2]) > 0 && Number(match[2]) <= 65535) &&
    (match[1].toLowerCase() !== 'stun' || !match[3]);
}

/** Vite values are public build-time configuration, including TURN credentials. */
export function peerOptions(): PeerOptions {
  const raw = import.meta.env.VITE_ICE_SERVERS?.trim();
  const policy = import.meta.env.VITE_ICE_TRANSPORT_POLICY?.trim() || 'all';
  if (policy !== 'all' && policy !== 'relay') {
    throw configurationError('VITE_ICE_TRANSPORT_POLICY must be all or relay.');
  }
  if (!raw) {
    if (policy === 'relay') throw configurationError('Relay mode needs a TURN server in VITE_ICE_SERVERS.');
    // Supplying an empty config would replace PeerJS's bundled ICE servers.
    return {};
  }

  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw configurationError('VITE_ICE_SERVERS must be a JSON array of ICE servers.'); }
  if (!Array.isArray(parsed) || !parsed.length) {
    throw configurationError('VITE_ICE_SERVERS must contain at least one ICE server.');
  }

  const iceServers: RTCIceServer[] = parsed.map((value: unknown, index: number) => {
    const label = `VITE_ICE_SERVERS entry ${index + 1}`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw configurationError(`${label} must be an object.`);
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).some(key => !['urls', 'username', 'credential'].includes(key))) {
      throw configurationError(`${label} supports urls, username, and credential fields.`);
    }
    const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    if (!urls.length || !urls.every(validIceUrl)) {
      throw configurationError(`${label} needs valid stun:, turn:, or turns: URLs.`);
    }
    const isTurn = urls.some(url => /^turns?:/i.test(url));
    if ((entry.username !== undefined && typeof entry.username !== 'string') ||
        (entry.credential !== undefined && typeof entry.credential !== 'string') ||
        (isTurn && (typeof entry.username !== 'string' || !entry.username.trim() || typeof entry.credential !== 'string' || !entry.credential))) {
      throw configurationError(`${label} needs string username and credential values for TURN.`);
    }
    return {
      urls: Array.isArray(entry.urls) ? [...urls] : urls[0],
      ...(typeof entry.username === 'string' ? { username: entry.username } : {}),
      ...(typeof entry.credential === 'string' ? { credential: entry.credential } : {}),
    };
  });
  if (policy === 'relay' && !iceServers.some(server =>
    (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => /^turns?:/i.test(url)))) {
    throw configurationError('Relay mode needs a TURN server in VITE_ICE_SERVERS.');
  }
  return { config: { iceServers, iceTransportPolicy: policy } };
}
