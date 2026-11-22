import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { manualClock, ok, seededRandom } from "../../base/mod.ts";
import { hlcAtMs } from "../../protocol/apps/sync/clock.ts";
import type { Id } from "../../protocol/base/ids.ts";
import { TOMBSTONE_HORIZON_MS } from "../../protocol/folder/mod.ts";
import type { Sql } from "../../protocol/server/mod.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { cleanupBefore } from "./environment.ts";
import { createFolderImport } from "./import/mod.ts";
import {
  FOLDER_CODE_COMMIT_STEPS,
  FOLDER_DESTINATION_STEPS,
  FOLDER_SCHEMA_STEPS,
} from "./schema.ts";

const ME = "mch_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"mch">;
const LAPTOP = "mch_01hyyyyyyyyyyyyyyyyyyyyyyy" as Id<"mch">;
const DESK = "mch_01hxxxxxxxxxxxxxxxxxxxxxxx" as Id<"mch">;
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"app">;
const NOW = Date.UTC(2026, 10, 16);
const FLOOR = hlcAtMs(NOW - TOMBSTONE_HORIZON_MS);
// 90일 쪽보다 늦은 settled 둘과 옛 settled 하나.
const RECENT = hlcAtMs(NOW - 2 * 24 * 3600 * 1000);
const NEWER = hlcAtMs(NOW - 3600 * 1000);
const OLD = hlcAtMs(NOW - 200 * 24 * 3600 * 1000);

// 알려진 기계는 import가 아는 그 앱 기록(사람이 지운 기계는 빠진다)이다. 표를 실제 import로 읽는다. 앱 기록은 destination마다
// 있고, 흔적은 앱 DB에 하나라 모든 destination의 기록이 경계를 붙든다.
function peersOf(
  rows: {
    machine: Id<"mch">;
    settled: bigint | null;
    destination?: string;
  }[],
  forget: Id<"mch">[] = [],
) {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "create table releases (id text, app text, status text, declaration text)",
  );
  for (const step of [
    ...FOLDER_SCHEMA_STEPS,
    ...FOLDER_CODE_COMMIT_STEPS,
    ...FOLDER_DESTINATION_STEPS,
  ]) {
    db.exec(step.sql);
  }
  const sql: Sql = createSql(db, () => true);
  for (const row of rows) {
    sql.run(
      `INSERT INTO folder_records (machine, origin, kind, key, revision, record, destination, read_at)
       VALUES (?, ?, 'app', ?, 1, ?, ?, '2026-11-16T00:00:00.000Z')`,
      [
        ME,
        row.machine,
        APP,
        JSON.stringify({
          data: { head: 1 },
          settled: row.settled === null ? null : row.settled.toString(),
          horizon: null,
        }),
        row.destination ?? "personal",
      ],
    );
  }
  const folder = createFolderImport({
    machine: () => ME,
    self: () => ({ name: "Desk", lophn_version: "0.23.0" }),
    destinations: { list: () => [], resolve: () => null },
    apps: () => [],
    apply: {
      applyChanges: async () =>
        ok({ applied: 0, skipped: 0, duplicate: 0, held: 0 }),
      mergeSnapshot: async () => ok({ changed: false, deleted: 0 }),
    },
    exportState: () => ({ settled: null, data_head: 0, away_since: null }),
    heldRows: () => [],
    sql,
    transaction: (fn) => fn({ sql }),
    clock: manualClock(NOW),
    random: seededRandom(1),
    root: "/nonexistent",
  });
  for (const machine of forget) {
    assert.equal(folder.forgetMachine(machine).ok, true);
  }
  // 그 앱이 data를 주고받는 destination 둘의 기록을 모은다(흔적은 앱 DB에 하나다).
  return ["personal", "drive"].flatMap((destination) =>
    folder.peerHorizons(APP, destination),
  );
}

const at = (value: bigint | null) => (value === null ? null : value.toString());

test("the cleanup bound never passes a known machine's settled on any destination of the app unless it is older than 90 days, and a forgotten machine does not hold it", () => {
  const cases: {
    name: string;
    // 이 기계의 그 앱 stream마다(destination마다)의 settled.
    own: (bigint | null)[];
    peers: {
      machine: Id<"mch">;
      settled: bigint | null;
      destination?: string;
    }[];
    forget?: Id<"mch">[];
    want: bigint;
  }[] = [
    {
      name: "no other machine: own settled",
      own: [RECENT],
      peers: [],
      want: RECENT,
    },
    {
      name: "the least settled of all",
      own: [NEWER],
      peers: [
        { machine: LAPTOP, settled: RECENT },
        { machine: DESK, settled: NEWER },
      ],
      want: RECENT,
    },
    {
      name: "a machine that settled long ago waits no longer than 90 days",
      own: [NEWER],
      peers: [{ machine: LAPTOP, settled: OLD }],
      want: FLOOR,
    },
    {
      name: "a machine with no settled yet: only the 90-day side",
      own: [NEWER],
      peers: [{ machine: LAPTOP, settled: null }],
      want: FLOOR,
    },
    {
      name: "this machine has no settled yet: only the 90-day side",
      own: [null],
      peers: [{ machine: LAPTOP, settled: NEWER }],
      want: FLOOR,
    },
    {
      name: "a forgotten machine does not hold the bound back",
      own: [NEWER],
      peers: [
        { machine: LAPTOP, settled: OLD },
        { machine: DESK, settled: RECENT },
      ],
      forget: [LAPTOP],
      want: RECENT,
    },
    {
      name: "a machine that reads the app's tables only on another destination holds it too",
      own: [NEWER, NEWER],
      peers: [
        { machine: LAPTOP, settled: NEWER, destination: "personal" },
        { machine: DESK, settled: RECENT, destination: "drive" },
      ],
      want: RECENT,
    },
    {
      name: "one stream of this machine with no settled yet: only the 90-day side",
      own: [NEWER, null],
      peers: [{ machine: LAPTOP, settled: NEWER }],
      want: FLOOR,
    },
    {
      name: "a forgotten machine with no settled does not hold it either",
      own: [NEWER],
      peers: [{ machine: LAPTOP, settled: null }],
      forget: [LAPTOP],
      want: NEWER,
    },
  ];
  for (const each of cases) {
    const peers = peersOf(each.peers, each.forget);
    const before = cleanupBefore({ own: each.own.map(at), peers, nowMs: NOW });
    assert.equal(before, each.want, each.name);
    const known = peers.flatMap((peer) =>
      peer.settled === null ? [] : [BigInt(peer.settled)],
    );
    const all = each.own.some((own) => own === null)
      ? known
      : [...known, ...(each.own as bigint[])];
    // 지우는 것은 모두가 지난 것이거나 90일보다 옛 것뿐이다.
    assert.ok(
      before <= FLOOR || all.every((settled) => before <= settled),
      each.name,
    );
  }
});
