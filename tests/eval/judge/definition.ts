import { readFile } from "node:fs/promises";

export type JudgeDefinition = {
  n: number;
  prompt: string;
};

// `tests/eval/` 기준. ev-versions가 이 두 file의 byte로 judge의 hash를 잰다.
export const JUDGE_FILES = ["judge/judge.json", "judge/prompt.md"];

export async function loadJudgeDefinition(): Promise<JudgeDefinition> {
  const meta = JSON.parse(
    await readFile(new URL("./judge.json", import.meta.url), "utf8"),
  );
  const prompt = await readFile(
    new URL("./prompt.md", import.meta.url),
    "utf8",
  );
  return { ...meta, prompt };
}
