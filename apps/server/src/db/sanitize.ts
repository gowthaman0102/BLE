export function sanitizeDbUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return `${u.protocol}//${u.username ? '***' : ''}${u.password ? ':***@' : ''}${u.host}${u.pathname}`;
  } catch {
    return '***';
  }
}
