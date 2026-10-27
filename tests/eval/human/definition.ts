import { readFile } from "node:fs/promises";

export type HumanDefinition = {
  n: number;
  prompt: string;
};

// `tests/eval/` 기준. 아직 버전 층(registry, RunRecord)에는 들지 않는다.
export const HUMAN_FILES = ["human/human.json", "human/prompt.md"];

export async function loadHumanDefinition(): Promise<HumanDefinition> {
  const meta = JSON.parse(
    await readFile(new URL("./human.json", import.meta.url), "utf8"),
  );
  const prompt = await readFile(
    new URL("./prompt.md", import.meta.url),
    "utf8",
  );
  return { n: meta.n, prompt };
}
