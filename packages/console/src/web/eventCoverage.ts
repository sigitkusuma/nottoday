/**
 * Does a route forward the events its workflow listens for? A Slack Trigger node
 * lists the event types it subscribes to, and the route lists the ones the
 * gateway forwards. An event the route doesn't list never reaches the workflow,
 * even in shadow mode, so a gap here is the usual reason "it arrives but nothing happens".
 */

/** Event types the workflow's trigger listens to that the route doesn't forward. Empty when either side means "any". */
export function unforwardedEvents(listensTo: string[] | undefined, forwards: string[]): string[] {
  if (!listensTo || listensTo.length === 0 || listensTo.includes("*")) return [];
  if (forwards.length === 0 || forwards.includes("*")) return [];
  return listensTo.filter((e) => !forwards.includes(e));
}

/** "app_mention" or "app_mention and reaction_added" */
export function eventNames(events: string[]): string {
  return events.length < 2 ? (events[0] ?? "") : `${events.slice(0, -1).join(", ")} and ${events[events.length - 1]}`;
}
