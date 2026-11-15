// 폰 entry의 openStore다. DB는 host가 `store.open`으로 준다. 파일 경로도 `node:sqlite`도 없다.
// session(changeset)은 host가 자기 연결에서 맡으므로 여기서 걸지 않는다.

import { CapabilityError } from "./errors.ts";
import { readHost } from "./host.ts";
import { makeStore, type OpenStoreOptions, type Store } from "./store.ts";

export function openStore(options: OpenStoreOptions = {}): Store {
  const host = options.host ?? readHost();
  if (!host?.store?.open) {
    throw new CapabilityError({
      code: "unavailable",
      message: "this host does not give the app a database",
    });
  }
  return makeStore({
    db: host.store.open(),
    host,
    now: options.now ?? (() => new Date().toISOString()),
    fallbackMigrations() {
      throw new CapabilityError({
        code: "unavailable",
        message: "this host does not give the app its migrations",
      });
    },
  });
}
