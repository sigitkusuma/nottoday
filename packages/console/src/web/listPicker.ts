/** Pure helpers for choosing or creating a list inside the route editor. */

export type ListKind = "person" | "channel";

/** The filter fields that take a list of Slack IDs, and whether they hold people or channels. */
export const LIST_FIELD_KINDS = {
  mentionIn: "person",
  channels: "channel",
  excludeChannels: "channel",
  users: "person",
  excludeUsers: "person",
} as const satisfies Record<string, ListKind>;

export type ListField = keyof typeof LIST_FIELD_KINDS;

const SUGGESTED_NAMES: Record<ListField, string> = {
  mentionIn: "mentions",
  channels: "channels",
  excludeChannels: "excluded-channels",
  users: "senders",
  excludeUsers: "excluded-senders",
};

/** A free name for a new list, based on what the field is for: "mentions", then "mentions-2", … */
export function suggestListName(field: ListField, existing: string[]): string {
  const base = SUGGESTED_NAMES[field];
  if (!existing.includes(base)) return base;
  for (let i = 2; ; i++) if (!existing.includes(`${base}-${i}`)) return `${base}-${i}`;
}

export function listNameError(name: string, existing: string[]): string {
  if (!name.trim()) return "Give the list a name.";
  if (!/^[\w-]+$/.test(name.trim())) return "Use letters, digits, - or _ in the name.";
  if (existing.includes(name.trim())) return `A list called "${name.trim()}" already exists. Choose it from the menu instead.`;
  return "";
}

/**
 * Slack IDs start with a letter for what they are: U or W for people, C or G
 * for channels (D for a direct message). Anything else is most likely a name
 * typed by mistake, which would never match.
 */
export function idProblems(values: string[], kind: ListKind): string[] {
  const pattern = kind === "person" ? /^[UW][A-Z0-9]{2,}$/ : /^[CGD][A-Z0-9]{2,}$/;
  return values.filter((v) => !pattern.test(v));
}

export function whereToFindIds(kind: ListKind): string {
  return kind === "person"
    ? "In Slack, open the person's profile, then ⋮ → Copy member ID. It starts with U."
    : "In Slack, click the channel's name at the top, then copy the Channel ID at the bottom of the About tab. It starts with C.";
}

/** What the select shows for a field's current text: nothing, typed IDs, or a saved list. */
export function pickerMode(text: string): "none" | "ids" | "list" {
  const t = text.trim();
  if (!t) return "none";
  return /^@[\w-]+$/.test(t) ? "list" : "ids";
}
