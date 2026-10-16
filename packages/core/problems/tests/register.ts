import type { ProblemsPart } from "../register.ts";
import { workerRoot } from "../worker-root.ts";
import type { KindLaunchSpec } from "../../../protocol/supervision/mod.ts";
import {
  getTestRequestRead,
  getVerificationRead,
  listVerificationsRead,
  observeTestRequestCommand,
  recordVerificationCommand,
  requestTestCommand,
  stageTestEvidenceCommand,
  startTestSideCommand,
  TEST_BLOB_FIELDS,
  TEST_BLOB_PURPOSES,
  TEST_SCHEMA_STEPS,
  verificationRecordedVisibility,
} from "./mod.ts";
import { testRunnerSpec } from "./runner.ts";
import { testTxPorts } from "./request-ports.ts";
import { verificationRecorded } from "../../../protocol/problems/mod.ts";

// 등록 시점 env에서 data root와 Deno 실행 파일을 좁힌다. 없으면 spec을 내지 않는다.
function testRunnerWorkers(): KindLaunchSpec[] {
  const root = workerRoot();
  if (!root) return [];
  const spec = testRunnerSpec({ dataRoot: root, deno: Deno.execPath() });
  return spec ? [spec] : [];
}

export const testsPart = {
  schema: TEST_SCHEMA_STEPS,
  blobFields: TEST_BLOB_FIELDS,
  blobPurposes: TEST_BLOB_PURPOSES,
  // 접수·결과 기록과, runner가 요청별 좁은 machine credential로만 부르는 lifecycle command다.
  commands: [
    requestTestCommand,
    recordVerificationCommand,
    observeTestRequestCommand,
    startTestSideCommand,
    stageTestEvidenceCommand,
  ],
  reads: [getTestRequestRead, getVerificationRead, listVerificationsRead],
  events: [verificationRecorded],
  visibility: [verificationRecordedVisibility],
  ports: testTxPorts(),
  workers: testRunnerWorkers(),
  readerReads: [getTestRequestRead, getVerificationRead, listVerificationsRead],
} satisfies ProblemsPart;
