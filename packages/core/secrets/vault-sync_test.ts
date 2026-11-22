import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { err, manualClock, ok } from "../../base/mod.ts";
import { createBrowserVault } from "./browser-vault.ts";
import { BACKOFF_FIRST_MS } from "../../protocol/folder/limits.ts";
import {
  applyRemoteVault,
  browserVaultExchangeHandler,
  createVaultSync,
} from "./vault-sync.ts";

const KEEP = `lgn_${"1".repeat(26)}`;
const GONE = `lgn_${"2".repeat(26)}`;
const NEW = `lgn_${"3".repeat(26)}`;
const revs = (at: number) => ({
  label: at,
  origin: at,
  username: at,
  note: at,
  password: at,
  totp: at,
});
const meta = (id: string, at: number) => ({
  id,
  label: "Mail",
  origin: "https://mail.example",
  username: "me",
  note: "",
  revs: revs(at),
});

function fakeSecrets(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  const store = {
    values,
    // secrets.json을 못 읽는 때.
    broken: false,
    get: (name: string) =>
      store.broken
        ? err({ code: "unavailable" as const, message: "unreadable" })
        : values.has(name)
          ? ok(values.get(name)!)
          : err({ code: "not_found" as const, message: "no secret" }),
    put: async (name: string, value: unknown) => {
      values.set(name, String(value));
      return ok({ name, configured: true });
    },
    delete: async (name: string) => {
      values.delete(name);
      return ok({ name, configured: false });
    },
    names: () => ok([...values.keys()]),
  };
  return store;
}

function setup(secrets: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "lophn-vault-sync-"));
  const vault = createBrowserVault({ root, clock: manualClock(1_000) });
  return {
    root,
    vault,
    secrets: fakeSecrets(secrets),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

// 깨지면 이 컴퓨터의 사람 token, agent, 명단에서 빠진 컴퓨터, 나누기를 끈 컴퓨터에서 login 값이 나간다.
test("exchange는 지금 명단의 컴퓨터에만 값을 내고 사람 token, 빠진 컴퓨터, 나누기를 끈 때는 forbidden이다", () => {
  const t = setup({ [`login.${KEEP}.password`]: "pw-keep" });
  try {
    assert.ok(
      t.vault.update((vault) =>
        ok({ vault: { ...vault, logins: [meta(KEEP, 1)] }, value: null }),
      ).ok,
    );
    const handler = (computer: boolean, sharing: boolean) =>
      browserVaultExchangeHandler({
        vault: t.vault,
        secrets: t.secrets,
        isComputer: () => computer,
        sharing: () => sharing,
      });
    const code = (result: unknown) =>
      (result as { ok: boolean; error?: { code: string } }).ok
        ? "ok"
        : (result as { error: { code: string } }).error.code;
    const device = { principal: "device:dev_1" } as never;
    assert.equal(
      code(handler(true, true)({ principal: "user" } as never, {})),
      "forbidden",
    );
    assert.equal(code(handler(false, true)(device, {})), "forbidden");
    assert.equal(code(handler(true, false)(device, {})), "forbidden");
    const got = handler(true, true)(device, {}) as {
      ok: true;
      value: { logins: { password: string | null }[] };
    };
    assert.equal(got.value.logins[0]!.password, "pw-keep");
  } finally {
    t.done();
  }
});

// 깨지면 다른 컴퓨터에서 온 login의 값이 저장되지 않거나 지워진 login의 값이 남거나, vault에 없다는 것만으로 값이 지워진다.
test("받은 vault를 합치면 새 login의 값을 넣고 흔적이 있는 login의 값만 지운다", async () => {
  const t = setup({
    [`login.${KEEP}.password`]: "pw-keep",
    [`login.${GONE}.password`]: "pw-gone",
    [`login.lgn_${"9".repeat(26)}.password`]: "orphan",
  });
  try {
    assert.ok(
      t.vault.update((vault) =>
        ok({
          vault: { ...vault, logins: [meta(KEEP, 1), meta(GONE, 1)] },
          value: null,
        }),
      ).ok,
    );
    const changed = await applyRemoteVault(
      { vault: t.vault, secrets: t.secrets },
      {
        profiles: [],
        logins: [
          { ...meta(KEEP, 1), password: "pw-keep", totp: null },
          { ...meta(NEW, 5), password: "pw-new", totp: "SEED" },
        ],
        removed: [{ id: GONE, at: 6, seen: revs(1) }],
      },
    );
    assert.deepEqual(changed, { ok: true, value: true });
    assert.deepEqual(Object.fromEntries(t.secrets.values), {
      [`login.${KEEP}.password`]: "pw-keep",
      [`login.lgn_${"9".repeat(26)}.password`]: "orphan",
      [`login.${NEW}.password`]: "pw-new",
      [`login.${NEW}.totp`]: "SEED",
    });
    const read = t.vault.read();
    assert.ok(read.ok);
    assert.deepEqual(
      read.value.logins.map((login) => login.id),
      [KEEP, NEW],
    );
  } finally {
    t.done();
  }
});

// 깨지면 vault file이 없어지거나 비었을 때 첫 받기가 이 컴퓨터의 모든 저장 login 값을 지운다.
test("이 컴퓨터의 vault가 비어도 받기는 vault에 없는 login의 값을 지우지 않는다", async () => {
  const t = setup({
    [`login.${KEEP}.password`]: "pw-keep",
    [`login.${GONE}.totp`]: "SEED",
  });
  try {
    const changed = await applyRemoteVault(
      { vault: t.vault, secrets: t.secrets },
      {
        profiles: [],
        logins: [{ ...meta(KEEP, 1), password: "pw-keep", totp: null }],
        removed: [],
      },
    );
    assert.ok(changed.ok);
    assert.deepEqual(Object.fromEntries(t.secrets.values), {
      [`login.${KEEP}.password`]: "pw-keep",
      [`login.${GONE}.totp`]: "SEED",
    });
  } finally {
    t.done();
  }
});

// 깨지면 secrets.json을 못 읽는 컴퓨터가 값을 "없음"으로 내거나 합쳐, 다른 컴퓨터들이 저장 login 값을 지운다.
test("값을 못 읽으면 exchange는 unavailable이고 받기는 아무것도 쓰지 않는다", async () => {
  const t = setup({ [`login.${KEEP}.password`]: "pw-keep" });
  try {
    assert.ok(
      t.vault.update((vault) =>
        ok({ vault: { ...vault, logins: [meta(KEEP, 1)] }, value: null }),
      ).ok,
    );
    t.secrets.broken = true;
    const answer = browserVaultExchangeHandler({
      vault: t.vault,
      secrets: t.secrets,
      isComputer: () => true,
      sharing: () => true,
    })({ principal: "device:dev_1" } as never, {}) as {
      ok: boolean;
      error?: { code: string };
    };
    assert.equal(answer.error?.code, "unavailable");
    const before = t.vault.read();
    const merged = await applyRemoteVault(
      { vault: t.vault, secrets: t.secrets },
      {
        profiles: [],
        logins: [{ ...meta(NEW, 5), password: "pw-new", totp: null }],
        removed: [{ id: KEEP, at: 6, seen: revs(1) }],
      },
    );
    assert.equal(merged.ok ? "ok" : merged.error.code, "unavailable");
    const after = t.vault.read();
    assert.ok(before.ok && after.ok);
    assert.equal(after.value, before.value);
    assert.deepEqual(Object.fromEntries(t.secrets.values), {
      [`login.${KEEP}.password`]: "pw-keep",
    });
  } finally {
    t.done();
  }
});

// 깨지면 받기가 한 번 실패한 뒤 상대가 다시 뜨거나 바뀌어도 5분 timer까지 받지 않는다(profile 탭이 목록을 기다리며 비어 있다).
test("물러나는 동안 온 계기는 notBefore가 지난 뒤 한 번 받고, link가 붙으면 바로 받는다", async () => {
  const clock = manualClock(0);
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  // 때가 된 timer를 부른다(5분 timer는 넘지 않는다).
  const advance = async (ms: number) => {
    clock.advance(ms);
    for (const one of [...timers]) {
      if (one.live && one.at <= clock.nowMs()) {
        one.live = false;
        one.fn();
      }
    }
    await settle();
  };
  const PEER = `mch_${"1".repeat(26)}` as never;
  let pulls = 0;
  let failing = true;
  const sync = createVaultSync({
    merge: async () => ok(false),
    exchange: async () => {
      pulls += 1;
      return failing
        ? err({ code: "unavailable" as const, message: "down" })
        : ok({});
    },
    peers: () => [PEER],
    inRoster: () => true,
    sharing: () => true,
    changed: () => {},
    clock,
    wait(ms, fn) {
      const one = { at: clock.nowMs() + ms, fn, live: true };
      timers.push(one);
      return () => {
        one.live = false;
      };
    },
    logger: { warn() {}, info() {}, error() {}, debug() {} } as never,
  });
  sync.start();
  sync.ready(PEER);
  await settle();
  assert.equal(pulls, 1);
  // 물러나는 동안(1분) 온 계기 둘은 한 번으로 미뤄진다.
  failing = false;
  sync.peerChanged(PEER);
  await advance(2_000);
  sync.peerChanged(PEER);
  await advance(2_000);
  assert.equal(pulls, 1);
  await advance(BACKOFF_FIRST_MS);
  assert.equal(pulls, 2);
  await advance(BACKOFF_FIRST_MS);
  assert.equal(pulls, 2);

  // 다시 실패해 물러나는 중에 link가 붙으면 기다리지 않고 받는다.
  failing = true;
  sync.peerChanged(PEER);
  await advance(2_000);
  assert.equal(pulls, 3);
  failing = false;
  sync.ready(PEER);
  await settle();
  assert.equal(pulls, 4);
  // 풀린 물러나기의 미뤄 둔 받기는 남지 않는다.
  await advance(BACKOFF_FIRST_MS);
  assert.equal(pulls, 4);
  sync.stop();
});
