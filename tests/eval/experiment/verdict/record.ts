import type { Result } from "../../../../packages/base/mod.ts";
import { type ExperimentResult, writeResult } from "../spec/mod.ts";
import { decide } from "./decide.ts";
import type { VerdictInput } from "./types.ts";

// 판정이 난 result가 있으면 writeResult의 conflict를 그대로 돌려준다(다시 굴려 마음에 드는 결과를 얻는 길을 막는다).
export async function recordVerdict(
  dir: string,
  input: VerdictInput,
): Promise<Result<ExperimentResult>> {
  const decided = decide(input);
  if (!decided.ok) return decided;
  const written = await writeResult(dir, decided.value);
  return written.ok ? decided : written;
}
