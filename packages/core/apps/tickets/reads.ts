// ticket 읽기. list는 요약만, show는 내용·상태·claim·완료 보고·check 결과·확인 결과를 준다.
// 근거 annotation은 값(메모, component, source 위치, release, screenshot 파일 경로)으로 풀어 싣는다.
import { z } from "zod";
import { ok, type Result } from "../../../base/mod.ts";
import {
  ticketList,
  ticketShow,
  ticketTitleOf,
} from "../../../protocol/coding-agent/ticket/mod.ts";
import type {
  AcceptanceCheck,
  TicketEvidenceRead,
  TicketState,
} from "../../../protocol/coding-agent/ticket/mod.ts";
import { defineRead } from "../../../protocol/base/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
} from "../../../protocol/server/mod.ts";
import { nextCursor, pageAfter } from "./cursor.ts";
import { expiredClaims } from "./claims.ts";
import { boundApp, checkApp, forbidden, notFound } from "./model.ts";
import { TicketAnnotationLookup } from "./ports.ts";

// 만료 정리 후보. 감독 timer가 60초마다와 재시작 때 읽고 expire_claim을 제출한다.
const claimSweep = defineRead({
  resource: "tickets",
  method: "claim_sweep",
  name: "TicketClaimSweep",
  input: z.strictObject({ now: z.string() }),
  output: z.object({
    claims: z.array(z.object({ ticket: z.string(), claim_seq: z.string() })),
    as_of_seq: z.string(),
    next_cursor: z.string().nullable(),
  }),
  actors: ["machine"],
  errors: ["forbidden"],
});

const json = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const list = (value: unknown): string[] => json<string[]>(value);

export function createTicketReads(): {
  list: ReadDefinition<typeof ticketList>;
  show: ReadDefinition<typeof ticketShow>;
  claim_sweep: ReadDefinition<typeof claimSweep>;
} {
  return {
    list: {
      route: ticketList,
      handle(snapshot, ctx, input) {
        // 앱에 묶인 호출자(coding session, App Engineer)는 그 앱의 ticket만 본다.
        const bound = boundApp(snapshot.port, ctx);
        if (!bound.ok) return bound;
        if (
          bound.value !== null && input.app !== undefined &&
          input.app !== bound.value
        ) return forbidden("ticket belongs to another app");
        const app = bound.value ?? input.app ?? null;
        const after = pageAfter(input.cursor, snapshot.as_of_seq);
        if (!after.ok) return after;
        const limit = input.limit ?? 20;
        const rows = snapshot.sql.all(
          `SELECT id, app, goal, state FROM tickets
           WHERE (? IS NULL OR app = ?) AND (? IS NULL OR state = ?)
             AND (? IS NULL OR id > ?)
           ORDER BY id LIMIT ?`,
          [
            app,
            app,
            input.state ?? null,
            input.state ?? null,
            after.value,
            after.value,
            limit + 1,
          ],
        );
        const page = rows.slice(0, limit);
        return ok({
          tickets: page.map((row) => ({
            id: String(row.id),
            app: String(row.app),
            title: ticketTitleOf(String(row.goal)),
            state: String(row.state) as TicketState,
          })),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rows.length > limit
            ? nextCursor(String(page[page.length - 1]!.id), snapshot.as_of_seq)
            : null,
        });
      },
    },
    show: {
      route: ticketShow,
      handle(snapshot, ctx, input) {
        const row = snapshot.sql.get(
          `SELECT id, app, state, goal, acceptance_check, completion_seq, revision
           FROM tickets WHERE id = ?`,
          [input.ticket],
        );
        if (row === undefined) return notFound("ticket not found");
        const scope = checkApp(snapshot.port, ctx, String(row.app));
        if (!scope.ok) return scope;
        const ticket = String(row.id);
        const seq = row.completion_seq === null
          ? null
          : String(row.completion_seq);
        const claim = snapshot.sql.get(
          "SELECT session, claim_seq, expires_at FROM ticket_claims WHERE ticket = ?",
          [ticket],
        );
        const completion = seq === null ? undefined : snapshot.sql.get(
          `SELECT release, summary_hash, verifications
           FROM ticket_completions WHERE ticket = ? AND seq = ?`,
          [ticket, seq],
        );
        const checked = seq === null ? undefined : snapshot.sql.get(
          `SELECT result, reason, verification FROM ticket_check_results
           WHERE ticket = ? AND completion_seq = ?`,
          [ticket, seq],
        );
        const verdict = seq === null ? undefined : snapshot.sql.get(
          `SELECT result, note FROM ticket_verdicts
           WHERE ticket = ? AND completion_seq = ?`,
          [ticket, seq],
        );
        return ok({
          ticket: {
            id: ticket,
            app: String(row.app),
            state: String(row.state) as TicketState,
            goal: String(row.goal),
            check: json<AcceptanceCheck>(row.acceptance_check),
            evidence: evidenceOf(snapshot, ticket),
            claim: claim === undefined ? null : {
              session: String(claim.session),
              claim_seq: String(claim.claim_seq),
              expires_at: String(claim.expires_at),
            },
            completion: completion === undefined || seq === null ? null : {
              completion_seq: seq,
              release: String(completion.release),
              summary_hash: String(completion.summary_hash),
              verifications: list(completion.verifications),
            },
            check_result: checked === undefined || seq === null ? null : {
              completion_seq: seq,
              result: String(checked.result),
              reason: String(checked.reason),
              verification: checked.verification === null
                ? null
                : String(checked.verification),
            },
            verdict: verdict === undefined || seq === null ? null : {
              completion_seq: seq,
              result: String(verdict.result),
              note: verdict.note === null ? null : String(verdict.note),
            },
            revision: String(row.revision),
          },
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        } as never);
      },
    },
    claim_sweep: {
      route: claimSweep,
      handle(snapshot, _ctx, input): Result<{
        claims: { ticket: string; claim_seq: string }[];
        as_of_seq: string;
        next_cursor: null;
      }> {
        return ok({
          claims: expiredClaims(snapshot.sql, input.now),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}

// 근거. annotation은 값을 풀고, 지워졌거나 못 읽으면 값이 null이다.
function evidenceOf(
  snapshot: ReadSnapshot,
  ticket: string,
): TicketEvidenceRead[] {
  const rows = snapshot.sql.all(
    "SELECT kind, target FROM ticket_references WHERE ticket = ? ORDER BY position",
    [ticket],
  );
  return rows.map((row): TicketEvidenceRead => {
    const kind = String(row.kind);
    const target = String(row.target);
    if (kind === "annotation") {
      return {
        kind,
        id: target,
        annotation: annotationOf(snapshot, target),
      } as TicketEvidenceRead;
    }
    return (kind === "file"
      ? { kind, path: target }
      : { kind, id: target }) as TicketEvidenceRead;
  });
}

function annotationOf(snapshot: ReadSnapshot, id: string) {
  try {
    const found = snapshot.port(TicketAnnotationLookup).byIds([id as never]);
    return found.ok ? found.value.find((item) => item.id === id) ?? null : null;
  } catch {
    return null;
  }
}
