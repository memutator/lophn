import type { ProblemsPart } from "../register.ts";
import { DOMAIN_PROBLEMS_SCHEMA_STEPS } from "./schema.ts";
import { syncDomainProblemsCommand } from "./commands.ts";
import { domainProblemListRead } from "./reads.ts";

export const domainProblemsPart = {
  schema: DOMAIN_PROBLEMS_SCHEMA_STEPS,
  commands: [syncDomainProblemsCommand],
  reads: [domainProblemListRead],
  readerReads: [domainProblemListRead],
} satisfies ProblemsPart;
