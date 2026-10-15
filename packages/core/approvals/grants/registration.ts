import { agentGrantsSetCommand } from "./commands.ts";
import { agentGrantsGetRead } from "./reads.ts";
import { AGENT_GRANT_SCHEMA_STEPS } from "./schema.ts";

// approvals-requests가 approvals registration에 합친다.
export const agentGrantRegistration = {
  schemaSteps: AGENT_GRANT_SCHEMA_STEPS,
  commands: [agentGrantsSetCommand],
  reads: [agentGrantsGetRead],
};
