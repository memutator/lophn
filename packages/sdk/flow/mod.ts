import {
  type AgentRequest,
  currentPort,
  type FlowPort,
  type NamedAgent,
  type Outcome,
  type ReportRequest,
  type ToolRequest,
} from "./wire.ts";

export type { AgentRequest, NamedAgent, Outcome, ReportRequest, ToolRequest };

function need(): FlowPort {
  const port = currentPort();
  if (!port) {
    throw new Error(
      "@lophn/flow can only run inside a lophn flow process (entry.ts)",
    );
  }
  return port;
}
const port = need();

export const input: string = port.input;
export const instance: string = port.instance;

// result의 type T는 부르는 쪽의 단언이다. 검사하지 않는다.
export function agent<T = unknown>(args: AgentRequest): Promise<Outcome<T>> {
  return port.request({ type: "agent", ...args }) as Promise<Outcome<T>>;
}

export function tool<T = unknown>(args: ToolRequest): Promise<Outcome<T>> {
  return port.request({ type: "tool", ...args }) as Promise<Outcome<T>>;
}

export function report(args: ReportRequest): Promise<Outcome<null>> {
  return port.request({ type: "report", ...args }) as Promise<Outcome<null>>;
}
