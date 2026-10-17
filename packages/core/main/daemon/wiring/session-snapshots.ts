// session의 지금 상태, 대기 중인 권한 요청, 질문을 모아 내는 read. 화면이 붙거나 다시 붙을 때 읽는다.
// 상태는 각 module이 내놓는 read와 함수에서 모으고(lophn-agent session·turn, coding session, approvals의 turn 안 request),
// 질문은 approvals가 낸 메모리 기다림에서 읽는다.
import { ok } from "../../../../base/mod.ts";
import {
  type SessionSnapshot,
  sessionSnapshotsList,
} from "../../../../protocol/events/snapshot.ts";
import {
  liveSessions,
  loadSession as loadCodingSession,
  stateOf,
} from "../../../apps/tickets/coding/store.ts";
import {
  agentRefOf,
  hasUnfinishedTurn,
  loadSession,
  openSessions,
  placeOf,
} from "../../../lophn-agent/session/model.ts";
import {
  type LedgerConnection,
  openConnection,
} from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

export const sessionSnapshotsWiring: WiringFactory = () => {
  let connection: LedgerConnection | undefined;
  return {
    name: "session-snapshots",
    build(ctx) {
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      connection = opened.value;
      const { sql } = opened.value;
      const lookup = { sql };
      const snapshotsOf = (sessions: string[] | undefined) => {
        const snapshots: SessionSnapshot[] = [];
        const requests = (session: string) =>
          ctx.approvals.turnRequests(session);
        const lophn = sessions === undefined
          ? openSessions(lookup)
          : sessions.flatMap((id) => loadSession(lookup, id) ?? []);
        for (const row of lophn) {
          const permission_requests = requests(row.id);
          const questions = ctx.questionWaits.list(row.id);
          snapshots.push({
            session: row.id,
            agent: agentRefOf(row),
            place: placeOf(row),
            state: permission_requests.length > 0 || questions.length > 0
              ? "waiting"
              : hasUnfinishedTurn(lookup, row.id)
              ? "running"
              : "idle",
            permission_requests,
            questions,
          } as SessionSnapshot);
        }
        const coding = sessions === undefined
          ? liveSessions(sql)
          : sessions.flatMap((id) => loadCodingSession(sql, id) ?? []);
        for (const row of coding) {
          snapshots.push({
            session: row.session,
            agent: { role: "coding_agent", app: row.app },
            place: { kind: "app", id: row.app },
            state: stateOf(row),
            permission_requests: requests(row.session),
            questions: [],
          } as SessionSnapshot);
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
      });
    },
    closeWork() {
      connection?.close();
      connection = undefined;
    },
  };
};
