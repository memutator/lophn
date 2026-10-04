import { err, ok, type Result } from "../../base/mod.ts";
import {
  type ExecutionEvidence,
  executionEvidenceListSchema,
  frozenTestSchema,
  type TestResult,
  type Verification,
} from "../../contracts/problems/mod.ts";
import type {
  PreparedResultEvidence,
  StoredSideStart,
  TestConnection,
} from "./model.ts";

const INVALID = "테스트 요청이 올바르지 않다";
const FORBIDDEN = "이 credential로는 할 수 없다";
const CONFLICT = "같은 요청의 내용이 다르다";
const INCONCLUSIVE_ONLY = "이 종료는 inconclusive만 기록할 수 있다";

const INCONCLUSIVE_REASONS = new Set(["timeout", "killed", "runner_lost"]);

export function expectedBundle(
  connection: TestConnection,
  side: ExecutionEvidence["side"],
  beforeBundle: string | null,
): Result<string> {
  if (connection.kind !== "reproduction" || side !== "before") {
    return ok(connection.target.bundle_hash);
  }
  if (!beforeBundle) return err({ code: "forbidden", message: FORBIDDEN });
  return ok(beforeBundle);
}

function kindShape(
  verification: Verification,
  evidence: PreparedResultEvidence,
): boolean {
  const frozen = evidence.frozen;
  if (verification.kind === "app_test") {
    return frozen.blueprint !== null && frozen.symptom === null;
  }
  if (verification.kind === "reproduction") {
    return frozen.symptom !== null && frozen.blueprint === null;
  }
  return frozen.blueprint === null && frozen.symptom === null &&
    frozen.failure_paths === null;
}

export function judgeRecordable(
  verification: Verification,
  evidence: PreparedResultEvidence,
  stored: readonly StoredSideStart[],
): Result<TestResult> {
  const frozen = frozenTestSchema.safeParse(evidence.frozen);
  const execution = executionEvidenceListSchema.safeParse(
    evidence.execution_evidence,
  );
  if (!kindShape(verification, evidence)) {
    return err({ code: "conflict", message: CONFLICT });
  }
  if (!frozen.success || !execution.success) {
    return err({ code: "invalid_input", message: INVALID });
  }
  const started = execution.data.filter((item) =>
    item.end_reason !== "start_failed"
  );
  if (
    !evidence.actually_started || started.length === 0 || stored.length === 0 ||
    execution.data.some((item) => item.end_reason === "start_failed")
  ) {
    return err({ code: "invalid_input", message: "실제 시작이 없다" });
  }
  const mismatched = started.length !== stored.length ||
    started.some((item) => {
      const observed = stored.find((side) => side.side === item.side);
      return !observed || observed.started_at !== item.started_at ||
        observed.test_hash !== item.test_hash ||
        observed.test_hash !== verification.test ||
        observed.bundle_hash !== item.bundle_hash ||
        observed.request_hash !== verification.request_hash;
    });
  if (mismatched) return err({ code: "conflict", message: CONFLICT });
  const oneSide = verification.kind === "reproduction" &&
    (!stored.some((item) => item.side === "before") ||
      !stored.some((item) => item.side === "after"));
  if (
    oneSide &&
    (!evidence.unstarted_reason || !evidence.unstarted_side ||
      stored.some((item) => item.side === evidence.unstarted_side))
  ) {
    return err({ code: "invalid_input", message: INCONCLUSIVE_ONLY });
  }
  const exitMismatch = verification.kind === "test_command" &&
    started.some((item) =>
      item.end_reason === "exited" &&
      item.exit_code !== evidence.frozen.method.expected_exit_code
    );
  if (exitMismatch && verification.result === "pass") {
    return err({ code: "invalid_input", message: INCONCLUSIVE_ONLY });
  }
  const forced =
    started.some((item) => INCONCLUSIVE_REASONS.has(item.end_reason)) ||
    !evidence.evidence_sufficient || oneSide;
  if (forced && verification.result !== "inconclusive") {
    return err({ code: "invalid_input", message: INCONCLUSIVE_ONLY });
  }
  return ok(verification.result);
}
