import { readFile } from "node:fs/promises";
import { type Criterion, parseRef } from "../types.ts";

export const CRITERIA_DIR = new URL("./", import.meta.url);

export async function loadCriterion(ref: string): Promise<Criterion> {
  const { name, n } = parseRef(ref, "criterion");
  const criterion: Criterion = JSON.parse(
    await readFile(new URL(`./${name}.json`, CRITERIA_DIR), "utf8"),
  );
  if (criterion.n !== n) {
    throw new Error(
      `criterion ${ref}가 이 checkout에 없다: file은 @${criterion.n}`,
    );
  }
  const { verdicts, pass } = criterion;
  if (
    !verdicts.includes("cannot_tell") || pass.includes("cannot_tell") ||
    !pass.every((verdict) => verdicts.includes(verdict))
  ) {
    throw new Error(`criterion ${ref}의 verdicts나 pass가 틀렸다`);
  }
  return criterion;
}
