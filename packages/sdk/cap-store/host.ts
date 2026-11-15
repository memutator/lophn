import type { Migration } from "../../protocol/apps/activation/migration-sql.ts";
import type { StoreDb } from "./db.ts";

// 앱 프로세스의 host가 설치하는 port 중 cap-store가 읽는 부분이다. 같은 port를 cap-net·cap-notify·
// cap-secret도 읽으므로 symbol과 필드 이름이 같아야 한다(그쪽 host.ts와 함께 바꾼다).

export const CAP_HOST = Symbol.for("lophn.cap-host");

// runtime은 SDK를 import하지 않으므로 changeset 훅을 이 symbol의 전역 값으로 주고받는다.
export const STORE_HOOKS = Symbol.for("lophn.cap-store");

export type RuntimeMode = "live" | "preview" | "test";

export type ApplyOutcome = { ok: true } | { ok: false; message: string };

// runtime(packages/core/apps/runtime/entrypoint/cap-host.ts)이 부르는 훅이다.
export type StoreHooks = {
  // 이 process의 DB 연결에 SQLite session을 건다.
  beginChangeset(): void;
  // session을 닫고 changeset을 돌려준다. 바뀐 것이 없으면 null이다.
  endChangeset(): Uint8Array | null;
  // 한 transaction으로 순서대로 적용한다. 하나라도 충돌하면 하나도 적용하지 않는다.
  applyChangesets(changesets: readonly Uint8Array[]): ApplyOutcome;
  // 이 process의 앱 DB 연결이다. runtime의 sync 일이 앱과 같은 연결에서 돈다. 연결이 없으면 null이다.
  database(): StoreDb | null;
};

export type StoreHost = {
  mode: RuntimeMode;
  // 앱 전용 data 영역이다. 앱의 SQLite DB는 이 안에 있다. DB를 host가 열어 주는 폰에서는 비어 있다.
  dataPath: string;
  // 앱 시작처럼 SDK가 load되기 전에 session 구간이 시작될 수 있다. 연결을 여는 쪽이 이걸 본다.
  store?: {
    recording(): boolean;
    // 있으면 cap-store는 파일을 열지 않고 host가 준 DB를 쓴다(폰 host).
    open?(): StoreDb;
    // release의 migration 단계와 그 target이다. `store.migrate()`를 인자 없이 부르면 이것을 쓴다.
    migrations?(): { target: number; steps: Migration[] };
  };
};

export function readHost(): StoreHost | undefined {
  const port = (globalThis as Record<symbol, unknown>)[CAP_HOST];
  if (!port || typeof port !== "object") return;
  const candidate = port as Partial<StoreHost>;
  if (
    typeof candidate.dataPath !== "string" ||
    (candidate.mode !== "live" &&
      candidate.mode !== "preview" &&
      candidate.mode !== "test")
  )
    return;
  return candidate as StoreHost;
}
