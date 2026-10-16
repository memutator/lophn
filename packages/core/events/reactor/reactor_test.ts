import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  seededRandom,
} from "../../../base/mod.ts";
import { problemOpened } from "../../../protocol/events/mod.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import { applyMigrations } from "../../storage/migration/mod.ts";
import {
  LEDGER_SCHEMA_STEPS,
  openConnection,
  openLedger,
} from "../../storage/ledger/mod.ts";
import { REACTOR_PRINCIPAL } from "../subscriber-registration.ts";
import { createReactor } from "./reactor.ts";
import { createEventsReader, createSqlCursor } from "./store.ts";

const REACTOR: RequestContext = {
  principal: REACTOR_PRINCIPAL,
  actor: "machine",
  scope: { operations: ["AdvanceSubscriberCursor"], targets: {} },
  conditions: {},
  credential_ref: REACTOR_PRINCIPAL,
};

Deno.test("꺼졌다 켜지면 Reactor가 cursor 뒤부터 이어 반응하고 같은 event에 두 번 반응하지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "reactor-" });
  const path = `${dir}/core.sqlite`;
  const clock = manualClock(Date.UTC(2026, 0, 1));
  try {
    const migrated = await applyMigrations(path, [...LEDGER_SCHEMA_STEPS], {
      clock,
    });
    assert(migrated.ok);
    const opened = openLedger(path, {
      clock,
      ids: createIdSource({ clock, random: seededRandom(1) }),
      registerBlobRef: () => err({ code: "unavailable", message: "unused" }),
      call: () => err({ code: "unavailable", message: "unused" }),
    });
    assert(opened.ok);
    const ledger = opened.value;
    const written = ledger.transaction({ actor: "user" }, (tx) => {
      for (let i = 0; i < 3; i++) {
        tx.emit(problemOpened, tx.newId("prb"), {
          app: tx.newId("app"),
          report: tx.newId("rpt"),
        });
      }
      return ok(undefined);
    });
    assert(written.ok);
    const side = openConnection(path);
    assert(side.ok);

    // 효과는 idempotency key로 센다. 같은 key는 한 번이다.
    const effects = new Map<string, number>();
    const calls: string[] = [];
    let unavailableOnce = true;
    const handler = {
      name: "test.handler",
      async handle(
        event: { seq: string },
        context: { idempotencyKey(reaction: string): Promise<string> },
      ) {
        calls.push(event.seq);
        const key = await context.idempotencyKey("effect");
        effects.set(key, (effects.get(key) ?? 0) + 1);
        if (event.seq === "2" && unavailableOnce) {
          unavailableOnce = false;
          return err({ code: "unavailable" as const, message: "not now" });
        }
        return ok(undefined);
      },
    };
    // 첫 event의 cursor 저장이 한 번 실패해(죽은 것과 같다) 첫 event가 두 번 불린다.
    let failCursorOnce = true;
    const makeReactor = () =>
      createReactor({
        reader: createEventsReader(side.value.sql),
        cursor: createSqlCursor(side.value.sql, (through) => {
          if (failCursorOnce) {
            failCursorOnce = false;
            return Promise.resolve(
              err({ code: "unavailable" as const, message: "crashed" }),
            );
          }
          return Promise.resolve(ledger.transaction(
            { actor: "machine", request: REACTOR },
            (tx) => tx.advanceSubscriberCursor("reactor", through),
          ));
        }),
        clock,
        log: () => {},
      });

    const first = makeReactor();
    first.on("ProblemOpened", handler);
    await first.wake();
    // 첫 event의 cursor 저장이 실패해 backoff 중이다. 시각이 지나기 전에는 다시 하지 않는다.
    assertEquals(calls, ["1"]);
    await first.wake();
    assertEquals(calls, ["1"]);
    clock.advance(1_000);
    await first.wake();
    // 첫 event를 다시 하고 둘째에서 unavailable로 멈춘다.
    assertEquals(calls, ["1", "1", "2"]);
    await first.stop();

    // 꺼졌다 켠다. cursor(1) 뒤인 둘째 event부터 잇는다.
    const second = makeReactor();
    second.on("ProblemOpened", handler);
    await second.wake();
    assertEquals(calls, ["1", "1", "2", "2", "3"]);
    await second.wake();
    assertEquals(calls.length, 5);
    await second.stop();

    // 셋 모두에 효과 key가 하나씩이다. 첫째와 둘째는 두 번 불렸어도 key는 하나다.
    assertEquals([...effects.values()], [2, 2, 1]);
    ledger.close();
    side.value.close();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
