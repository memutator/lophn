// OS keychain 경계(platform/secrets#R1, R8). 값은 이 경계의 메모리와 keychain에만 둔다.
// 원값·길이·일부·keychain 내부 경로는 오류와 log에 넣지 않는다.

import { err, type Result } from "../../../base/mod.ts";
import type { SecretPurpose } from "../../../contracts/platform/mod.ts";

export type KeychainItem = {
  name: string;
  purpose: SecretPurpose;
  owner: string;
  value: Uint8Array;
  // 소유 경계가 고정 위치를 정할 때만 준다(coding connection credential). 없으면 adapter가
  // 값과 무관한 무작위 참조를 만든다.
  ref?: string;
};

export type KeychainStatus = "available" | "unavailable";

export type KeychainAdapter = {
  // 잠김·없음은 secret 기능만 unavailable. 파일·환경 변수 fallback은 없다(R8).
  status(): Promise<KeychainStatus>;
  // 저장한 불투명 참조를 돌려준다. 값은 참조에 들어가지 않는다.
  store(item: KeychainItem): Promise<Result<string>>;
  // 현재 참조로만 읽는다. 없는 참조는 not_found.
  load(sealedRef: string): Promise<Result<Uint8Array>>;
  // 실제 삭제를 확인한 경우만 ok. 없으면 not_found, 확인 불가면 unavailable.
  remove(sealedRef: string): Promise<Result<void>>;
  // 고정 위치를 쓰는 용도의 중단 고아를 찾는 데만 쓴다. 그 용도로 둔 항목 중 참조가 prefix로
  // 시작하는 것의 참조만 돌려주고 값은 내지 않는다. 없는 adapter는 목록을 만들 수 없다.
  listRefs?(
    purpose: SecretPurpose,
    prefix: string,
  ): Promise<Result<readonly string[]>>;
};

export const KEYCHAIN_UNAVAILABLE = {
  code: "unavailable" as const,
  message: "OS keychain을 사용할 수 없다",
};
export const KEYCHAIN_NOT_FOUND = {
  code: "not_found" as const,
  message: "OS keychain 항목이 없다",
};

export function unavailableAdapter(): KeychainAdapter {
  return {
    status: () => Promise.resolve("unavailable"),
    store: () => Promise.resolve(err(KEYCHAIN_UNAVAILABLE)),
    load: () => Promise.resolve(err(KEYCHAIN_UNAVAILABLE)),
    remove: () => Promise.resolve(err(KEYCHAIN_UNAVAILABLE)),
  };
}
