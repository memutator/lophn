import { SETTINGS_SCHEMA_STEPS } from "../../../config/mod.ts";
import type { WiringFactory } from "./context.ts";

export const configWiring: WiringFactory = () => ({
  name: "config",
  schemaStepsAfterTeams: SETTINGS_SCHEMA_STEPS,
});
