import { assignmentSetCommand } from "./commands.ts";
import { assignmentGetRead } from "./reads.ts";
import { ASSIGNMENT_SCHEMA_STEPS } from "./schema.ts";

export const assignmentRegistration = {
  schemaSteps: ASSIGNMENT_SCHEMA_STEPS,
  commands: [assignmentSetCommand],
  reads: [assignmentGetRead],
};
