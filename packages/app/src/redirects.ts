/** External HTTP redirects are valid; active URL schemes must never reach Location.assign. */
export function safeRedirect(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url, 'https://kanso.invalid'); }
  catch { throw new Error('Invalid redirect URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error('Invalid redirect URL: use a relative path or HTTP(S) URL without credentials.');
  return url;
}
