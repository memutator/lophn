// problems test 요청의 제품 tx port다. 접수 준비는 같은 transaction에서 읽은 앱·release 사실로 만들고,
// 결과 근거는 runner가 RecordVerification 앞에 남긴 기록을 읽는다. 하네스가 값을 밀어 넣는 길이 아니다.
import type {
  Input,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import {
  AppTestVerificationLookupPort,
  type requestTest,
} from "../../../protocol/problems/mod.ts";
import { findAppTestVerification } from "./app-test-lookup.ts";
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
import { canonicalHash } from "./canonical.ts";
import type { HarnessExample } from "./harness/driver.ts";
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

// 보고된 ticket의 현재 examples check와 보고 release가 요청의 연결과 맞는지 같은 tx에서 본다.
// 맞으면 core가 읽은 예시를 돌려주고, 어긋나면 null이다. 예시는 요청자가 보낸 값이 아니다.
function examplesOf(
  tx: Tx,
  input: Input<typeof requestTest>,
): HarnessExample[] | null {
  const link = input.ticket;
  if (link === null || link.check_index !== 0) return null;
  const ticket = read(
    tx,
    `select app, state, completion_seq, acceptance_check from tickets where id = ?`,
    [link.ticket],
  );
  if (
    !ticket || ticket.app !== input.app || ticket.state !== "reported" ||
    ticket.completion_seq !== link.completion_seq
  ) return null;
  const completion = read(
    tx,
    `select release from ticket_completions where ticket = ? and seq = ?`,
    [link.ticket, link.completion_seq],
  );
  const release = completion && read(
    tx,
    `select app, bundle_hash from releases where id = ?`,
    [String(completion.release)],
  );
  if (
    !completion || !release || release.app !== input.app ||
    release.bundle_hash !== input.target.bundle_hash ||
    (input.target.release !== null &&
      input.target.release !== completion.release)
  ) return null;
  const check = JSON.parse(String(ticket.acceptance_check));
  return check.kind === "examples" && canonicalHash(check) === link.check_hash
    ? check.steps
    : null;
}

export function admission(
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
    let examples: HarnessExample[] | undefined;
    // app test가 release를 가리키면 그 release는 이 앱의 것이고 대상 bundle과 같아야 한다.
    if (input.kind === "app_test" && registered && input.target.release) {
      const row = read(
        tx,
        `select app, bundle_hash from releases where id = ?`,
        [input.target.release],
      );
      refsOk = Boolean(
        row && row.app === input.app &&
          row.bundle_hash === input.target.bundle_hash,
      );
    }
    if (input.kind === "examples" && registered) {
      examples = examplesOf(tx, input) ?? undefined;
      refsOk = examples !== undefined;
    }
    return productAdmission(ctx, input, {
      runner_principal: TEST_RUNNER_PRINCIPAL,
      app_registered: registered,
      refs_ok: refsOk,
      ...(examples === undefined ? {} : { examples }),
    });
  };
}

export function testTxPorts(): TxPortRegistration[] {
  return [
    defineTxPort(testAdmissionPort, admission),
    // release 준비는 같은 bundle hash의 통과한 app test를 같은 transaction에서 다시 확인한다.
    defineTxPort(
      AppTestVerificationLookupPort,
      (tx) => (verification: string) =>
        findAppTestVerification(tx.sql, verification),
    ),
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
