import { err, internalError, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { PortKey } from "../../../protocol/base/mod.ts";

// registry는 phantom을 지운다. PortKey<T>의 함수 필드는 invariant라 다른 T를 한 배열에 못 넣는다.
// defineTxPort는 key identity와 create 반환 T를 compile에서 남긴다.
export type TxPortRegistration = {
  readonly key: { readonly name: string };
  readonly create: (tx: Tx) => unknown;
};

export function defineTxPort<T>(
  key: PortKey<T>,
  create: (tx: Tx) => T,
): TxPortRegistration {
  return { key, create };
}

type PortFailure = (result: Result<never>) => never;

export type TxPortLookup = {
  port<T>(key: PortKey<T>): T;
  // 등록 여부만 본다. 없으면 false이고 throw하지 않는다.
  present(key: PortKey<unknown>): boolean;
  seal(): void;
};

// factory는 이 Tx에서 key마다 한 번만 돈다. cache는 이 객체 안에만 있다.
// 반환 객체·함수는 감싸거나 복사하지 않는다. 효과는 guarded Tx가 seal 뒤에서 막는다.
// factory가 복사한 값이나 Tx 밖 side effect는 지울 수 없다.
export function createTxPortLookup(
  ports: readonly TxPortRegistration[],
  tx: Tx,
  live: () => void,
  fail: PortFailure,
): TxPortLookup {
  const factories = new Map<object, (tx: Tx) => unknown>();
  let registry: Result<void> = { ok: true, value: undefined };
  const seen = new Set<object>();
  try {
    if (!Array.isArray(ports)) throw new Error("invalid port registry");
    for (const registration of ports) {
      const key = registration?.key;
      const create = registration?.create;
      if (
        key === null ||
        typeof key !== "object" ||
        typeof key.name !== "string" ||
        key.name.length === 0 ||
        typeof create !== "function" ||
        seen.has(key)
      ) {
        throw new Error("invalid port registration");
      }
      seen.add(key);
      factories.set(key, create);
    }
  } catch {
    registry = err(internalError());
    factories.clear();
  }
  const cache = new Map<object, unknown>();
  const stack: object[] = [];
  let open = true;

  const reject = (): never => fail(err(internalError()));
  if (!registry.ok) reject();

  const port = <T>(key: PortKey<T>): T => {
    live();
    if (!open) throw reject();
    if (cache.has(key)) return cache.get(key) as T;
    const create = factories.get(key);
    if (create === undefined || stack.includes(key)) throw reject();
    stack.push(key);
    let value: unknown;
    let failed = false;
    try {
      value = create(tx);
      if (awaitable(value)) {
        observe(value);
        failed = true;
      }
    } catch (thrown) {
      failed = true;
      // throw 값의 then getter도 던질 수 있다. 관측은 실패 상태를 바꾸지 않는다.
      observe(thrown);
    } finally {
      stack.pop();
    }
    if (failed) throw reject();
    cache.set(key, value);
    return value as T;
  };

  return {
    port,
    present: (key) => factories.has(key),
    seal() {
      open = false;
      cache.clear();
    },
  };
}

// then 접근 자체가 던지거나 then이 함수면 동기 port로 받지 않는다.
function awaitable(value: unknown): boolean {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }
  const then = (value as { then?: unknown }).then;
  return typeof then === "function";
}

function observe(value: unknown): void {
  try {
    void Promise.resolve(value).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    // 관측 실패도 성공으로 바꾸지 않는다.
  }
}
