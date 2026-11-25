import { agentAvatarStep } from "../../../lophn-agent/agents/avatar-step.ts";
import { agentHandleStep } from "../../../lophn-agent/agents/handle-step.ts";
import { agentPermissionModeStep } from "../../../lophn-agent/agents/mod.ts";
import { agentRuntimeCustomStep } from "../../../lophn-agent/agents/runtime-custom-step.ts";
import { agentToolsNoCommandsStep } from "../../../lophn-agent/agents/tools-no-commands-step.ts";
import type { WiringFactory } from "./context.ts";

// agent 정의 파일의 옛 모양을 고치는 data step을 낸다. 정의를 schema로 읽는 다른 data step보다 앞서 돈다.
// handle 채우기가 먼저, runtime `bare`를 `custom`으로 옮기는 step, `tools`에서 명령 이름을 빼는 step, `profile` 칸을 `avatar`로 옮기는 step, `skip`을 `permission_mode`로 옮기는 step이 그 뒤다.
export const agentHandleWiring: WiringFactory = () => ({
  name: "agent-handle",
  dataSteps: [
    agentHandleStep,
    agentRuntimeCustomStep,
    agentToolsNoCommandsStep,
    agentAvatarStep,
    agentPermissionModeStep,
  ],
});
