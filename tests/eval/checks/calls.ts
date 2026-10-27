import type { ProgramCheck } from "../types.ts";
import { type CallWhere, sentCalls } from "./records.ts";

export type Count = number | { min?: number; max?: number };

export function countOk(n: number, count: Count): boolean {
  if (typeof count === "number") return n === count;
  return (
    (count.min === undefined || n >= count.min) &&
    (count.max === undefined || n <= count.max)
  );
}

export function countText(count: Count): string {
  if (typeof count === "number") return `${count}`;
  return `${count.min ?? 0}..${count.max ?? "∞"}`;
}

export function callCount(
  id: string,
  opts: { count: Count; where?: CallWhere },
): ProgramCheck {
  return {
    kind: "program",
    id,
    run({ trial }) {
      const n = sentCalls(trial, opts.where).length;
      return {
        pass: countOk(n, opts.count),
        reason: `call ${n}개 (기대 ${countText(opts.count)})`,
      };
    },
  };
}
