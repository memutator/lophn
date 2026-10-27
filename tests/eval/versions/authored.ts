import { readdir, readFile } from "node:fs/promises";
import type { Criterion } from "../types.ts";
import { hashBundle, prettyJson } from "./hash.ts";

// criterion에서 n을 뺀 글. hash는 hashText(content)다.
export function criterionContent(criterion: Criterion): string {
  const { name, question, verdicts, pass } = criterion;
  return prettyJson({ name, question, verdicts, pass });
}

// judge 정의에서 n을 뺀 글. prompt 글이 풀려 있는 값을 받는다.
export function judgeContent(
  definition: { n: number } & Record<string, unknown>,
): string {
  const { n: _n, ...rest } = definition;
  return prettyJson(rest);
}

// 시나리오 file과 같은 폴더의 helper file(`.scenario.ts`와 `_test.ts`가 아닌 것)을 묶은 hash.
export async function scenarioHash(scenarioPath: string): Promise<string> {
  const slash = scenarioPath.lastIndexOf("/");
  const dir = scenarioPath.slice(0, slash);
  const own = scenarioPath.slice(slash + 1);
  const files: Record<string, string> = {};
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    const helper = !e.name.endsWith(".scenario.ts") &&
      !e.name.endsWith("_test.ts");
    if (e.name === own || helper) {
      files[e.name] = await readFile(`${dir}/${e.name}`, "utf8");
    }
  }
  return hashBundle(files);
}
