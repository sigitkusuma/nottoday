/** Writes routing decisions to Analytics Engine for the console's dashboard. */

import { toDataPoint, type StatsOutcome, type StatsRow } from "@gw/shared";

type RecordInput = { app: string; outcome: StatsOutcome } & { [K in Exclude<keyof StatsRow, "app" | "outcome">]?: StatsRow[K] };

/** Stats are optional: without the binding (local dev, older installs) nothing is written. */
export function record(dataset: AnalyticsEngineDataset | undefined, row: RecordInput): void {
  if (!dataset) return;
  try {
    dataset.writeDataPoint(
      toDataPoint({
        route: "",
        kind: "",
        type: "",
        channel: "",
        mode: "",
        filter: "",
        reason: "",
        status: 0,
        attempts: 0,
        ...stripUndefined(row),
      }),
    );
  } catch (err) {
    console.error(JSON.stringify({ message: "stats write failed", error: String(err) }));
  }
}

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
