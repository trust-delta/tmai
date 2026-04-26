// Deep-link URL parser for /agents/:scheme/:id routes.
//
// Canonical AgentId wire form is "<scheme>:<id>" (e.g. "claude:ea760770-...").
// The URL path replaces the colon with a slash to avoid encoder-mangling:
//   /agents/claude/ea760770-c137-46f6-8fd8-a00d9691c1fb
//
// Provisional agents are excluded from the known-scheme set because they are
// not exposed on the wire (AgentId spec §96 PR4).

const KNOWN_SCHEMES = new Set(["claude", "codex", "gemini", "opencode"]);
const DEEP_LINK_RE = /^\/agents\/([^/]+)\/([^/]+)\/?$/;

export interface DeepLinkParams {
  scheme: string;
  id: string;
  /** True when the scheme is in the known set. False → render 404 immediately. */
  knownScheme: boolean;
  /** The canonical AgentId wire form: "<scheme>:<id>" */
  canonicalId: string;
}

/** Parse a pathname, returning deep-link params or null if it doesn't match. */
export function parseDeepLink(pathname: string): DeepLinkParams | null {
  const match = DEEP_LINK_RE.exec(pathname);
  if (!match) return null;
  const [, scheme, id] = match;
  return {
    scheme,
    id,
    knownScheme: KNOWN_SCHEMES.has(scheme),
    canonicalId: `${scheme}:${id}`,
  };
}

/** Returns deep-link params when the current URL matches /agents/:scheme/:id, otherwise null. */
export function useDeepLink(): DeepLinkParams | null {
  // Evaluated once at render time. window.location.pathname is stable for the
  // lifetime of a page load — no state or effect needed.
  return parseDeepLink(window.location.pathname);
}
