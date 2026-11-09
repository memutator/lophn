import { jsonLine, summaryOf } from "./shared.ts";
import type { HeadlessEvent, HeadlessSpec } from "./types.ts";

// `claude -p --output-format stream-json --verbose`. permission mode는 lophn이 정하지 않는다: 사람의 Claude Code 기본 설정대로 돈다.
// Bash는 `lophn` 명령 하나만 허락한다: harness가 `lophn call reply|send`로 답하고 다른 agent를 부르는 길이다.
// 정의의 deny는 이 allow보다 앞서므로 금지한 `lophn` 명령은 그대로 막힌다. 전부 허락(bypassPermissions)은 쓰지 않는다. flag 뒤의 값 목록이 prompt를 삼키지 않게 `--`로 끊는다.
export const claudeHeadless: HeadlessSpec = {
  command: "claude",
  args: ({ prompt, sessionId, deny }) => [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--allowed-tools",
    "Bash(lophn *)",
    ...(sessionId === null ? [] : ["--resume", sessionId]),
    ...(deny.length === 0 ? [] : ["--disallowed-tools", ...deny]),
    "--",
    prompt,
  ],
  permissions(rules) {
    const flags: string[] = [];
    for (const rule of rules) {
      const inner = /^lophn\((.+)\)$/.exec(rule)?.[1];
      if (inner === undefined) return null;
      // 인자 없는 호출과 인자 있는 호출을 둘 다 막는다.
      flags.push(`Bash(lophn ${inner})`, `Bash(lophn ${inner} *)`);
    }
    return flags;
  },
  parser() {
    const pending = new Map<string, { name: string; summary: string }>();
    return (line) => {
      const data = jsonLine(line);
      if (data === null) return [];
      const events: HeadlessEvent[] = [];
      // 하위 agent의 대화는 사람이 시킨 turn의 일이 아니다.
      if (data.parent_tool_use_id) return events;
      if (data.type === "system" && data.subtype === "init") {
        events.push({ kind: "session", id: data.session_id });
      } else if (data.type === "assistant") {
        for (const block of data.message?.content ?? []) {
          if (block.type === "text" && block.text !== "") {
            events.push({ kind: "text", text: block.text });
          } else if (block.type === "tool_use") {
            pending.set(block.id, {
              name: block.name,
              summary: summaryOf(block.input),
            });
          }
        }
      } else if (data.type === "user") {
        for (const block of data.message?.content ?? []) {
          const tool = pending.get(block.tool_use_id);
          if (block.type !== "tool_result" || tool === undefined) continue;
          pending.delete(block.tool_use_id);
          events.push({
            kind: "tool",
            ...tool,
            status: block.is_error === true ? "failed" : "done",
          });
        }
      } else if (data.type === "result") {
        const ok = data.subtype === "success" && data.is_error !== true;
        events.push({
          kind: "end",
          ok,
          ...(ok ? {} : { error: String(data.result ?? data.subtype) }),
        });
      }
      return events;
    };
  },
};
