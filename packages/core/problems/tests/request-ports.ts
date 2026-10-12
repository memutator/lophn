// problems test 요청의 제품 tx port다. 접수 준비는 같은 transaction에서 읽은 앱·참조·
// release 사실로 만들고, 결과 근거는 runner가 RecordVerification 앞에 남긴 기록을 읽는다. 하네스가 값을 밀어
// 넣는 길이 아니다.
import type {
  Input,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { TicketClaimCheck } from "../../../protocol/coding-agent/mod.ts";
import type { requestTest } from "../../../protocol/problems/mod.ts";
import {
  defineTxPort,
  type TxPortRegistration,
} from "../../storage/ledger/mod.ts";
import {
  type PreparedAdmission,
  productAdmission,
  stagedEvidence,
  TEST_RUNNER_PRINCIPAL,
  testAdmissionPort,
  testEvidencePort,
} from "./mod.ts";
import { lookupAppRegistration } from "../../apps/registration/mod.ts";

type Row = Record<string, unknown> | undefined;

// 다른 owner의 표가 아직 없는 조립(그 팀을 등록하지 않은 core)에서는 사실을 못 읽는다. 없는 사실로 본다.
function read(tx: Tx, sql: string, params: (string | null)[]): Row {
  try {
    return tx.sql.get(sql, params);
  } catch {
    return undefined;
  }
}

// coding agent의 reproduction 요청은 그 연결이 지금 쥔 repair ticket의 claim에 기대야 한다(coding-agent/mcp-server#R25,
// cli#R34). 그 ticket은 이 앱의 repair ticket이고 이 문제를 담아야 한다. 도구가 먼저 거르는 것과 별개로 core가
// 접수 때 다시 확인한다: 도구를 거치지 않는 요청도 같은 거절이다. 사람·machine 요청과 다른 종류는 이 규칙이 없다.
// 이유를 돌려주면 접수하지 않는다(conflict).
export function reproductionClaimRejection(
  tx: Pick<Tx, "port" | "now" | "sql">,
  ctx: Pick<RequestContext, "actor">,
  input: Input<typeof requestTest>,
): string | undefined {
  const actor = parseActor(ctx.actor);
  if (input.kind !== "reproduction" || actor?.kind !== "coding_agent") {
    return undefined;
  }
  const source = input.ticket_source;
  if (source === undefined) {
    return "reproduction 요청은 현재 claim의 ticket_source를 실어야 한다";
  }
  let checked;
  try {
    checked = tx.port(TicketClaimCheck)({
      ticket: source.ticket,
      claim_seq: source.claim_seq,
      connection: actor.id,
      now: tx.now(),
    });
  } catch {
    return "claim을 확인할 수 없다";
  }
  if (!checked.ok) return "claim을 확인할 수 없다";
  if (!checked.value.ok) return checked.value.reason;
  // 다른 앱의 ticket은 없는 ticket과 같은 거절이다.
  if (checked.value.app !== input.app) return "missing";
  const ticket = read(
    tx as Tx,
    `select 1 as hit from tickets t
     join ticket_problems item on item.ticket = t.id
     where t.id = ? and t.app = ? and t.kind = 'repair' and item.problem = ?`,
    [source.ticket, input.app, input.problem],
  );
  return ticket === undefined
    ? "ticket은 이 문제의 repair ticket이 아니다"
    : undefined;
}

function admission(
  tx: Tx,
): (
  ctx: RequestContext,
  input: Input<typeof requestTest>,
) => PreparedAdmission | null {
  return (ctx, input) => {
    let registered = false;
    try {
      const app = lookupAppRegistration(tx.sql, input.app);
      registered = app.ok && app.value !== null;
    } catch { /* apps 표가 없는 조립이다 */ }
    let refsOk = registered;
    let before: { release: string; bundle_hash: string } | null = null;
    const release = (id: string | null) =>
      id === null
        ? undefined
        : read(tx, `select app, bundle_hash from releases where id = ?`, [id]);
    if (input.kind === "reproduction" && registered) {
      const beforeRow = release(input.before);
      const afterRow = release(input.after);
      const problem = input.problem === null ? undefined : read(
        tx,
        `select app from problems where id = ?`,
        [input.problem],
      );
      const reports = input.reports.map((id) =>
        read(tx, `select app, problem from reports where id = ?`, [id])
      );
      before = beforeRow && input.before
        ? { release: input.before, bundle_hash: String(beforeRow.bundle_hash) }
        : null;
      refsOk = Boolean(
        beforeRow && afterRow && problem && before &&
          beforeRow.app === input.app && afterRow.app === input.app &&
          problem.app === input.app &&
          input.target.release === input.after &&
          afterRow.bundle_hash === input.target.bundle_hash &&
          reports.every((row) =>
            row !== undefined && row.app === input.app &&
            row.problem === input.problem
          ),
      );
    } else if (
      input.kind === "app_test" && registered && input.target.release
    ) {
      const row = release(input.target.release);
      refsOk = Boolean(
        row && row.app === input.app &&
          row.bundle_hash === input.target.bundle_hash,
      );
    }
    return productAdmission(ctx, input, {
      runner_principal: TEST_RUNNER_PRINCIPAL,
      app_registered: registered,
      refs_ok: refsOk,
      before_target: before,
      ...claimFacts(tx, ctx, input),
    });
  };
}

function claimFacts(
  tx: Tx,
  ctx: RequestContext,
  input: Input<typeof requestTest>,
): { claim_rejected?: string } {
  const rejected = reproductionClaimRejection(tx, ctx, input);
  return rejected === undefined ? {} : { claim_rejected: rejected };
}

export function testTxPorts(): TxPortRegistration[] {
  return [
    defineTxPort(testAdmissionPort, admission),
    defineTxPort(
      testEvidencePort,
      (tx) => (input) =>
        stagedEvidence(
          tx.sql,
          input.verification,
          input.verification.request_principal,
          input.verification.request_key,
        ),
    ),
  ];
}
