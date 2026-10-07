// test runner가 요청 기록을 잇는 owner command와 제품 접수·결과 근거 port(problems/tests#R4, R5, R17, R21).
// runner는 요청별 좁은 machine credential로만 이 command를 부른다. 시작 시도는 한 요청에 한 번만 확정한다:
// 두 번째 시작 시도는 누구의 것이든 conflict라 같은 요청은 다시 시작하지 않는다(R17).
import { err, ok, type Result } from "../../base/mod.ts";
import type {
  CommandDefinition,
  Input,
  RequestContext,
  Sql,
  Tx,
} from "../../contracts/platform/mod.ts";
import { TargetAuthorization } from "../../contracts/platform/mod.ts";
import {
  observeTestRequest,
  type requestTest,
  stageTestEvidence,
  startTestSide,
} from "../../contracts/problems/mod.ts";
import { canonicalJson, hashCanonical } from "./canonical.ts";
import { appendActualSideStart, appendRequestObservation } from "./commands.ts";
import {
  canonicalRequest,
  checkTestAuthority,
  type PreparedAdmission,
  type PreparedResultEvidence,
  type RequestRecord,
  type SideStart,
  type StoredSideStart,
} from "./model.ts";
import { currentRunner, loadRecords, loadSideStarts } from "./records.ts";
import type { LifecycleProof } from "./proof.ts";

const CONFLICT = "같은 요청의 내용이 다르다";
const NOT_FOUND = "기록을 찾을 수 없다";

export const OBSERVE_TEST_REQUEST_ROUTE = "ObserveTestRequest";
export const START_TEST_SIDE_ROUTE = "StartTestSide";
export const STAGE_TEST_EVIDENCE_ROUTE = "StageTestEvidence";

export const observeTestRequestCommand: CommandDefinition<
  typeof observeTestRequest
> = {
  route: observeTestRequest,
  handle(tx, ctx, input) {
    const observation = input.observation;
    // 한 요청의 시작 시도는 한 번이다. 다시 보내도(재전달 포함) 두 번째 시도를 남기지 않는다.
    if (observation.phase === "start_attempt") {
      const prior = loadRecords(
        tx.sql,
        observation.request_principal,
        observation.request_key,
      ).some((record) => record.phase === "start_attempt");
      if (prior) {
        return err({
          code: "conflict",
          message: "이미 시작을 시도한 요청이다",
        });
      }
    }
    const seq = appendRequestObservation(
      tx,
      ctx,
      observation,
      input.proof as LifecycleProof,
    );
    return seq.ok ? ok({ seq: String(seq.value) }) : seq;
  },
};

export const startTestSideCommand: CommandDefinition<typeof startTestSide> = {
  route: startTestSide,
  handle(tx, ctx, input) {
    const seq = appendActualSideStart(
      tx,
      ctx,
      input.start,
      input.proof as LifecycleProof,
    );
    return seq.ok ? ok({ seq: String(seq.value) }) : seq;
  },
};

// 결과 근거 입력의 모양. 안쪽 값(고정 시험·실행 증거)은 RecordVerification이 schema로 다시 검사한다.
function evidenceOf(
  value: unknown,
): PreparedResultEvidence | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  const text = (key: string) => typeof item[key] === "string";
  const flag = (key: string) => typeof item[key] === "boolean";
  const side = item.unstarted_side;
  if (
    ![
      "request_principal",
      "request_key",
      "request_hash",
      "runner_principal",
      "verification_canonical",
      "test",
      "execution",
      "observations",
    ].every(text) ||
    !flag("actually_started") || !flag("evidence_sufficient") ||
    typeof item.frozen !== "object" || item.frozen === null ||
    !Array.isArray(item.execution_evidence) ||
    !(side === null || side === "before" || side === "after") ||
    !(item.unstarted_reason === null ||
      typeof item.unstarted_reason === "string")
  ) return null;
  return item as unknown as PreparedResultEvidence;
}

export function handleStageTestEvidence(
  tx: Tx,
  ctx: RequestContext,
  input: Input<typeof stageTestEvidence>,
): Result<{ staged: boolean }> {
  const records = loadRecords(
    tx.sql,
    input.request_principal,
    input.request_key,
  );
  const accepted = records.find((record) => record.phase === "accepted");
  if (!accepted) return err({ code: "not_found", message: NOT_FOUND });
  if (accepted.request_hash !== input.request_hash) {
    return err({ code: "conflict", message: CONFLICT });
  }
  const allowed = checkTestAuthority(
    ctx,
    {
      runner_principal: currentRunner(records),
      app: accepted.payload.app,
      request_principal: input.request_principal,
      request_key: input.request_key,
      request_hash: input.request_hash,
    },
    STAGE_TEST_EVIDENCE_ROUTE,
    tx.port(TargetAuthorization),
  );
  if (!allowed.ok) return allowed;
  const evidence = evidenceOf(input.evidence);
  if (
    evidence === null ||
    evidence.request_principal !== input.request_principal ||
    evidence.request_key !== input.request_key ||
    evidence.request_hash !== input.request_hash ||
    evidence.runner_principal !== ctx.principal
  ) {
    return err({
      code: "invalid_input",
      message: "테스트 요청이 올바르지 않다",
    });
  }
  let canonical: string;
  try {
    canonical = canonicalJson(evidence);
  } catch {
    return err({
      code: "invalid_input",
      message: "테스트 요청이 올바르지 않다",
    });
  }
  // 근거는 그것을 남긴 runner마다 하나다. 끊긴 runner가 남긴 근거와 이어받은 runner의 근거가 서로 막지 않는다.
  const prior = tx.sql.get(
    `select evidence from test_evidence
     where request_principal = ? and request_key = ? and runner_principal = ?`,
    [input.request_principal, input.request_key, ctx.principal],
  );
  if (prior) {
    return prior.evidence === canonical
      ? ok({ staged: true })
      : err({ code: "conflict", message: CONFLICT });
  }
  tx.sql.run(
    `insert into test_evidence (
       request_principal, request_key, request_hash, runner_principal, evidence
     ) values (?, ?, ?, ?, ?)`,
    [
      input.request_principal,
      input.request_key,
      input.request_hash,
      ctx.principal,
      canonical,
    ],
  );
  return ok({ staged: true });
}

export const stageTestEvidenceCommand: CommandDefinition<
  typeof stageTestEvidence
> = {
  route: stageTestEvidence,
  handle: handleStageTestEvidence,
};

// RecordVerification이 같은 transaction에서 읽는 결과 근거다. 이 Verification의 canonical을 근거로 남긴 것을 고른다.
// 남기지 않은 요청은 null이라 기록되지 않는다.
export function stagedEvidence(
  sql: Pick<Sql, "all">,
  verification: Parameters<typeof canonicalJson>[0],
  principal: string,
  key: string,
): PreparedResultEvidence | null {
  let canonical: string;
  try {
    canonical = canonicalJson(verification);
  } catch {
    return null;
  }
  const rows = sql.all(
    `select evidence from test_evidence where request_principal = ? and request_key = ?`,
    [principal, key],
  );
  for (const row of rows) {
    try {
      const found = evidenceOf(JSON.parse(String(row.evidence)));
      if (found !== null && found.verification_canonical === canonical) {
        return found;
      }
    } catch { /* 읽을 수 없는 근거는 근거가 아니다 */ }
  }
  return null;
}

// 제품 접수의 준비 값이다. app test와 reproduction만 접수하고 test_command는 준비할 수 없다(unavailable).
// 앱·참조의 존재와 reproduction의 이전 bundle은 조립(core)이 같은 transaction에서 읽은 사실이다. app test의 대상
// bundle·고정 시험의 일치는 runner가 시작 전에 준비 단계에서 확인하고 어긋나면 준비 실패로 이유를 남긴다.
export function productAdmission(
  ctx: Pick<RequestContext, "principal">,
  input: Input<typeof requestTest>,
  facts: {
    runner_principal: string;
    app_registered: boolean;
    refs_ok: boolean;
    before_target: { release: string; bundle_hash: string } | null;
    claim_rejected?: string;
  },
): PreparedAdmission | null {
  const reproduction = input.kind === "reproduction";
  const before = reproduction ? facts.before_target : null;
  const canonical = canonicalRequest({ ...input, before_bundle_hash: null });
  if (!canonical.ok) return null;
  return {
    request_principal: ctx.principal,
    request_key: input.request_key,
    app: input.app,
    request_hash: hashCanonical(canonical.value),
    canonical: canonical.value,
    runner_principal: facts.runner_principal,
    before_bundle_hash: before?.bundle_hash ?? null,
    before_target: before,
    app_in_scope: facts.app_registered,
    refs_ok: facts.refs_ok,
    unavailable: input.kind === "test_command",
    ...(facts.claim_rejected === undefined
      ? {}
      : { claim_rejected: facts.claim_rejected }),
  };
}

// runner가 이어받을 요청의 현재 모습. 끝난 요청(결과·준비 실패·시작 불명)은 나오지 않는다.
export type OpenTestRequest = {
  request_principal: string;
  request_key: string;
  request_hash: string;
  app: string;
  payload: RequestRecord["payload"];
  // 접수가 묶은 runner와 지금 요청에 묶인 runner(recovery 뒤에는 복구 runner).
  accepted_runner: string;
  current_runner: string;
  attempted: boolean;
  recovered: boolean;
  // 첫 recovery를 남긴 시각. 이어받은 요청의 끝 시각 근거다(다시 이어받아도 같은 값이다).
  recovered_at: string | null;
  sides: StoredSideStart[];
};

export function listOpenTestRequests(
  sql: Pick<Sql, "all">,
): OpenTestRequest[] {
  const rows = sql.all(
    `select request_principal, request_key from test_requests
     where phase = 'accepted'
       and not exists (
         select 1 from test_requests done
         where done.request_principal = test_requests.request_principal
           and done.request_key = test_requests.request_key
           and (done.phase in ('result_ref', 'preparation_failed', 'start_unknown'))
       )
     order by seq`,
    [],
  );
  const open: OpenTestRequest[] = [];
  for (const row of rows) {
    const principal = String(row.request_principal);
    const key = String(row.request_key);
    const records = loadRecords(sql, principal, key);
    const accepted = records.find((record) => record.phase === "accepted");
    if (!accepted) continue;
    open.push({
      request_principal: principal,
      request_key: key,
      request_hash: accepted.request_hash,
      app: accepted.payload.app,
      payload: accepted.payload,
      accepted_runner: accepted.runner_principal ?? "",
      current_runner: currentRunner(records),
      attempted: records.some((record) => record.phase === "start_attempt"),
      recovered: records.some((record) => record.phase === "recovery"),
      recovered_at: records.find((record) => record.phase === "recovery")?.at ??
        null,
      sides: loadSideStarts(sql, principal, key, accepted.request_hash),
    });
  }
  return open;
}

export type { SideStart };
