import type { Result } from "../../../base/mod.ts";
import type { NoticeRecordInput } from "../../../protocol/apps/notice.ts";
import type { StateChange } from "../../../protocol/events/changes.ts";
import type { Bus } from "../../events/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { loadApps } from "../registration/mod.ts";
import { loadActiveDeclaration } from "../releases/store.ts";

export const PHONE_CHANGED_NOTICE_KEY = "phone_changed";

export function primaryDeviceId(sql: Pick<Sql, "get">): string | null {
  const row = sql.get("select id from devices where is_primary = 1", []);
  return row === undefined ? null : String(row.id);
}

// 폰 화면이 있는 활성 앱 수. 활성 release가 없는 앱은 폰이 받지 못하므로 세지 않는다.
export function countPhoneScreenApps(sql: Pick<Sql, "get" | "all">): number {
  const apps = loadApps(sql, "active");
  if (!apps.ok) return 0;
  let count = 0;
  for (const app of apps.value) {
    const active = loadActiveDeclaration(sql, app.id);
    if (!active.ok || active.value === null) continue;
    if (
      active.value.declaration.screens.some((screen) =>
        screen.places.includes("phone"),
      )
    ) {
      count += 1;
    }
  }
  return count;
}

// 기준 폰이 바뀌면(새 pairing, 기준 바꾸기, 기준을 지운 뒤 다른 기기) 폰 화면이 있는 앱 수를 한 줄로 알린다.
// 알리기만 하고 다시 그리지 않는다. 마지막으로 본 기준 id는 메모리에만 둔다: pairing은 core가 켜져 있어야 하므로
// core가 꺼진 사이의 변경은 없다.
export function createPhoneChangedWatch(ports: {
  primaryId(): string | null;
  phoneScreenApps(): number;
  record(input: NoticeRecordInput): Promise<Result<unknown>>;
}) {
  let last = ports.primaryId();
  return {
    async onStateChanged(
      changes: readonly StateChange[],
    ): Promise<Result<unknown> | null> {
      if (!changes.some((change) => change.name === "remote_devices")) {
        return null;
      }
      const now = ports.primaryId();
      if (now === last) return null;
      last = now;
      // 기준을 지운 것은 바뀐 폰이 아직 없다. 다른 기기가 기준이 될 때 알린다.
      if (now === null) return null;
      const apps = ports.phoneScreenApps();
      if (apps < 1) return null;
      return await ports.record({
        kind: "phone_changed",
        key: PHONE_CHANGED_NOTICE_KEY,
        params: { apps },
      });
    },
  };
}

// Bus의 StateChanged를 받아 감시에 넘긴다. 쓰기 실패는 core를 멈추지 않고 warn만 남긴다(다음 변경이 다시 알린다).
export function startPhoneChangedWatch(deps: {
  bus: Pick<Bus, "subscribe">;
  sql: Pick<Sql, "get" | "all">;
  record(input: NoticeRecordInput): Promise<Result<unknown>>;
  warn(message: string): void;
}): () => void {
  const watch = createPhoneChangedWatch({
    primaryId: () => primaryDeviceId(deps.sql),
    phoneScreenApps: () => countPhoneScreenApps(deps.sql),
    record: deps.record,
  });
  return deps.bus.subscribe([{ types: ["StateChanged"] }], {
    send(event) {
      const changes = (event.payload as { changes: StateChange[] }).changes;
      void watch
        .onStateChanged(changes)
        .then((done) => {
          if (done !== null && !done.ok) deps.warn(done.error.message);
        })
        .catch((error: unknown) => deps.warn(String(error)));
    },
    close() {},
  });
}
