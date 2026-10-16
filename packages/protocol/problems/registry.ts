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
import { reportBody } from "./report-body.ts";

import {
  observeException,
  observeViewError,
  recordReport,
  reportProblem,
} from "./reports.ts";
import {
  getProblem,
  linkProblemInterpretation,
  listProblems,
} from "./problems.ts";
import {
  getReport,
  getSnapshot,
  getSnapshotLogs,
  listReports,
} from "./problem-reads.ts";
import { applyProblemDecision } from "./closing.ts";

import { problemReport, recordProblemReport } from "./problem-report.ts";
import {
  problemGet,
  problemGetOccurrence,
  problemList,
  problemMore,
  problemSetState,
} from "./problem-views.ts";
import { problemSubmitFeedback } from "./problem-feedback.ts";

const PROBLEM_ROUTES = [
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
  linkProblemInterpretation,
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
