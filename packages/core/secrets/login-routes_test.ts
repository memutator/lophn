import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createIdSource, err, ok } from "../../base/mod.ts";
import { loginsRelease } from "../../protocol/secrets/mod.ts";
import {
  loginsDeleteHandler,
  loginsListHandler,
  loginsReleaseHandler,
  loginsSaveHandler,
} from "./login-routes.ts";
import { createLoginStore } from "./logins.ts";
import { totpCode } from "./totp.ts";

const CAPABILITY = "c".repeat(43);
const PASSWORD = "hunter2-MARKER";
// RFC 6238 부록의 SHA1 seed "12345678901234567890"의 base32다.
const SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const ORIGIN = "https://example.com";
const CTX = {} as never;

async function setup() {
  const root = await mkdtemp(`${tmpdir()}/logins-`);
  const values = new Map<string, string>();
  const secrets = {
    names: () => ok([...values.keys()]),
    get: (name: string) =>
      values.has(name)
        ? ok(values.get(name)!)
        : err({ code: "not_found" as const, message: "secret이 없다" }),
    delete: (name: string) => {
      values.delete(name);
      return Promise.resolve(ok({ name, configured: false }));
    },
  };
  const clock = { now: () => "", nowMs: () => 59_000 };
  const logins = createLoginStore({ root });
  const ids = createIdSource({
    clock,
    random: { fill: (bytes: Uint8Array) => crypto.getRandomValues(bytes) },
  });
  const save = loginsSaveHandler({ logins, ids });
  const saved = await save(CTX, {
    label: "Example",
    origin: ORIGIN,
    username: "me",
  });
  assert.ok(saved.ok);
  const id = (saved.value as { id: string }).id;
  values.set(`login.${id}.password`, PASSWORD);
  values.set(`login.${id}.totp`, SEED);
  const release = loginsReleaseHandler({
    logins,
    secrets,
    capabilities: { has: (c) => c === CAPABILITY },
    clock,
  });
  return {
    id,
    values,
    release,
    list: loginsListHandler({ logins, secrets }),
    remove: loginsDeleteHandler({ logins, secrets }),
    done: () => rm(root, { recursive: true, force: true }),
  };
}

test("release는 capability가 없거나 origin이 다르면 값을 내주지 않는다", async () => {
  const t = await setup();
  try {
    const ask = (over: object) =>
      t.release(CTX, {
        id: t.id,
        field: "password",
        origin: ORIGIN,
        shell_capability: CAPABILITY,
        ...over,
      });
    const good = await ask({});
    assert.ok(good.ok);
    assert.deepEqual(good.value, { value: PASSWORD });
    for (const bad of [
      { shell_capability: "d".repeat(43) },
      { origin: "https://example.com:8443" },
      { origin: "https://sub.example.com" },
      { origin: "http://example.com" },
      { origin: "https://evil.example.com.attacker.test" },
    ]) {
      const result = await ask(bad);
      assert.ok(!result.ok);
      assert.equal(result.error.code, "forbidden");
      assert.ok(!JSON.stringify(result).includes(PASSWORD));
    }
    // user token·agent credential 모두 capability를 모른다. agent는 route actor 상한에서 걸린다.
    assert.deepEqual(loginsRelease.actors, ["user"]);
  } finally {
    await t.done();
  }
});

test("TOTP release는 지금 6자리 code를 내준다", async () => {
  const t = await setup();
  try {
    const result = await t.release(CTX, {
      id: t.id,
      field: "totp",
      origin: ORIGIN,
      shell_capability: CAPABILITY,
    });
    // RFC 6238 time 59s의 6자리 값이다.
    assert.deepEqual(result.ok && result.value, { value: "287082" });
    assert.equal(totpCode("not base32 !", 0), undefined);
  } finally {
    await t.done();
  }
});

test("logins/list는 값을 싣지 않는다", async () => {
  const t = await setup();
  try {
    const listed = await t.list(CTX, {});
    assert.ok(listed.ok);
    assert.deepEqual(listed.value, [
      {
        id: t.id,
        label: "Example",
        origin: ORIGIN,
        username: "me",
        note: "",
        totp: true,
      },
    ]);
    assert.ok(!JSON.stringify(listed).includes(PASSWORD));
    assert.ok(!JSON.stringify(listed).includes(SEED));
    const other = await t.list(CTX, { origin: "https://other.test" });
    assert.deepEqual(other.ok && other.value, []);
  } finally {
    await t.done();
  }
});

test("login을 지우면 두 secret 이름도 지워진다", async () => {
  const t = await setup();
  try {
    const removed = await t.remove(CTX, { id: t.id });
    assert.ok(removed.ok);
    assert.deepEqual([...t.values.keys()], []);
    const listed = await t.list(CTX, {});
    assert.deepEqual(listed.ok && listed.value, []);
  } finally {
    await t.done();
  }
});
