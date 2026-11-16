import type {
  Assignment,
  GateCall,
  Judgment,
  ShellRuleLayers,
} from "../../../protocol/approvals/mod.ts";
import type { TurnMode } from "../../../protocol/lophn-agent/turn-values.ts";
import { normalize, shellPieces, shellVerdict } from "./shell-match.ts";

// 할당한 tool의 바깥 효과는 attended에서도 묻지 않는다(사람, 2026-10-21. `project-docs/architecture/approval.md`).
// 사람이 묻기로 정하면 이 상수만 켠다.
const ASK_EXTERNAL_WHEN_ATTENDED = false;

// unattended·skip에서는 묻는 대신 그냥 돈다. 팀 자식(toParent)은 부모가 있으므로 mode와 상관없이 묻는다. deny는 이 길을 타지 않는다.
function askIn(mode: TurnMode, toParent: boolean): Judgment {
  return mode === "attended" || toParent ? { kind: "ask" } : { kind: "run" };
}

// shell extension tool을 판정하는 재료다. assigned는 그 agent 정의의 `extensions`, has는 켜진 extension의 catalog에 그 tool이 있는지다.
export type ExtensionGrant = {
  assigned: readonly string[];
  has(extension: string, tool: string): boolean;
};

// IO 없는 순수 함수다. 같은 입력은 같은 결과다.
export function judge(
  call: GateCall,
  assignment: Pick<Assignment, "entries"> | null,
  shell: ShellRuleLayers,
  mode: TurnMode,
  toParent: boolean,
  extensions: ExtensionGrant | null = null,
): Judgment {
  // 할당이 곧 허락이라 묻지 않는다. 꺼진 extension과 목록에서 빠진 tool은 `removed`다.
  if (call.kind === "extension_tool") {
    if (!extensions?.assigned.includes(call.extension)) {
      return { kind: "deny", reason: "not_assigned", pattern: null };
    }
    return extensions.has(call.extension, call.tool)
      ? { kind: "run" }
      : { kind: "deny", reason: "removed", pattern: null };
  }
  if (call.kind === "shell") {
    const normalized = normalize(call.command);
    const candidates = [...new Set([normalized, ...shellPieces(call.command)])];
    const verdicts = candidates.map((text) => shellVerdict(shell, text));
    const denied = verdicts.find((verdict) => verdict.action === "deny");
    if (denied) {
      return { kind: "deny", reason: "shell_rule", pattern: denied.pattern };
    }
    return verdicts.some((verdict) => verdict.action === "ask")
      ? askIn(mode, toParent)
      : { kind: "run" };
  }
  // 사람의 허락이 드는 설정은 사람에게만 묻는다. skip도 묻는다(사람이 "묻지 마"라고 한 것은 이 무게의 일이 아니다).
  // unattended turn과 팀 자식에는 물을 사람이 없어 막는다: 부모가 대신 허락하지 못한다. setting의 toParent는 skip을 켠
  // 팀 자식도 참이다(tool_gate/check가 그렇게 넘긴다).
  if (call.kind === "setting") {
    return mode === "unattended" || toParent
      ? { kind: "deny", reason: "no_person", pattern: null }
      : { kind: "ask" };
  }
  // MCP server는 설정한 층이 곧 할당이라 할당을 보지 않는다. app_tool의 tool은 앱의 command 이름이고
  // `removed_tools`도 command 이름을 담는다(operation은 할당 대상이 아니다).
  if (call.kind === "app_tool") {
    const entry = assignment?.entries.find((item) => item.app === call.app);
    if (!entry) return { kind: "deny", reason: "not_assigned", pattern: null };
    if (entry.removed_tools.includes(call.tool)) {
      return { kind: "deny", reason: "removed", pattern: null };
    }
  }
  if (ASK_EXTERNAL_WHEN_ATTENDED && call.effect === "external") {
    return askIn(mode, toParent);
  }
  return { kind: "run" };
}
