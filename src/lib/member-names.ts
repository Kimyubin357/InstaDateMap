const PLACEHOLDER_NAMES = new Set(["익명", "anonymous", "unknown", "guest", "undefined", "null"]);

/** Historical labels are suggestions, never a condition for configuring a couple. */
export function suggestedMemberNames(labels: unknown[]): string[] {
  return [...new Set(labels.filter((label): label is string => typeof label === "string")
    .map((label) => label.trim())
    .filter((label) => label.length > 0 && label.length <= 20 && !PLACEHOLDER_NAMES.has(label.toLowerCase())))].slice(0, 2);
}
