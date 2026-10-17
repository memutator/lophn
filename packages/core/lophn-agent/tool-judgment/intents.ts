import type { Id } from "../../../protocol/base/ids.ts";
import type { Intent } from "../../../protocol/approvals/mod.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";

// 설정 고치기의 Gate intent다. 무엇이 설정 고치기인지는 부르는 쪽이 가른다.
export function settingsEditIntent(input: {
  what: Extract<Intent["target"], { kind: "settings_edit" }>["what"];
  id: string | null;
  session: Id<"ses">;
  turn: Id<"trn">;
  toolCall: Id<"tcl">;
  agent: AgentRef;
}): Intent {
  return {
    kind: "settings_edit",
    actor: { kind: "agent", agent: input.agent, session: input.session },
    target: { kind: "settings_edit", what: input.what, id: input.id },
    effect: "write",
    input: {},
    origin: {
      kind: "turn",
      session: input.session,
      turn: input.turn,
      tool_call: input.toolCall,
    },
  };
}
