import type { ProgramCheck } from "../types.ts";
import { type Count, countOk, countText } from "./calls.ts";
import { effectiveToolCalls } from "./records.ts";

// tool이 배열이면 그 가운데 어느 것이든 센다. input이 있으면 tool call 입력의 그 칸이 모두 같은(===) call만 센다.
export function toolCount(
  id: string,
  opts: {
    tool: string | string[];
    input?: Record<string, unknown>;
    count: Count;
    success?: boolean;
  },
): ProgramCheck {
  const tools = [opts.tool].flat();
  const name = tools.join("|");
  return {
    kind: "program",
    id,
    run({ trial }) {
      const n = effectiveToolCalls(trial).filter(
        (c) =>
          tools.includes(c.call.tool) &&
          (!opts.success || c.call.outcome?.kind === "success") &&
          Object.entries(opts.input ?? {}).every(
            ([k, v]) => (c.input as Record<string, unknown> | null)?.[k] === v,
          ),
      ).length;
      const input =
        opts.input === undefined ? "" : ` ${JSON.stringify(opts.input)}`;
      return {
        pass: countOk(n, opts.count),
        reason: `${name}${input} ${opts.success ? "성공 " : ""}${n}번 (기대 ${countText(
          opts.count,
        )})`,
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
      const missing = tools
        .filter((t) => ![t].flat().some((name) => called.has(name)))
        .map((t) => [t].flat().join("|"));
      return {
        pass: missing.length === 0,
        reason:
          missing.length === 0
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
          effectiveToolCalls(trial)
            .filter((c) => c.call.effect !== "read")
            .map((c) => c.call.tool),
        ),
      ];
      return {
        pass: writes.length === 0,
        reason:
          writes.length === 0
            ? "쓰기 tool 없음"
            : `쓰기 tool 불림: ${writes.join(", ")}`,
      };
    },
  };
}
