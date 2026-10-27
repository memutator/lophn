import { readFile } from "node:fs/promises";
import {
  err,
  errorCode,
  ok,
  type Result,
} from "../../../../packages/base/mod.ts";
import type { TrialRecord } from "../../types.ts";

// 전체 기록은 runner가 `<dir>/<run>/trial-<index>.json`에 `{ trial, judge, source }`로 쓴다.
export async function loadRecordedTrial(
  dir: string,
  run: string,
  index: number,
): Promise<Result<TrialRecord>> {
  const path = `${dir}/${run}/trial-${index}.json`;
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return err({ code: "not_found", message: `no full record at ${path}` });
    }
    throw error;
  }
  try {
    const { trial } = JSON.parse(text) as { trial?: TrialRecord };
    if (trial !== undefined) return ok(trial);
  } catch { /* 아래 오류로 낸다 */ }
  return err({ code: "invalid_input", message: `${path} has no trial` });
}
