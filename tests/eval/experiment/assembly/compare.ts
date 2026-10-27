import type { LayerStat, SideStat } from "../spec/mod.ts";
import type { Boundary } from "./prefix.ts";

type Message = { role?: string; content?: unknown };

// 대화가 같은지는 tool 흐름으로만 본다. 글 message는 assembly가 바꾸는 대상(notice, 배치)이라 기준이 못 된다.
export function traceOf(body: unknown): string[] {
  const messages = ((body ?? {}) as { messages?: Message[] }).messages ?? [];
  const trace: string[] = [];
  for (const { role, content } of messages) {
    if (!Array.isArray(content)) continue;
    for (const block of content as {
      type?: string;
      name?: string;
      is_error?: boolean;
    }[]) {
      if (role === "assistant" && block.type === "tool_use") {
        trace.push(`use:${block.name}`);
      } else if (role === "user" && block.type === "tool_result") {
        trace.push(block.is_error === true ? "result:error" : "result:ok");
      }
    }
  }
  return trace;
}

export function firstDivergence(
  recorded: unknown[],
  replayed: unknown[],
): { at: number; reason: string } | null {
  const common = Math.min(recorded.length, replayed.length);
  for (let k = 0; k < common; k++) {
    const a = traceOf(recorded[k]);
    const b = traceOf(replayed[k]);
    const i = a.findIndex((x, j) => x !== b[j]);
    const at = i >= 0 ? i : a.length < b.length ? a.length : -1;
    if (at >= 0) {
      return {
        at: k + 1,
        reason: `tool flow differs at call ${k + 1}, step ${at + 1}: recorded ${
          a[at] ?? "(end)"
        }, replayed ${b[at] ?? "(end)"}`,
      };
    }
  }
  if (recorded.length !== replayed.length) {
    return {
      at: common + 1,
      reason: `request count differs: recorded ${recorded.length}, replayed ${replayed.length}`,
    };
  }
  return null;
}

const LINE = 160;
const ABSENT = "(absent)";
const head = (text: string) => text.split("\n")[0].slice(0, LINE);

// 두 글에서 처음 달라진 줄. 글이 같으면 앞 층이나 tools가 바뀐 것이다.
function firstChange(
  before: string,
  after: string,
): { before: string; after: string } {
  if (before === after) {
    const same = "(text same; tools or an earlier layer changed)";
    return { before: same, after: same };
  }
  const a = before.split("\n");
  const b = after.split("\n");
  const i = a.findIndex((line, j) => line !== b[j]);
  const at = i >= 0 ? i : a.length;
  return {
    before: (a[at] ?? "(end)").slice(0, LINE),
    after: (b[at] ?? "(end)").slice(0, LINE),
  };
}

// 한 call에 어떤 layer가 없으면 그 쌍은 안 같다(깨짐)로 센다.
export function sideStat(calls: Boundary[][]): SideStat {
  const names: string[] = [];
  for (const call of calls) {
    for (const b of call) if (!names.includes(b.layer)) names.push(b.layer);
  }
  const layers = names.map((layer): LayerStat => {
    let stable = 0;
    let first_break: LayerStat["first_break"] = null;
    for (let k = 1; k < calls.length; k++) {
      const prev = calls[k - 1].find((b) => b.layer === layer);
      const cur = calls[k].find((b) => b.layer === layer);
      if (
        prev !== undefined &&
        cur !== undefined &&
        prev.prefix_hash === cur.prefix_hash
      ) {
        stable++;
      } else if (first_break === null) {
        first_break = {
          call: k + 1,
          ...(prev && cur
            ? firstChange(prev.text, cur.text)
            : {
                before: prev ? head(prev.text) : ABSENT,
                after: cur ? head(cur.text) : ABSENT,
              }),
        };
      }
    }
    const pairs = Math.max(calls.length - 1, 0);
    return {
      layer,
      pairs,
      stable,
      rate: pairs === 0 ? null : stable / pairs,
      first_break,
    };
  });
  return { calls: calls.length, layers };
}
