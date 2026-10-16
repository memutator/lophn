import type { Id } from "../../../protocol/base/ids.ts";
import type { Intent } from "../../../protocol/approvals/mod.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";

// 지침 파일은 LOPHN.md뿐이다. agent 정의와 skill은 lophn data에 있어 file tool이 닿지 않는다.
export function isInstructionFile(path: string): boolean {
  return path.split(/[\\/]/).pop() === "LOPHN.md";
}

// file tool로 LOPHN.md를 쓰는 것은 설정 고치기다. 경로를 가르는 일은 file tool 실행기가 한다.
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
