// session의 지금 상태, 대기 중인 turn request, 질문을 모아 내는 read. 화면이 붙거나 다시 붙을 때 읽는다.
// 상태는 각 module이 내놓는 read와 함수에서 모으고(lophn-agent session·turn, coding session, approvals의 turn 안 request),
// 질문은 approvals가 낸 메모리 기다림에서 읽는다. 쓰는 중인 model 글(`writing`)은 같은 곳에서 만들고 여기서 싣는다.
import { createIdSource, ok } from "../../../../base/mod.ts";
import {
  type SessionSnapshot,
  sessionSnapshotsList,
} from "../../../../protocol/events/snapshot.ts";
import { recordMessage } from "../../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  codingPlace,
  liveSessions,
  loadSession as loadCodingSession,
  stateOf,
} from "../../../apps/coding/store.ts";
import {
  agentRefOf,
  hasUnfinishedTurn,
  loadSession,
  openSessions,
  placeOf,
} from "../../../lophn-agent/session/model.ts";
import {
  createLiveTurns,
  withLiveTurns,
} from "../../../lophn-agent/run-loop/live-turns.ts";
import {
  type LedgerConnection,
  openConnection,
} from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

// 멈춘 turn의 쓰는 중인 글을 machine 자격으로 저장하는 core 안 자격이다. 기동 때 ledger에 기록한다.
const LIVE_TURNS_PRINCIPAL = "machine:live-turns";

const LIVE_TURNS_CONTEXT: AuthenticatedContext = {
  principal: LIVE_TURNS_PRINCIPAL,
  actor: "machine",
  scope: { operations: [recordMessage.name], targets: {} },
  conditions: {},
  credential_ref: LIVE_TURNS_PRINCIPAL,
};

export const sessionSnapshotsWiring: WiringFactory = () => {
  let connection: LedgerConnection | undefined;
  let unsubscribe: (() => void) | undefined;
  return {
    name: "session-snapshots",
    records: () => [LIVE_TURNS_CONTEXT],
    build(ctx) {
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      connection = opened.value;
      const { sql } = opened.value;
      const lookup = { sql };
      // 날 글을 받는 곳(agent runtime)과 `writing`을 싣는 곳이 달라 한 곳에 둔다. retry·저장·멈춤에서 날 글과
      // 낸 글이 같이 비워진다.
      const liveTurns = createLiveTurns({
        known: () => ctx.peek.knownSecrets,
        publish: (event) => ctx.bus.publish(event),
        clock: ctx.clock,
      });
      ctx.provide("liveTurns", liveTurns);
      unsubscribe = ctx.bus.subscribe(
        [{
          types: [
            "MessageRecorded",
            "ToolCallStarted",
            "TurnStarted",
            "TurnEnded",
          ],
        }],
        { send: (event) => liveTurns.apply(event), close() {} },
      );
      const snapshotsOf = (sessions: string[] | undefined) => {
        const snapshots: SessionSnapshot[] = [];
        const requests = (session: string) =>
          ctx.approvals.turnRequests(session);
        const lophn = sessions === undefined
          ? openSessions(lookup)
          : sessions.flatMap((id) => loadSession(lookup, id) ?? []);
        for (const row of lophn) {
          const turn_requests = requests(row.id);
          const questions = ctx.questionWaits.list(row.id);
          snapshots.push({
            session: row.id,
            agent: agentRefOf(row),
            place: placeOf(row),
            state: turn_requests.length > 0 || questions.length > 0
              ? "waiting"
              : hasUnfinishedTurn(lookup, row.id)
              ? "running"
              : "idle",
            writing: liveTurns.writing(row.id),
            turn_requests,
            questions,
          } as SessionSnapshot);
        }
        const coding = sessions === undefined
          ? liveSessions(sql)
          : sessions.flatMap((id) => loadCodingSession(sql, id) ?? []);
        for (const row of coding) {
          snapshots.push(
            {
              session: row.session,
              agent: { role: "coding_agent", app: row.app },
              place: codingPlace(sql, row.app),
              state: stateOf(row),
              harness: row.harness,
              turn_requests: requests(row.session),
              questions: [],
            } satisfies SessionSnapshot,
          );
        }
        return snapshots;
      };

      return ok({
        reads: (reads) =>
          reads.set(
            `${sessionSnapshotsList.resource}/${sessionSnapshotsList.method}`,
            (_who, input) => {
              const head = sql.get(
                "SELECT COALESCE(MAX(seq), 0) AS head FROM events",
                [],
              );
              return ok({
                snapshots: snapshotsOf(
                  (input as { sessions?: string[] }).sessions,
                ),
                as_of_seq: String(head?.head ?? 0),
                next_cursor: null,
              });
            },
          ),
        // `StopTurn` 앞에서 그 turn의 쓰는 중인 글을 사람이 본 데까지 저장한다. 이 wiring은
        // `lophnAgentSessionWiring`보다 바깥이고 `ctx.writer`는 부를 때 읽는다.
        writer: (inner) =>
          withLiveTurns(inner, {
            live: liveTurns,
            context: LIVE_TURNS_CONTEXT,
            writer: () => ctx.writer,
            ids: createIdSource({ clock: ctx.clock, random: ctx.random }),
            clock: ctx.clock,
            publish: (event) => ctx.bus.publish(event),
          }),
      });
    },
    closeWork() {
      unsubscribe?.();
      unsubscribe = undefined;
      connection?.close();
      connection = undefined;
    },
  };
};
