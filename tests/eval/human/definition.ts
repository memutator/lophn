export type HumanDefinition = {
  n: number;
  model: string;
  max_tokens: number;
  price_usd_per_mtok: { input: number; output: number };
  prompt: string;
};

// `tests/eval/` 기준. 아직 버전 층(registry, RunRecord)에는 들지 않는다.
export const HUMAN_FILES = ["human/human.json", "human/prompt.md"];

export async function loadHumanDefinition(): Promise<HumanDefinition> {
  const meta = JSON.parse(
    await Deno.readTextFile(new URL("./human.json", import.meta.url)),
  );
  const prompt = await Deno.readTextFile(
    new URL("./prompt.md", import.meta.url),
  );
  return { ...meta, prompt };
}
