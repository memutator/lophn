import {
  agentCallSend,
  agentCallSendable,
  callCancel,
  callReply,
} from "../../../../protocol/lophn-agent/calls.ts";
import { commandOf, type CoreCall, readOf } from "../../run-loop/core-call.ts";
import type { CallRouting } from "../../ports.ts";

// call, reply, cancel, session.list tool이 Router를 부르는 길이다. agent 자격의 core loopback으로 calls.* route를
// 부른다.
export function routerOverCore(core: CoreCall): CallRouting {
  const key = () => crypto.randomUUID();
  return {
    send: (input) => commandOf(core, agentCallSend, input, {}, key()),
    reply: (input) => commandOf(core, callReply, input, {}, key()),
    cancel: (input) => commandOf(core, callCancel, input, {}, key()),
    sendable: () => readOf(core, agentCallSendable, {}),
  };
}
