// 제품 기본 keychain. Linux는 Secret Service(secret-tool, 값은 stdin)이고 그 밖은 아직 adapter가
// 없어 unavailable이다. 파일 볼트·환경 변수 fallback은
// 없다. 이 함수를 부르는 곳은 값을 쥐는 신뢰 경계(I/O worker의 secret pipe, core의 secret store)
// 뿐이다.

import {
  createLinuxSecretServiceAdapter,
  randomSealedRef,
  secretToolRunner,
} from "./linux-secret-service.ts";
import { type KeychainAdapter, unavailableAdapter } from "./keychain.ts";

export function productKeychain(
  secretTool?: readonly string[],
): KeychainAdapter {
  return Deno.build.os === "linux"
    ? createLinuxSecretServiceAdapter({
      runner: secretToolRunner(secretTool),
      randomRef: randomSealedRef,
    })
    : unavailableAdapter();
}
