// moduleHash와 고정 의존의 정본. bundle.ts는 이 hash를 다시 적지 않고
// guest 계약·추출 규칙 버전은 같은 근원(guest/contract.ts·bundle.ts)에서 온다.
// core graph가 이 파일을 import해도 게스트 실행 코드는 들어오지 않는다.
import { sha256Text } from "../pure/sha256.ts";
import {
  EXTRACTION_RULES_VERSION,
  GUEST_CONTRACT_VERSION,
} from "./contract.ts";

export const PINNED_DEPENDENCIES = [
  "parse5@8.0.1",
  "entities@8.1.0",
] as const;

export function moduleHash(bundle: string): string {
  return sha256Text(JSON.stringify({
    contract: GUEST_CONTRACT_VERSION,
    extraction: EXTRACTION_RULES_VERSION,
    dependencies: PINNED_DEPENDENCIES,
    bundle,
  }));
}

// bundle.js의 hash. bundle을 다시 만들면 이 값도 바뀌고 check 테스트가 일치를 확인한다.
export const BUILTIN_MODULE_HASH =
  "8098b95b6b7bf63f8466c8e07c2f2a560fd46ff4160671fd99faa4c82a83ccdd";
