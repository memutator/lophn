import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import type { SecretFileStore } from "./file-store.ts";
import { openSecretStore } from "./secret-store.ts";

const CODE = "482913";

// 한 번 넣은 값이 sync에서 회수되면 snapshot·결과에서 지워지지 않고, release 뒤에도 남으면 값이 계속 붙들린다.
test("붙든 값은 파일에 없어도 sync가 회수하지 않고 release에서만 알려진 값이 아니다", async () => {
  const stored = ["pw-on-file"];
  const file = {
    open: () => Promise.resolve(ok(undefined)),
    values: () => ok([...stored]),
    names: () => ok([]),
    stop() {},
  } as unknown as SecretFileStore;
  const registered = new Set<string>();
  const store = openSecretStore({
    file,
    channel: {
      register: (values) => {
        for (const value of values) registered.add(value);
        return Promise.resolve(ok(undefined));
      },
      revoke: (values) => {
        for (const value of values) registered.delete(value);
        return Promise.resolve(ok(undefined));
      },
      setReady: () => Promise.resolve(ok(undefined)),
    },
  });
  await store.open();
  assert.ok((await store.hold([CODE])).ok);
  assert.ok(store.known.match(`code ${CODE} typed`) !== undefined);
  assert.ok(registered.has(CODE));
  assert.ok(!stored.includes(CODE));

  await store.sync();
  assert.ok(store.known.match(CODE) !== undefined);

  assert.ok((await store.release([CODE])).ok);
  assert.equal(store.known.match(CODE), undefined);
  assert.ok(!registered.has(CODE));
  assert.ok(store.known.match("pw-on-file") !== undefined);
  store.stop();
});
