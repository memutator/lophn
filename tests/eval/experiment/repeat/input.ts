import type { ToolResult } from "../../../../packages/protocol/lophn-agent/tool-values.ts";
import { joinInput } from "../../judge/mod.ts";
import type { CollectedToolCall } from "../../types.ts";
import type { RepeatGroup } from "./find.ts";

const MAX_LINES = 30;

const cut = (text: string, max: number) =>
  text.length > max ? text.slice(0, max) + "…(truncated)" : text;

function line(
  t: CollectedToolCall,
  order: number,
  repeated: Set<string>,
): string {
  const { call } = t;
  const input =
    t.input === null
      ? "(input not available)"
      : cut(JSON.stringify(t.input), 200);
  const outcome = call.outcome;
  const result =
    outcome === null
      ? "unfinished"
      : outcome.code
        ? `${outcome.kind}/${outcome.code}`
        : outcome.kind;
  const summary =
    t.output === null ? "" : ` | ${cut((t.output as ToolResult).summary, 120)}`;
  const mark = repeated.has(call.id) ? "*" : "";
  return `#${order} ${mark}${call.tool} ${input} -> ${result}${summary}`;
}

export function repeatKindInput(group: RepeatGroup): string {
  const first = group.timeline[0];
  const repeated = new Set(group.calls);
  const lines = group.timeline.map((t, i) => line(t, i + 1, repeated));
  const shown =
    lines.length > MAX_LINES
      ? [
          ...lines.slice(0, MAX_LINES / 2),
          `… ${lines.length - MAX_LINES} lines omitted …`,
          ...lines.slice(-MAX_LINES / 2),
        ]
      : lines;
  const input =
    first.input === null
      ? "(input not available)"
      : cut(JSON.stringify(first.input), 2000);
  return joinInput([
    {
      label: "REPEATED_CALL",
      text: `tool: ${group.tool}\ntimes: ${group.calls.length}\ninput: ${input}`,
    },
    { label: "TIMELINE", text: shown.join("\n") },
  ]);
}
