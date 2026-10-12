// extensions 시험이 같이 쓰는 준비. 제품 코드와 mod.ts는 이 파일을 import하지 않는다.
import { err, ok } from "../../../base/mod.ts";
import type { McpVaultKeychain } from "../mcp-oauth-vault.ts";

export type FakeVaultKeychain = McpVaultKeychain & {
  // 항목별 값(문자열)과 용도다. 값은 이 시험용 keychain에만 있다.
  readonly items: Map<string, { value: string; purpose: string }>;
  // true면 잠김·없음처럼 모든 호출이 unavailable이다.
  unavailable: boolean;
};

export function fakeVaultKeychain(): FakeVaultKeychain {
  let serial = 0;
  const keychain: FakeVaultKeychain = {
    items: new Map(),
    unavailable: false,
    status: () =>
      Promise.resolve(keychain.unavailable ? "unavailable" : "available"),
    store(item) {
      if (keychain.unavailable) {
        return Promise.resolve(
          err({ code: "unavailable", message: "keychain" }),
        );
      }
      const ref = item.ref ?? `sealed-${++serial}`;
      keychain.items.set(ref, {
        value: new TextDecoder().decode(item.value),
        purpose: item.purpose,
      });
      return Promise.resolve(ok(ref));
    },
    load(ref) {
      if (keychain.unavailable) {
        return Promise.resolve(
          err({ code: "unavailable", message: "keychain" }),
        );
      }
      const found = keychain.items.get(ref);
      return Promise.resolve(
        found === undefined
          ? err({ code: "not_found", message: "none" })
          : ok(new TextEncoder().encode(found.value)),
      );
    },
    remove(ref) {
      if (keychain.unavailable) {
        return Promise.resolve(
          err({ code: "unavailable", message: "keychain" }),
        );
      }
      return Promise.resolve(
        keychain.items.delete(ref)
          ? ok(undefined)
          : err({ code: "not_found", message: "none" }),
      );
    },
  };
  return keychain;
}
