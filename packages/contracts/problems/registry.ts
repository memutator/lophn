import {
  getTestRequest,
  getVerification,
  listVerifications,
  recordVerification,
  requestTest,
  verificationRecorded,
} from "./tests.ts";

import {
  observeException,
  problemObserved,
  problemOpened,
  recordReport,
  reportProblem,
  reportRecorded,
} from "./reports.ts";
import { snapshotRecorded } from "./snapshots.ts";
import { submitFeedback } from "./feedback.ts";

export const ROUTES = [
  reportProblem,
  observeException,
  submitFeedback,
  recordReport,
  requestTest,
  recordVerification,
  getTestRequest,
  getVerification,
  listVerifications,
] as const;
export const EVENTS = [
  verificationRecorded,
  reportRecorded,
  snapshotRecorded,
  problemOpened,
  problemObserved,
] as const;
