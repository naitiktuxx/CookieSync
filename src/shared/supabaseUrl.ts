export function normalizeSupabaseUrl(value: string): string {
  const trimmed = value.trim();
  const dashboardMatch = trimmed.match(/supabase\.com\/dashboard\/project\/([^/]+)/u);
  if (dashboardMatch?.[1]) {
    return `https://${dashboardMatch[1]}.supabase.co`;
  }

  return trimmed.replace(/\/$/u, "");
}
