import { definePort } from "../../../protocol/base/ports.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";

// session이 어느 agent인지. session 표는 lophn-agent의 것이라 approvals는 이 port로만 묻고, 구현은 lophn-agent가 낸다.
export type AgentOfSession = { agentOf(session: string): AgentRef | undefined };
export const AgentOfSession = definePort<AgentOfSession>("AgentOfSession");
