import type { ProgramCheck } from "../types.ts";
import { type Count, countOk, countText } from "./calls.ts";
import { effectiveToolCalls } from "./records.ts";

export function toolCount(
  id: string,
  opts: { tool: string; count: Count; success?: boolean },
): ProgramCheck {
  return {
    kind: "program",
    id,
    run({ trial }) {
      const n =
        effectiveToolCalls(trial).filter((c) =>
          c.call.tool === opts.tool &&
          (!opts.success || c.call.outcome?.kind === "success")
        ).length;
      return {
        pass: countOk(n, opts.count),
        reason: `${opts.tool} ${opts.success ? "성공 " : ""}${n}번 (기대 ${
          countText(opts.count)
        })`,
      };
    },
  };
}

// 배열 항목은 그 가운데 하나가 불렸으면 된다.
export function toolsCalled(
  id: string,
  tools: (string | string[])[],
): ProgramCheck {
  return {
    kind: "program",
    id,
    run({ trial }) {
      const called = new Set(effectiveToolCalls(trial).map((c) => c.call.tool));
      const missing = tools.filter((t) =>
        ![t].flat().some((name) => called.has(name))
      ).map((t) => [t].flat().join("|"));
      return {
        pass: missing.length === 0,
        reason: missing.length === 0
          ? "모두 불림"
          : `안 불린 tool: ${missing.join(", ")}`,
      };
    },
  };
}

export function noWriteTools(id: string): ProgramCheck {
  return {
    kind: "program",
    id,
    run({ trial }) {
      const writes = [
        ...new Set(
          effectiveToolCalls(trial).filter((c) => c.call.effect !== "read")
            .map((c) => c.call.tool),
        ),
      ];
      return {
        pass: writes.length === 0,
        reason: writes.length === 0
          ? "쓰기 tool 없음"
          : `쓰기 tool 불림: ${writes.join(", ")}`,
      };
    },
  };
}
