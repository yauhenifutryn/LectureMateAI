export function isMobileUserAgent(userAgent: string): boolean {
  if (!userAgent) return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}
