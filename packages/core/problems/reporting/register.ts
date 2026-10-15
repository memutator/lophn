import type { ProblemsPart } from "../register.ts";
import { recordReportCommand } from "./commands.ts";
import { getReportRead, getSnapshotRead, listReportsRead } from "./reads.ts";
import { REPORTS_SCHEMA_STEPS } from "./schema.ts";

export const reportingPart = {
  schema: REPORTS_SCHEMA_STEPS,
  commands: [recordReportCommand],
  reads: [listReportsRead, getReportRead],
  readerReads: [listReportsRead, getReportRead, getSnapshotRead],
} satisfies ProblemsPart;
