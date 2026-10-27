import { readFile, writeFile } from "node:fs/promises";
import { errorCode } from "../../../packages/base/mod.ts";
import type { JudgeItem, TrialResult } from "../types.ts";
import { judgePassed } from "./grade.ts";
import { type PendingJudge, readPending } from "./pending.ts";

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function reasonOf(item: JudgeItem): string {
  if (item.state === "pending") return "채점 대기";
  return oneLine(item.error ?? `${item.verdict}: "${item.quote ?? ""}"`);
}

// entry가 채점의 정본이다. 들어온 채점을 그 trial의 judge item과 check 결과에 합친 새 값을 돌려준다.
export function foldJudge(
  trials: TrialResult[],
  entries: PendingJudge[],
): TrialResult[] {
  return trials.map((t) => {
    const mine = entries.filter(
      (e) => e.kind === "check" && e.trial === t.index,
    );
    if (mine.length === 0) return t;
    const judge = t.judge.map(
      (j) => mine.find((e) => e.item.check === j.check)?.item ?? j,
    );
    const checks = t.checks.map((c) => {
      const e = mine.find((e) => e.item.check === c.id);
      if (e === undefined) return c;
      const { pending: _pending, ...rest } = c;
      return {
        ...rest,
        pass: judgePassed(e.criterion, e.item),
        reason: reasonOf(e.item),
        ...(e.item.state === "pending" && { pending: true }),
      };
    });
    return { ...t, judge, checks };
  });
}

const write = (path: string, value: unknown) =>
  writeFile(path, JSON.stringify(value, null, 2) + "\n");

async function readJson(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (errorCode(e) === "ENOENT") return undefined;
    throw e;
  }
}

// 요약이 아직 없으면(runner가 시나리오 끝에 쓴다) 아무것도 쓰지 않고 false.
export async function foldRun(args: {
  evalDir: string;
  runsDir: string;
  run: string;
}): Promise<boolean> {
  const { evalDir, runsDir, run } = args;
  const summaryPath = `${runsDir}/${run}.json`;
  const summary = await readJson(summaryPath);
  if (summary === undefined) return false;
  const entries = await readPending(evalDir, run);
  summary.trials = foldJudge(summary.trials, entries);
  await write(summaryPath, summary);
  for (const t of summary.trials as TrialResult[]) {
    const path = `${evalDir}/${run}/trial-${t.index}.json`;
    const full = await readJson(path);
    if (full === undefined) continue;
    full.judge = t.judge;
    await write(path, full);
  }
  return true;
}
