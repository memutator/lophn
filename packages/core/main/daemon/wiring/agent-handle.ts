import { agentHandleStep } from "../../../lophn-agent/agents/handle-step.ts";
import type { WiringFactory } from "./context.ts";

// agent 정의 파일에 handle을 채우는 data step을 낸다. 정의를 schema로 읽는 다른 data step보다 앞서 돈다.
export const agentHandleWiring: WiringFactory = () => ({
  name: "agent-handle",
  dataSteps: [agentHandleStep],
});
