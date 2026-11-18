// 다른 기계가 낸 기계를 건너는 event file을 읽어 이 기계에서 한 번 낸다. 이 기계에 든 앱마다 그 `sync_to` 폴더의 다른 기계
// `apps/<app>/events/`를 나열하고, 꼴·크기·path와 내용·나이(`readEventFile`)·이 기계 활성 release의 bundle hash가 맞고
// `folder_events_seen`에 없는 것을 한 transaction에서 그 표에 적은 뒤 낸다. 같은 file이 여러 길로 와도 행 하나라 한 번이다.
import { type Clock, formatAt, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  CROSS_EVENT_SEEN_KEEP_MS,
  EVENT_FILE_MAX_BYTES,
  type EventFile,
  eventsDir,
  readEventFile,
} from "../../../protocol/folder/carry.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { DestinationsView } from "../destinations.ts";
import { createFolderReader } from "../fs.ts";
import type { EventArrived } from "../ports.ts";

export async function readArrivedEvents(input: {
  me: Id<"mch">;
  apps: { app: Id<"app">; sync_to: string; bundle_hash: string }[];
  destinations: DestinationsView;
  transaction<T>(fn: (tx: Pick<Tx, "sql">) => Result<T>): Result<T>;
  clock: Clock;
  arrived: EventArrived;
}): Promise<Result<number>> {
  const { me } = input;
  const nowMs = input.clock.nowMs();
  const found: EventFile[] = [];
  for (const app of input.apps) {
    const destination = input.destinations.resolve(app.sync_to);
    if (destination === null || destination.state === "missing") continue;
    const reader = createFolderReader(destination.path);
    const machines = await reader.listMachines();
    if (!machines.ok) continue;
    for (const machine of machines.value) {
      if (machine === me) continue;
      const dir = eventsDir(machine, app.app);
      const names = await reader.list(dir);
      if (!names.ok) continue;
      for (const name of names.value) {
        const path = `${dir}/${name}`;
        const read = await reader.read(path, EVENT_FILE_MAX_BYTES);
        if (!read.ok) continue;
        const event = readEventFile(path, read.value, nowMs);
        if (event !== null && event.bundle_hash === app.bundle_hash) {
          found.push(event);
        }
      }
    }
  }
  const at = formatAt(nowMs);
  const fresh = input.transaction((tx) => {
    tx.sql.run(
      "DELETE FROM folder_events_seen WHERE machine = ? AND seen_at < ?",
      [me, formatAt(nowMs - CROSS_EVENT_SEEN_KEEP_MS)],
    );
    const out: EventFile[] = [];
    for (const event of found) {
      const done = tx.sql.run(
        `INSERT INTO folder_events_seen (machine, origin, app, event, seen_at)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        [me, event.machine, event.app, event.id, at],
      );
      if (done.changes > 0) out.push(event);
    }
    return ok(out);
  });
  if (!fresh.ok) return fresh;
  for (const event of fresh.value) {
    input.arrived({
      app: event.app as Id<"app">,
      origin: event.machine as Id<"mch">,
      name: event.name,
      payload: event.payload,
      at: event.at,
      bundle_hash: event.bundle_hash,
    });
  }
  return ok(fresh.value.length);
}
