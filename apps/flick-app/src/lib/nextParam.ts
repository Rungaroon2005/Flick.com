/**
 * The `next` search param carries where the user was trying to go before a
 * gate interrupted them. It arrives in a URL, so it is attacker-controlled:
 * a link with ?next=https://evil.com turns our own login screen into an
 * open redirect. safeNext is the only thing standing between that and a
 * router call, so it allowlists rather than sanitises — one leading slash,
 * never two, and no backslash (browsers normalise \ to / in the authority
 * position, so /\evil.com escapes the origin on some engines).
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // URL parsers strip tab, newline, and carriage-return before parsing, so a
  // value containing them will not navigate to the value we checked — reject
  // any that contain these control characters to prevent collapsing to
  // //evil.com or other off-origin URLs.
  if (/[\t\r\n]/.test(raw)) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.startsWith('/\\')) return null;
  return raw;
}

/** Builds `base?next=<encoded>`, dropping an unusable next entirely. */
export function withNext(base: string, next: string | null | undefined): string {
  const safe = safeNext(next);
  if (!safe) return base;
  const [path, existingQuery = ''] = base.split('?');
  const params = new URLSearchParams(existingQuery);
  params.set('next', safe);
  return `${path}?${params.toString()}`;
}
