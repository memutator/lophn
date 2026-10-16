import type { ProblemsPart } from "../register.ts";
import { recordProblemReportCommand } from "./commands.ts";
import { REPORTS_SCHEMA_STEPS } from "./schema.ts";

export const reportingPart = {
  schema: REPORTS_SCHEMA_STEPS,
  commands: [recordProblemReportCommand],
} satisfies ProblemsPart;
