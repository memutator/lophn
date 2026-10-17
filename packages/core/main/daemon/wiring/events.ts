import { err, ok } from "../../../../base/mod.ts";
import { DOMAIN_EVENTS } from "../../../../protocol/events/mod.ts";
import type {
  AuthenticatedContext,
  Sql,
} from "../../../../protocol/server/mod.ts";
import {
  createBus,
  createEventsReader,
  createGatewayFrames,
  createReactor,
  createSqlCursor,
  REACTOR_PRINCIPAL,
  REACTOR_SUBSCRIBER,
  type ReactorRunner,
} from "../../../events/mod.ts";
import {
  createCommitPublisher,
  type LedgerConnection,
  openConnection,
  type Writer,
} from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

// Reactor가 cursor를 올리는 core 안 machine 자격이다. 기동 때 ledger에 기록한다.
const reactorContext: AuthenticatedContext = {
  principal: REACTOR_PRINCIPAL,
  actor: "machine",
  scope: { operations: ["AdvanceSubscriberCursor"], targets: {} },
  conditions: {},
  credential_ref: REACTOR_PRINCIPAL,
};

const DOMAIN_TYPES = DOMAIN_EVENTS.map((event) => event.type);

// Bus 하나를 만들어 모두에게 준다. Gateway 연결은 서버가 이 Bus에 붙이고,
// Bus 밖 frame(터미널 요청 등)은 gateway slot으로 보낸다.
// Reactor도 여기서 만든다. 다른 wiring이 build에서 `ctx.reactor.on`으로 handler를 등록하고, 이 wiring이 start에서 돌린다.
export const eventsWiring: WiringFactory = () => {
  // events를 읽는 main thread 연결 하나. prepare 때 ledger는 이미 migration을 마쳤다.
  let connection: LedgerConnection | undefined;
  let openError = "";
  let reactor: ReactorRunner | undefined;
  let unsubscribe: (() => void) | undefined;
  // Reactor가 start된 뒤 closeWork 전까지만 true. 점검이 "돌고 있음"으로 쓴다.
  let started = false;
  // 닫힌 뒤 읽기는 던지고, 읽는 쪽(store)이 unavailable로 바꾼다.
  const sql: Pick<Sql, "all" | "get"> = {
    all: (query, params) => {
      if (connection === undefined) throw new Error("ledger connection closed");
      return connection.sql.all(query, params);
    },
    get: (query, params) => {
      if (connection === undefined) throw new Error("ledger connection closed");
      return connection.sql.get(query, params);
    },
  };
  return {
    name: "events",
    records: () => [reactorContext],
    prepare(ctx) {
      ctx.provide("bus", createBus());
      ctx.provide("gateway", createGatewayFrames());
      // 부모 pipe hello의 사람 token operation 목록. Gateway는 operation이 아니라 actor로 열려 비었다.
      // hello를 새 모양으로 바꾸는 events-identity가 이 slot을 걷는다.
      ctx.provide("eventNames", []);

      const opened = openConnection(ctx.ledgerPath);
      if (opened.ok) connection = opened.value;
      else openError = opened.error.message;
      const runner = createReactor({
        reader: createEventsReader(sql),
        cursor: createSqlCursor(sql, async (through, previous) => {
          // Reactor 진행 기록은 domain event를 쓰지 않고, 이 wiring이 Bus 층을 만드는 쪽이라 날 writer를 쓴다.
          const done = await ctx.runtime.writer.command(reactorContext, {
            command: "AdvanceSubscriberCursor",
            input: {
              subscriber: REACTOR_SUBSCRIBER,
              scanned_through_seq: through,
            },
            compare: { processed_through_seq: previous },
            idempotency_key: `reactor-cursor:${previous}:${through}`,
            prepared: [],
          });
          return done.ok ? ok(undefined) : err(done.error);
        }),
        clock: ctx.clock,
      });
      reactor = runner;
      ctx.provide("reactor", runner);
      ctx.componentChecks.push({
        component: "events",
        check: () => {
          if (connection === undefined || !started) {
            return Promise.resolve({
              available: false,
              reason: "events 연결이나 Reactor가 아직 없다",
            });
          }
          try {
            sql.get("select 1 as found from events limit 1", []);
            return Promise.resolve({ available: true });
          } catch {
            return Promise.resolve({
              available: false,
              reason: "events를 읽지 못한다",
            });
          }
        },
      });
    },
    build(ctx) {
      // command가 commit된 뒤 그 tx의 domain event를 Bus로 낸다. Bus는 놓칠 수 있고 Reactor가 표에서 메운다.
      const publisher = createCommitPublisher({
        reader: createEventsReader(sql),
        bus: ctx.bus,
      });
      return ok({
        writer: (inner: Writer): Writer => ({
          ...inner,
          async command(context, envelope) {
            const done = await inner.command(context, envelope);
            if (done.ok && !done.value.replayed) {
              await publisher.onCommit(done.value);
            }
            return done;
          },
        }),
      });
    },
    start(ctx) {
      if (connection === undefined || reactor === undefined) {
        return Promise.resolve(err({
          code: "unavailable",
          message: `ledger를 읽는 연결을 열지 못했다: ${openError}`,
        }));
      }
      const running = reactor;
      // 깨우기만 한다. 놓쳐도 Reactor의 5초 poll이 표에서 메운다.
      unsubscribe = ctx.bus.subscribe([{ types: DOMAIN_TYPES }], {
        send: () => void running.wake(),
        close: () => {},
      });
      running.start();
      started = true;
      return Promise.resolve(ok(undefined));
    },
    closeIntake() {
      unsubscribe?.();
    },
    async closeWork() {
      started = false;
      await reactor?.stop();
      connection?.close();
      connection = undefined;
    },
  };
};
