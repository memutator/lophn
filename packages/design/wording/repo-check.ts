// 저장소 화면 코드 검사. problems/problem-codes가 소유한 문구 key를 알려진 key로 넣는다
// (shell/wording#R9). contracts를 import하므로 앱 SDK 사본(@lophn/wording)에는 넣지 않는다
// (packages/core/apps/packages/vendor.ts의 skipNames).
import { RESERVED_PROBLEM_CODES } from "../../protocol/problems/mod.ts";
import { type CheckOptions, checkScreens, type Finding } from "./check.ts";

// 화면이 그 key를 쓸 수 있고 catalog에 다시 정의하면 오류다.
export const PROBLEM_MESSAGE_KEYS: readonly string[] = RESERVED_PROBLEM_CODES
  .map((code) => code.message_key);

export function checkRepo(
  root: string,
  options: CheckOptions = {},
): Promise<Finding[]> {
  return checkScreens(root, {
    ...options,
    knownKeys: [...PROBLEM_MESSAGE_KEYS, ...(options.knownKeys ?? [])],
  });
}
