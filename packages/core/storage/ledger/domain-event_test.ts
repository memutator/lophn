import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  seededRandom,
} from "../../../base/mod.ts";
import { codingSessionEnded } from "../../../protocol/events/mod.ts";
import type { BusEvent } from "../../../protocol/events/mod.ts";
import { applyMigrations } from "../migration/mod.ts";
import {
  createCommitPublisher,
  LEDGER_SCHEMA_STEPS,
  openConnection,
  openLedger,
} from "./mod.ts";

// 상태 표 하나만 더한 ledger를 임시 폴더에 열어 domain event와 상태가 한 tx에 묶이는지 본다.
Deno.test("domain event가 상태와 같은 tx에 쓰인다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ledger-" });
  const path = `${dir}/core.sqlite`;
  const clock = manualClock(Date.UTC(2026, 0, 1));
  try {
    const migrated = await applyMigrations(path, [
      ...LEDGER_SCHEMA_STEPS,
      { id: "state", sql: "create table states (id text primary key)" },
    ], { clock });
    assert(migrated.ok);
    const side = openConnection(path);
    assert(side.ok);
    const count = (table: string) =>
      Number(side.value.sql.get(`select count(*) as n from ${table}`, [])?.n);

    const published: { event: BusEvent; eventsVisible: number }[] = [];
    const bus = {
      publish: (event: BusEvent) =>
        published.push({ event, eventsVisible: count("events") }),
    };
    // reader는 commit된 행만 보는 다른 연결이다.
    const reader = {
      readRange: (first: string, last: string) =>
        Promise.resolve(ok(
          side.value.sql.all(
            "select seq, type, subject, actor, at, payload from events where seq between ? and ? order by seq",
            [BigInt(first), BigInt(last)],
          ).map((row) => ({
            ...row,
            seq: String(row.seq),
            payload: JSON.parse(String(row.payload)),
          })),
        )),
    };
    const publisher = createCommitPublisher({ reader, bus });
    const pending: Promise<void>[] = [];
    const opened = openLedger(path, {
      clock,
      ids: createIdSource({ clock, random: seededRandom(1) }),
      registerBlobRef: () => err({ code: "unavailable", message: "unused" }),
      call: () => err({ code: "unavailable", message: "unused" }),
      onCommit: (success) => pending.push(publisher.onCommit(success)),
    });
    assert(opened.ok);
    const ledger = opened.value;
    const write = (fail: boolean) =>
      ledger.transaction({ actor: "user" }, (tx) => {
        tx.sql.run("insert into states (id) values (?)", [tx.newId("prj")]);
        tx.emit(codingSessionEnded, tx.newId("ses"), { app: tx.newId("app") });
        return fail ? err({ code: "conflict", message: "no" }) : ok(undefined);
      });

    // 롤백이면 상태도 event도 없고 Bus로 나가지 않는다.
    assert(!write(true).ok);
    await Promise.all(pending);
    assertEquals([count("states"), count("events"), published.length], [
      0,
      0,
      0,
    ]);

    // 성공이면 둘 다 있고, Bus로는 commit된 뒤에 나간다.
    assert(write(false).ok);
    await Promise.all(pending);
    assertEquals([count("states"), count("events")], [1, 1]);
    assertEquals(published.length, 1);
    assertEquals(published[0].event.type, "CodingSessionEnded");
    assertEquals(published[0].eventsVisible, 1);

    ledger.close();
    side.value.close();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
