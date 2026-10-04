import {
  getTestRequestRead,
  getVerificationRead,
  listVerificationsRead,
  recordVerificationCommand,
  requestTestCommand,
  TEST_SCHEMA_STEPS,
  testAdmissionPort,
  testEvidencePort,
  verificationRecordedVisibility,
} from "../../packages/problems/tests/mod.ts";

// owner definitions만 내보낸다. port 구현과 writer 조립은 core가 맡는다.
export const problemsTestDefinitions = {
  schema: TEST_SCHEMA_STEPS,
  commands: [requestTestCommand, recordVerificationCommand],
  reads: [getTestRequestRead, getVerificationRead, listVerificationsRead],
  visibility: [verificationRecordedVisibility],
  ports: { admission: testAdmissionPort, evidence: testEvidencePort },
};
