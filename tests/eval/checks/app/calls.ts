// 기록(TrialRecord)만 보는 check. core 없이 fixture에서도 돈다.
import type { ProgramCheck } from "../../types.ts";
import { type Count, countOk, countText } from "../calls.ts";
import { toolCallsOf } from "../records.ts";

function successCalls(
  trial: Parameters<typeof toolCallsOf>[0],
  command: string,
) {
  // 제품은 tool_calls.app_tool을 되돌리기 binding이 있을 때만 채운다. tool 이름은
  // `domain__<domain>__<tool>`(밖의 글자는 밑줄, 뒤에 hash가 붙을 수 있다)라 이름으로도 맞춘다.
  const wire = `__${command.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  return toolCallsOf(trial).filter((c) =>
    (c.call.app_tool?.command === command ||
      (c.call.tool.startsWith("domain__") && c.call.tool.includes(wire))) &&
    c.call.outcome?.kind === "success"
  );
}

// Operator가 앱의 tool을 불렀나.
export function appToolCalled(
  id: string,
  opts: { command: string; count?: Count },
): ProgramCheck {
  return {
    kind: "program",
    id,
    run({ trial }) {
      const n = successCalls(trial, opts.command).length;
      const count = opts.count ?? { min: 1 };
      return {
        pass: countOk(n, count),
        reason: `${opts.command} 성공 ${n}번 (기대 ${countText(count)})`,
      };
    },
  };
}
