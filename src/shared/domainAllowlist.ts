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

/**
 * Certain web ecosystems share authentication, session state, and static assets across multiple related domains.
 * For example, Google and YouTube rely on cross-domain SSO tokens and assets hosted on google.com, googleusercontent.com,
 * and gstatic.com. When a user syncs cookies for one of these primary sites, the related family domains must also be matched
 * to ensure complete session state restoration without breaking auth flows.
 */
const DOMAIN_FAMILIES: Record<string, string[]> = {
  "youtube.com": ["youtube.com", "google.com", "googleusercontent.com", "gstatic.com"],
  "google.com": ["google.com", "youtube.com", "googleusercontent.com", "gstatic.com"]
};

export function cookieMatchesAllowedDomains(cookieDomain: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) {
    return false;
  }

  const normalizedCookieDomain = normalizeDomain(cookieDomain);
  if (!normalizedCookieDomain) {
    return false;
  }

  const expandedAllowed = Array.from(
    new Set(allowedDomains.flatMap((domain) => DOMAIN_FAMILIES[domain] ?? [domain]))
  );

  return expandedAllowed.some(
    (allowedDomain) => normalizedCookieDomain === allowedDomain || normalizedCookieDomain.endsWith(`.${allowedDomain}`)
  );
}
