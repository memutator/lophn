// sync core: 앱 DB 사본들(컴퓨터와 폰, 폴더를 거치는 기계끼리)을 칸 단위 last-write-wins로 맞춘다. 컴퓨터의 app
// runtime과 폰 host가 같은 file을 쓴다. IO는 SyncDb 하나로만 하고, zod와 node: module을 import하지 않는다(폰 앱이
// Metro로 이 폴더를 바로 읽는다). Node driver는 `node-db.ts`에 따로 있다.
//
// 찍기와 적용의 순서(폰): guest의 write는 outbox 줄과 같이 commit되고 clock은 host가 나중에 찍는다. 그래서 들어온
// 변경을 적용하는 transaction은 맨 앞에서 `stampOutbox`를 부른다(`applyIncoming`이 그 둘을 묶는다). 찍기 전에
// 적용하면 들어온 변경이 옛 칸 clock과 비교되어 local 값을 덮고, 뒤에 찍은 local clock이 그 칸을 local이 이긴
// 것으로 적어 사본이 갈린다.
//
// transaction: applyRemote·applyIncoming·mergeSnapshot·dropTombstones·stampLocal·stampOutbox·adoptSnapshot은
// 부르는 쪽 transaction 안에서 돈다. 들어온 변경이나 snapshot을 적용할 때는 transaction을 열기 전에 foreign_keys를
// 끈다. reexpress와 migrate만 스스로 transaction을 연다.

export {
  type ApplyOptions,
  type ApplyStats,
  applyIncoming,
  applyRemote,
  type ConflictPolicy,
  type ConflictResolver,
  deriveConflictRow,
  type IncomingChange,
  unsafePastHorizon,
} from "./apply.ts";
export { decodePk } from "./changeset.ts";
export {
  type Clock,
  clockAhead,
  hlcAtMs,
  maxHlc,
  msOfHlc,
  nodeOfHlc,
  openClock,
} from "./clock.ts";
export type { SqlParam, SyncDb, SyncSession } from "./db.ts";
export { dumpClocks, dumpData } from "./dump.ts";
export { dropTombstones } from "./horizon.ts";
export { stampLocal, stampOutbox } from "./local.ts";
export {
  type AbsentDeletes,
  type HeldRow,
  type MergeStats,
  mergeSnapshot,
} from "./merge.ts";
export { type MigrateOptions, type MigrationStep, migrate } from "./migrate.ts";
export {
  type ReexpressInput,
  type ReexpressResult,
  reexpress,
} from "./reexpress.ts";
export { adoptSnapshot } from "./snapshot.ts";
export {
  ensureSyncTables,
  getState,
  type OutboxRow,
  readOutbox,
  type StateKey,
  setState,
  SYNC_TABLES_SQL,
} from "./tables.ts";
