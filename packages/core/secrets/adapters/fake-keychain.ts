import { err, ok, type Result } from "../../../base/mod.ts";
import {
  KEYCHAIN_NOT_FOUND,
  KEYCHAIN_UNAVAILABLE,
  type KeychainAdapter,
  type KeychainItem,
  type KeychainStatus,
} from "./keychain.ts";

export type FakeKeychain = KeychainAdapter & {
  setStatus(status: KeychainStatus): void;
  // 삭제를 관측 전까지 보류한다. 완료 표시는 실제 확인 뒤에만 가능하다(R7).
  holdRemovals(held: boolean): void;
  confirmRemovals(): void;
  readonly stored: ReadonlyMap<string, Uint8Array>;
};

export function createFakeKeychain(options?: {
  status?: KeychainStatus;
  random?: () => string;
}): FakeKeychain {
  const values = new Map<string, Uint8Array>();
  const pending = new Set<string>();
  const purposes = new Map<string, string>();
  let status: KeychainStatus = options?.status ?? "available";
  let hold = false;
  let serial = 0;
  const nextRef = options?.random ??
    (() => `sealed-${(++serial).toString(16)}`);

  const closed = <T>(value: Result<T>): Result<T> =>
    status === "available" ? value : err(KEYCHAIN_UNAVAILABLE);

  return {
    setStatus(next) {
      status = next;
    },
    holdRemovals(held) {
      hold = held;
    },
    confirmRemovals() {
      pending.clear();
    },
    get stored() {
      return values;
    },
    status: () => Promise.resolve(status),
    store(item: KeychainItem) {
      if (status !== "available") {
        return Promise.resolve(err(KEYCHAIN_UNAVAILABLE));
      }
      const ref = item.ref ?? nextRef();
      values.set(ref, item.value.slice());
      purposes.set(ref, item.purpose);
      return Promise.resolve(ok(ref));
    },
    load(ref) {
      const value = values.get(ref);
      return Promise.resolve(
        closed(
          value === undefined ? err(KEYCHAIN_NOT_FOUND) : ok(value.slice()),
        ),
      );
    },
    listRefs(purpose, prefix) {
      if (status !== "available") {
        return Promise.resolve(err(KEYCHAIN_UNAVAILABLE));
      }
      return Promise.resolve(ok(
        [...values.keys()].filter((ref) =>
          purposes.get(ref) === purpose && ref.startsWith(prefix)
        ),
      ));
    },
    remove(ref) {
      if (status !== "available") {
        return Promise.resolve(err(KEYCHAIN_UNAVAILABLE));
      }
      if (pending.has(ref)) return Promise.resolve(err(KEYCHAIN_UNAVAILABLE));
      if (!values.has(ref)) return Promise.resolve(err(KEYCHAIN_NOT_FOUND));
      if (hold) {
        pending.add(ref);
        return Promise.resolve(err(KEYCHAIN_UNAVAILABLE));
      }
      values.delete(ref);
      purposes.delete(ref);
      pending.delete(ref);
      return Promise.resolve(ok(undefined));
    },
  };
}
