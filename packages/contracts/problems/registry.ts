import {
  getTestRequest,
  getVerification,
  listVerifications,
  recordVerification,
  requestTest,
  verificationRecorded,
} from "./tests.ts";

export const ROUTES = [
  requestTest,
  recordVerification,
  getTestRequest,
  getVerification,
  listVerifications,
] as const;
export const EVENTS = [verificationRecorded] as const;
