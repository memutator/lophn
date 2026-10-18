export type JudgeDefinition = {
  n: number;
  model: string;
  max_tokens: number;
  price_usd_per_mtok: { input: number; output: number };
  prompt: string;
};

// `tests/eval/` 기준. ev-versions가 이 두 file의 byte로 judge의 hash를 잰다.
export const JUDGE_FILES = ["judge/judge.json", "judge/prompt.md"];

export async function loadJudgeDefinition(): Promise<JudgeDefinition> {
  const meta = JSON.parse(
    await Deno.readTextFile(new URL("./judge.json", import.meta.url)),
  );
  const prompt = await Deno.readTextFile(
    new URL("./prompt.md", import.meta.url),
  );
  return { ...meta, prompt };
}
