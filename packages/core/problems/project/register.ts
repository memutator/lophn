import type { ProblemsPart } from "../register.ts";
import { PROJECT_PROBLEMS_SCHEMA_STEPS } from "./schema.ts";
import { syncProjectProblemsCommand } from "./commands.ts";
import { projectProblemListRead } from "./reads.ts";

export const projectProblemsPart = {
  schema: PROJECT_PROBLEMS_SCHEMA_STEPS,
  commands: [syncProjectProblemsCommand],
  reads: [projectProblemListRead],
  readerReads: [projectProblemListRead],
} satisfies ProblemsPart;
