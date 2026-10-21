import { agentAssignmentSetCommand } from "./commands.ts";
import { agentAssignmentGetRead } from "./reads.ts";
import { ASSIGNMENT_SCHEMA_STEPS } from "./schema.ts";

export const assignmentRegistration = {
  schemaSteps: ASSIGNMENT_SCHEMA_STEPS,
  commands: [agentAssignmentSetCommand],
  reads: [agentAssignmentGetRead],
};
