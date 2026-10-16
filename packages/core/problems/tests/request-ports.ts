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
    return productAdmission(ctx, input, {
      runner_principal: TEST_RUNNER_PRINCIPAL,
      app_registered: registered,
      refs_ok: refsOk,
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
