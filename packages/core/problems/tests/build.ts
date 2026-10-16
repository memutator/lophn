// runner가 실제로 돌린 뒤(또는 이어받아 runner_lost로 닫을 때) Verification과 그 근거를 만든다.
// 모든 hash는 이 함수가 만든 canonical JSON의 sha256이고, 영구 등록할 blob의 bytes도 같이 낸다: 저장하지 않을
// blob의 hash를 적지 않는다. 판정은 이 함수가 하지 않는다 — 부르는 쪽이 정한 result·reason을 그대로 싣는다.
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  ExecutionEvidence,
  FrozenTest,
  TestResult,
  Verification,
} from "../../../protocol/problems/mod.ts";
import { requiredBlobs } from "./blobs.ts";
import { canonicalHash, canonicalJson } from "./canonical.ts";
import {
  parseVerification,
  type PreparedResultEvidence,
  type TestConnection,
} from "./model.ts";

type RecordFacts = {
  id: string;
  request_principal: string;
  request_key: string;
  request_hash: string;
  runner_principal: string;
  // 접수한 요청의 연결(kind·app·target·test 등). 접수 기록의 payload다.
  connection: TestConnection;
  frozen: FrozenTest;
  executions: ExecutionEvidence[];
  observations: unknown;
  result: TestResult;
  reason: string;
  // 실제로 끝까지 관측했는가. 아니면 judge가 inconclusive만 받는다.
  sufficient: boolean;
};

type BuiltRecord = {
  verification: Verification;
  evidence: PreparedResultEvidence;
  required: ReturnType<typeof requiredBlobs>;
  // Verification이 직접 가리키는 blob(test·execution·observations)의 bytes.
  contents: ReadonlyMap<string, Uint8Array>;
};

const encode = (text: string) => new TextEncoder().encode(text);

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

// 한 요청의 Verification은 하나뿐이다. 요청(주체·key·hash)에서 정한 ID를 쓰면 결과를 남기다 끊겨 다시 이어받아도
// 같은 결과(같은 canonical)라 근거를 새로 만들지 않는다. 요청 hash는 key를 싣지 않으므로 같은 내용의 요청이
// 여럿이어도 key가 ID를 가른다.
export function verificationIdFor(
  requestPrincipal: string,
  requestKey: string,
  requestHash: string,
): string {
  const digest = createHash("sha256").update(
    `vrf:${requestPrincipal}\u0000${requestKey}\u0000${requestHash}`,
    "utf8",
  ).digest();
  let body = "0";
  for (let index = 0; index < 25; index++) {
    body += CROCKFORD[digest[index] % 32];
  }
  return `vrf_${body}`;
}

export function buildRecord(facts: RecordFacts): Result<BuiltRecord> {
  try {
    const test = canonicalHash(facts.frozen);
    const execution = canonicalHash(facts.executions);
    const observations = canonicalHash(facts.observations);
    const connection = facts.connection;
    const parsed = parseVerification({
      id: facts.id,
      request_key: facts.request_key,
      request_principal: facts.request_principal,
      request_hash: facts.request_hash,
      kind: connection.kind,
      app: connection.app,
      target: connection.target,
      problem: connection.problem,
      basis_seq: connection.basis_seq,
      reports: connection.reports,
      before: connection.before,
      after: connection.after,
      ticket: connection.ticket,
      test,
      execution,
      result: facts.result,
      reason: facts.reason,
      observations,
    });
    if (!parsed.ok) return parsed;
    const verification = parsed.value;
    const evidence: PreparedResultEvidence = {
      request_principal: facts.request_principal,
      request_key: facts.request_key,
      request_hash: facts.request_hash,
      runner_principal: facts.runner_principal,
      verification_canonical: canonicalJson(verification),
      observations_json: facts.observations,
      test,
      execution,
      observations,
      frozen: facts.frozen,
      execution_evidence: facts.executions,
      actually_started: facts.executions.some((item) =>
        item.end_reason !== "start_failed"
      ),
      evidence_sufficient: facts.sufficient,
    };
    return ok({
      verification,
      evidence,
      required: requiredBlobs(verification, evidence),
      contents: new Map([
        [test, encode(canonicalJson(facts.frozen))],
        [execution, encode(canonicalJson(facts.executions))],
        [observations, encode(canonicalJson(facts.observations))],
      ]),
    });
  } catch {
    return err({
      code: "invalid_input",
      message: "결과 근거를 만들 수 없다",
    });
  }
}
