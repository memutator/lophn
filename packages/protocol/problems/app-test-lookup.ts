import type { Result } from "../../base/mod.ts";
import { definePort, type PortKey } from "../base/ports.ts";

// release 준비 transaction이 같은 hash의 통과한 app test를 확인하는 읽기 port다.
// 결과를 쓰는 것은 problems/tests의 runner뿐이고, 이 port는 Verification의
// 사실만 읽는다. 구현은 problems가 내놓고 core 조립이 등록한다.
export type AppTestVerificationFact = {
  id: string;
  app: string;
  kind: "app_test" | "reproduction" | "test_command";
  result: "pass" | "fail" | "inconclusive";
  // 테스트 대상이 된 완성 bundle의 hash.
  bundle_hash: string;
};

export type AppTestVerificationLookup = (
  verification: string,
) => Result<AppTestVerificationFact | null>;

export const AppTestVerificationLookupPort: PortKey<
  AppTestVerificationLookup
> = definePort<AppTestVerificationLookup>("problems.AppTestVerificationLookup");
