import { createSkillsOffStep } from "../../../lophn-agent/agents/skills-off-step.ts";
import { BUNDLED_SKILLS_ROOT } from "../../../agent-workspaces/skills/root.ts";
import type { WiringFactory } from "./context.ts";

// agent 정의 파일의 옛 `skills`를 `skills_off`로 옮기는 data step을 낸다.
export const createSkillsOffWiring: WiringFactory = () => ({
  name: "skills-off",
  dataSteps: [createSkillsOffStep(BUNDLED_SKILLS_ROOT)],
});
