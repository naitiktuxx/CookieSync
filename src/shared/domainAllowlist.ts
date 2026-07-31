export function parseDomainList(value: string): string[] {
  return value
    .split(/[\n,]+/u)
    .map(normalizeDomain)
    .filter((domain): domain is string => Boolean(domain));
}

export function normalizeDomain(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  const withoutProtocol = trimmed.replace(/^https?:\/\//u, "");
  const host = withoutProtocol.split("/")[0]?.split(":")[0]?.replace(/^\*\./u, "").replace(/^\./u, "");
  return host || undefined;
}

export function cookieMatchesAllowedDomains(cookieDomain: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) {
    return false;
  }

  const normalizedCookieDomain = normalizeDomain(cookieDomain);
  if (!normalizedCookieDomain) {
    return false;
  }

  return allowedDomains.some(
    (allowedDomain) => normalizedCookieDomain === allowedDomain || normalizedCookieDomain.endsWith(`.${allowedDomain}`)
  );
}
