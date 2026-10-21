import {
  getTestRequest,
  getVerification,
  listVerifications,
  observeTestRequest,
  recordVerification,
  requestTest,
  stageTestEvidence,
  startTestSide,
} from "./tests.ts";

export const ROUTES = [
  requestTest,
  recordVerification,
  observeTestRequest,
  startTestSide,
  stageTestEvidence,
  getTestRequest,
  getVerification,
  listVerifications,
] as const;
