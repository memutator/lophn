import { jsonLine, safePrompt } from "./shared.ts";
import type { HeadlessEvent, HeadlessSpec } from "./types.ts";

// `codex exec --json`. 샌드박스는 cwd 안 쓰기까지다(workspace-write). danger-full-access는 쓰지 않는다.
// resume에는 `-s`가 없어서 같은 값을 `-c`로 넘긴다. 입력(stdin)은 host가 바로 닫는다(안 닫으면 codex가 기다린다).
// workspace-write는 network를 끄는데 `lophn` CLI는 core에 loopback TCP로 닿으므로(`codex sandbox`로 확인: 막힘) network를 켠다.
// codex에는 loopback만 여는 flag가 없다. 이 값이 codex가 돌리는 shell 명령의 network 전부를 연다.
const SANDBOX = "workspace-write";
const NETWORK = "sandbox_workspace_write.network_access=true";

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
          "-c",
          NETWORK,
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
          "-c",
          NETWORK,
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
