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
  observeViewError,
  problemObserved,
  problemOpened,
  recordReport,
  reportProblem,
  reportRecorded,
} from "./reports.ts";
import { snapshotRecorded } from "./snapshots.ts";
import { submitFeedback } from "./feedback.ts";
import {
  getProblem,
  linkProblemInterpretation,
  listProblems,
  problemInterpretationLinked,
  problemWorkEnded,
  problemWorkStarted,
  reconcileProblemWork,
} from "./problems.ts";
import {
  getReport,
  getSnapshot,
  getSnapshotLogs,
  listReports,
} from "./problem-reads.ts";
import {
  listProblemFixes,
  problemFixRecorded,
  recordProblemFix,
} from "./fixes.ts";
import {
  applyProblemDecision,
  closeProblemVerified,
  problemClosed,
  problemConfirmationRecorded,
  problemReopened,
} from "./closing.ts";

export const ROUTES = [
  reportProblem,
  observeException,
  observeViewError,
  submitFeedback,
  recordReport,
  requestTest,
  recordVerification,
  getTestRequest,
  getVerification,
  listVerifications,
  reconcileProblemWork,
  linkProblemInterpretation,
  recordProblemFix,
  closeProblemVerified,
  applyProblemDecision,
  listProblems,
  getProblem,
  listReports,
  getReport,
  getSnapshot,
  getSnapshotLogs,
  listProblemFixes,
] as const;
export const EVENTS = [
  verificationRecorded,
  reportRecorded,
  snapshotRecorded,
  problemOpened,
  problemObserved,
  problemWorkStarted,
  problemWorkEnded,
  problemInterpretationLinked,
  problemFixRecorded,
  problemClosed,
  problemReopened,
  problemConfirmationRecorded,
] as const;
