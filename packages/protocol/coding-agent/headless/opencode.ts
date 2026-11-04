import { jsonLine, safePrompt, summaryOf } from "./shared.ts";
import type { HeadlessEvent, HeadlessSpec } from "./types.ts";

// `opencode run --standalone --format json`. `--auto`(묻는 권한을 전부 허락)는 쓰지 않는다. 묻는 권한은 거절된다.
// 마지막 step에 끝 줄이 없어서 끝은 process 종료다.
export const opencodeHeadless: HeadlessSpec = {
  command: "opencode",
  args: ({ prompt, sessionId }) => [
    "run",
    "--standalone",
    "--format",
    "json",
    ...(sessionId === null ? [] : ["--session", sessionId]),
    safePrompt(prompt),
  ],
  // opencode에는 명령 단위 금지 flag가 없다. 규칙이 있으면 지킬 수 없으므로 띄우지 않는다.
  permissions: (rules) => (rules.length === 0 ? [] : null),
  parser() {
    let session: string | null = null;
    return (line) => {
      const data = jsonLine(line);
      if (data === null) return [];
      const events: HeadlessEvent[] = [];
      if (typeof data.sessionID === "string" && data.sessionID !== session) {
        session = data.sessionID;
        events.push({ kind: "session", id: session });
      }
      if (data.type === "text" && data.part.text !== "") {
        events.push({ kind: "text", text: data.part.text });
      } else if (data.type === "tool_use") {
        const { tool, state } = data.part;
        if (state.status === "completed" || state.status === "error") {
          events.push({
            kind: "tool",
            name: tool,
            summary: summaryOf(state.input),
            status: state.status === "completed" ? "done" : "failed",
          });
        }
      }
      return events;
    };
  },
};
