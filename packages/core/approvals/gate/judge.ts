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

// unattended·skip에서는 묻는 대신 그냥 돈다. deny는 이 길을 타지 않는다.
function askIn(mode: TurnMode): Judgment {
  return mode === "attended" ? { kind: "ask" } : { kind: "run" };
}

// IO 없는 순수 함수다. 같은 입력은 같은 결과다.
export function judge(
  call: GateCall,
  assignment: Pick<Assignment, "entries"> | null,
  shell: ShellRuleLayers,
  mode: TurnMode,
): Judgment {
  if (call.kind === "shell") {
    const normalized = normalize(call.command);
    const candidates = [...new Set([normalized, ...shellPieces(call.command)])];
    const verdicts = candidates.map((text) => shellVerdict(shell, text));
    const denied = verdicts.find((verdict) => verdict.action === "deny");
    if (denied) {
      return { kind: "deny", reason: "shell_rule", pattern: denied.pattern };
    }
    return verdicts.some((verdict) => verdict.action === "ask")
      ? askIn(mode)
      : { kind: "run" };
  }
  // MCP server는 설정한 층이 곧 할당이라 할당을 보지 않는다.
  if (call.kind === "app_tool") {
    const entry = assignment?.entries.find((item) => item.app === call.app);
    if (!entry) return { kind: "deny", reason: "not_assigned", pattern: null };
    if (entry.removed_tools.includes(call.tool)) {
      return { kind: "deny", reason: "removed", pattern: null };
    }
  }
  if (ASK_EXTERNAL_WHEN_ATTENDED && call.effect === "external") {
    return askIn(mode);
  }
  return { kind: "run" };
}
