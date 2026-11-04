import { jsonLine, safePrompt } from "./shared.ts";
import type { HeadlessEvent, HeadlessSpec } from "./types.ts";

// `codex exec --json`. 샌드박스는 cwd 안 쓰기까지다(workspace-write). danger-full-access는 쓰지 않는다.
// resume에는 `-s`가 없어서 같은 값을 `-c`로 넘긴다. 입력(stdin)은 host가 바로 닫는다(안 닫으면 codex가 기다린다).
const SANDBOX = "workspace-write";

export const codexHeadless: HeadlessSpec = {
  command: "codex",
  args: ({ prompt, sessionId }) =>
    sessionId === null
      ? [
          "exec",
          "--json",
          "--skip-git-repo-check",
          "-s",
          SANDBOX,
          "--",
          safePrompt(prompt),
        ]
      : [
          "exec",
          "resume",
          "--json",
          "--skip-git-repo-check",
          "-c",
          `sandbox_mode="${SANDBOX}"`,
          "--",
          sessionId,
          safePrompt(prompt),
        ],
  // codex에는 명령 단위 금지 flag가 없다. 규칙이 있으면 지킬 수 없으므로 띄우지 않는다.
  permissions: (rules) => (rules.length === 0 ? [] : null),
  parser() {
    return (line) => {
      const data = jsonLine(line);
      if (data === null) return [];
      const events: HeadlessEvent[] = [];
      if (data.type === "thread.started") {
        events.push({ kind: "session", id: data.thread_id });
      } else if (data.type === "item.completed") {
        const item = data.item;
        if (item.type === "agent_message") {
          if (item.text !== "") events.push({ kind: "text", text: item.text });
        } else if (item.type !== "reasoning" && item.type !== "error") {
          events.push({
            kind: "tool",
            name: item.type === "command_execution" ? "command" : item.type,
            summary: typeof item.command === "string" ? item.command : "",
            status:
              item.status === "failed" || (item.exit_code ?? 0) !== 0
                ? "failed"
                : "done",
          });
        }
      } else if (data.type === "turn.completed") {
        events.push({ kind: "end", ok: true });
      } else if (data.type === "turn.failed") {
        events.push({
          kind: "end",
          ok: false,
          error: String(data.error?.message ?? "turn failed"),
        });
      }
      return events;
    };
  },
};
