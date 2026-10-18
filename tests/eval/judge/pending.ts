import type { Criterion, JudgeItem } from "../types.ts";

export type PendingJudge = {
  key: string;
  run: string;
  trial: number;
  kind: "check" | "diagnosis"; // diagnosis는 통과에 들지 않는 진단
  asked_at: string;
  criterion: Criterion;
  item: JudgeItem;
};

export function judgeKey(trial: number, check: string): string {
  return `t${trial}-${check}`.replace(/[^A-Za-z0-9_.#-]/g, "_");
}

const folder = (evalDir: string, run: string) => `${evalDir}/${run}/judge`;

export const pendingPath = (evalDir: string, run: string, key: string) =>
  `${folder(evalDir, run)}/${key}.json`;

const text = (entry: PendingJudge) => JSON.stringify(entry, null, 2) + "\n";

// 같은 item을 덮지 않는다.
export async function writePending(
  evalDir: string,
  entry: PendingJudge,
): Promise<void> {
  await Deno.mkdir(folder(evalDir, entry.run), { recursive: true });
  await Deno.writeTextFile(
    pendingPath(evalDir, entry.run, entry.key),
    text(entry),
    {
      createNew: true,
    },
  );
}

// 채점이 들어올 때 쓴다. 이미 있는 entry만 고친다.
export async function rewritePending(
  evalDir: string,
  entry: PendingJudge,
): Promise<void> {
  await Deno.writeTextFile(
    pendingPath(evalDir, entry.run, entry.key),
    text(entry),
  );
}

export async function readPending(
  evalDir: string,
  run: string,
): Promise<PendingJudge[]> {
  const entries: PendingJudge[] = [];
  try {
    for await (const e of Deno.readDir(folder(evalDir, run))) {
      if (!e.isFile || !e.name.endsWith(".json")) continue;
      entries.push(JSON.parse(
        await Deno.readTextFile(`${folder(evalDir, run)}/${e.name}`),
      ));
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return entries.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

export function outstanding(entries: PendingJudge[]): PendingJudge[] {
  return entries.filter((e) => e.item.state === "pending");
}
