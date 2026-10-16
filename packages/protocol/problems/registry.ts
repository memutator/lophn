import {
  getTestRequest,
  getVerification,
  listVerifications,
  observeTestRequest,
  recordVerification,
  requestTest,
  stageTestEvidence,
  startTestSide,
  verificationRecorded,
} from "./tests.ts";
import { reportBody } from "./report-body.ts";

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
  applyProblemDecision,
  closeProblemVerified,
  problemClosed,
  problemConfirmationRecorded,
  problemReopened,
} from "./closing.ts";

import { problemReport, recordProblemReport } from "./problem-report.ts";
import {
  problemGet,
  problemGetOccurrence,
  problemList,
  problemMore,
  problemSetState,
} from "./problem-views.ts";
import { problemSubmitFeedback } from "./problem-feedback.ts";

export const PROBLEM_ROUTES = [
  problemReport,
  recordProblemReport,
  problemList,
  problemGet,
  problemGetOccurrence,
  problemMore,
  problemSetState,
  problemSubmitFeedback,
] as const;
export const ROUTES = [
  reportProblem,
  observeException,
  observeViewError,
  recordReport,
  requestTest,
  recordVerification,
  observeTestRequest,
  startTestSide,
  stageTestEvidence,
  getTestRequest,
  getVerification,
  listVerifications,
  reconcileProblemWork,
  linkProblemInterpretation,
  closeProblemVerified,
  applyProblemDecision,
  listProblems,
  getProblem,
  listReports,
  getReport,
  getSnapshot,
  getSnapshotLogs,
  reportBody,
  ...PROBLEM_ROUTES,
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
  problemClosed,
  problemReopened,
  problemConfirmationRecorded,
] as const;
