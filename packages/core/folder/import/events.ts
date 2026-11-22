// 다른 기계가 낸 기계를 건너는 event file을 읽어 이 기계에서 한 번 낸다. 이 기계에 든 앱마다 그 앱이 표를 보내는 destination 폴더마다
// (`apps`에 (앱, destination)마다 한 줄) 다른 기계
// `apps/<app>/events/`를 나열하고, 꼴·크기·path와 내용·나이(`readEventFile`)·이 기계 활성 release의 code_commit이 맞고
// `folder_events_seen`에 없는 것을 한 transaction에서 그 표에 적은 뒤 낸다. 같은 file이 여러 길로 와도 행 하나라 한 번이다.
import { type Clock, formatAt, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  CROSS_EVENT_SEEN_KEEP_MS,
  EVENT_FILE_MAX_BYTES,
  type EventFile,
  eventsDir,
  readEventFile,
} from "../../../protocol/remote/carry.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { DestinationsView } from "../destinations.ts";
import { createFolderReader } from "../fs.ts";
import type { EventArrived } from "../ports.ts";

/**
 * 이 기계가 그 event file(난 기계, 앱, file id)을 낸 것으로 적는다. 새 줄이면 true다(내야 한다). 같은 event가 늦은 길(file)과 연결
 * (`AppEventPublished`의 `cross_id`)로 둘 다 오므로 두 길이 이 한 표로 한 번만 낸다.
 */
export function markEventSeen(
  tx: Pick<Tx, "sql">,
  input: {
    me: Id<"mch">;
    origin: Id<"mch">;
    app: Id<"app">;
    id: string;
    at: string;
  },
): boolean {
  const done = tx.sql.run(
    `INSERT INTO folder_events_seen (machine, origin, app, event, seen_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    [input.me, input.origin, input.app, input.id, input.at],
  );
  return done.changes > 0;
}

export async function readArrivedEvents(input: {
  me: Id<"mch">;
  apps: { app: Id<"app">; destination: string; code_commit: string }[];
  destinations: DestinationsView;
  transaction<T>(fn: (tx: Pick<Tx, "sql">) => Result<T>): Result<T>;
  clock: Clock;
  arrived: EventArrived;
}): Promise<Result<number>> {
  const { me } = input;
  const nowMs = input.clock.nowMs();
  const found: EventFile[] = [];
  for (const app of input.apps) {
    const destination = input.destinations.resolve(app.destination);
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
        if (event !== null && event.code_commit === app.code_commit) {
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
      if (
        markEventSeen(tx, {
          me,
          origin: event.machine as Id<"mch">,
          app: event.app as Id<"app">,
          id: event.id,
          at,
        })
      ) {
        out.push(event);
      }
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
      code_commit: event.code_commit,
    });
  }
  return ok(fresh.value.length);
}
