import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  seededRandom,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import { createHostQueue } from "../host-queue/mod.ts";
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
const PERSON = { actor: "user", conditions: {} } as never;
const SESSION = `ses_${"1".repeat(26)}`;
const AGENT = {
  actor: `agent:${SESSION}`,
  conditions: { session: SESSION },
} as never;
const WORK = `bpf_${"1".repeat(26)}`;
const SHOP = `bpf_${"2".repeat(26)}`;
// 탭 표의 가짜: `<주인>/<탭>` → profile. 없는 탭과 남의 탭은 not_found다.
const tabId = (n: number) => `tab_${String(n).repeat(26)}`;
const [TAB_WORK, TAB_DEFAULT, TAB_SHOP, TAB_NONE] = [1, 2, 3, 4].map(tabId);
const TABS: Record<string, string | null> = {
  [`${SESSION}/${TAB_WORK}`]: WORK,
  [`${SESSION}/${TAB_DEFAULT}`]: null,
  [`person/${TAB_SHOP}`]: SHOP,
};
const tabProfile = (tab: string, caller: string) =>
  Object.hasOwn(TABS, `${caller}/${tab}`)
    ? ok(TABS[`${caller}/${tab}`]!)
    : err({ code: "not_found" as const, message: "no such tab" });

// `agentProfile`은 SESSION의 agent 정의가 고른 profile이다.
async function setup(agentProfile: string | null = null) {
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
    save,
    root,
    list: loginsListHandler({
      logins,
      secrets,
      tabProfile,
      agentBrowserProfile: (session) =>
        ok(session === SESSION ? agentProfile : null),
    }),
    logins,
    secrets,
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
        profile: null,
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
      profile: null,
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
    const listed = await t.list(PERSON, {});
    assert.ok(listed.ok);
    assert.deepEqual(listed.value, [
      {
        id: t.id,
        label: "Example",
        origin: ORIGIN,
        username: "me",
        note: "",
        profile: null,
        totp: true,
      },
    ]);
    assert.ok(!JSON.stringify(listed).includes(PASSWORD));
    assert.ok(!JSON.stringify(listed).includes(SEED));
    const other = await t.list(PERSON, { origin: "https://other.test" });
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
    const listed = await t.list(PERSON, {});
    assert.deepEqual(listed.ok && listed.value, []);
  } finally {
    await t.done();
  }
});

// 깨지면 다른 profile의 탭(다른 cookie로 들어간 site)에 그 login의 값이 쳐진다.
test("release는 page의 profile과 login의 profile이 다르면 값을 내주지 않는다", async () => {
  const t = await setup();
  try {
    const saved = await t.save(CTX, {
      label: "Work",
      origin: ORIGIN,
      username: "me",
      profile: WORK,
    });
    assert.ok(saved.ok);
    const work = (saved.value as { id: string }).id;
    t.values.set(`login.${work}.password`, PASSWORD);
    const ask = (id: string, profile: string | null) =>
      t.release(CTX, {
        id,
        field: "password",
        origin: ORIGIN,
        profile,
        shell_capability: CAPABILITY,
      });
    for (const [id, profile] of [
      [work, null],
      [work, SHOP],
      [t.id, WORK],
    ] as const) {
      const refused = await ask(id, profile);
      assert.ok(!refused.ok);
      assert.equal(refused.error.code, "forbidden");
      assert.ok(!JSON.stringify(refused).includes(PASSWORD));
    }
    assert.deepEqual((await ask(work, WORK)).ok, true);
    assert.deepEqual((await ask(t.id, null)).ok, true);
  } finally {
    await t.done();
  }
});

// 깨지면 agent가 다른 profile의 login id를 받아 그 profile의 site 계정을 쓴다.
test("agent의 login list는 그 탭 profile의 login만 내고, 탭이 없으면 자기 정의의 profile, 사람은 탭이 없으면 전부다", async () => {
  const t = await setup(SHOP);
  try {
    const ids: Record<string, string> = { default: t.id };
    for (const [name, profile] of [
      ["work", WORK],
      ["shop", SHOP],
    ] as const) {
      const saved = await t.save(CTX, {
        label: name,
        origin: ORIGIN,
        username: "me",
        profile,
      });
      assert.ok(saved.ok);
      ids[name] = (saved.value as { id: string }).id;
    }
    const listed = async (who: never, input: object) => {
      const result = await t.list(who, input);
      assert.ok(result.ok, JSON.stringify(result));
      return (result.value as { id: string }[]).map((l) => l.id).sort();
    };
    assert.deepEqual(await listed(AGENT, { tab: TAB_WORK }), [ids.work]);
    assert.deepEqual(await listed(AGENT, { tab: TAB_DEFAULT }), [ids.default]);
    assert.deepEqual(await listed(AGENT, {}), [ids.shop]);
    assert.deepEqual(await listed(PERSON, { tab: TAB_SHOP }), [ids.shop]);
    assert.deepEqual(
      await listed(PERSON, {}),
      [ids.default, ids.work, ids.shop].sort(),
    );
    // 남의 탭(사람의 탭)과 없는 탭은 not_found다.
    for (const tab of [TAB_SHOP, TAB_NONE]) {
      const refused = await t.list(AGENT, { tab });
      assert.ok(!refused.ok);
      assert.equal(refused.error.code, "not_found");
    }
    // 고쳐도 profile은 그대로다.
    const edited = await t.save(CTX, {
      id: ids.work,
      label: "work",
      origin: ORIGIN,
      username: "me2",
      profile: SHOP,
    });
    assert.ok(edited.ok);
    assert.deepEqual(await listed(AGENT, { tab: TAB_WORK }), [ids.work]);
  } finally {
    await t.done();
  }
});

// 깨지면 이 판 전에 저장한 login이 읽히지 않거나(사람이 다시 넣어야 한다) 다른 profile의 탭에 나온다.
test("profile 칸이 없는 저장 login은 기본 profile의 login으로 읽히고 다른 profile의 탭에는 나오지 않는다", async () => {
  const t = await setup(WORK);
  try {
    const old = `lgn_${"0".repeat(26)}`;
    const path = `${t.root}/logins.json`;
    await writeFile(
      path,
      JSON.stringify([
        { id: old, label: "Old", origin: ORIGIN, username: "me", note: "" },
      ]),
    );
    const person = await t.list(PERSON, {});
    assert.ok(person.ok);
    assert.equal(
      (person.value as { profile: string | null }[])[0]!.profile,
      null,
    );
    const ids = async (input: object) => {
      const result = await t.list(AGENT, input);
      assert.ok(result.ok);
      return (result.value as { id: string }[]).map((l) => l.id);
    };
    assert.deepEqual(await ids({ tab: TAB_DEFAULT }), [old]);
    assert.deepEqual(await ids({ tab: TAB_WORK }), []);
    assert.deepEqual(await ids({}), []);
    // 다른 login을 저장해 file을 다시 써도 기본 profile의 항목에는 칸이 생기지 않는다.
    assert.ok(
      (
        await t.save(CTX, {
          label: "New",
          origin: ORIGIN,
          username: "me",
          profile: WORK,
        })
      ).ok,
    );
    const stored = JSON.parse(await readFile(path, "utf8")) as object[];
    assert.ok(!Object.hasOwn(stored[0]!, "profile"));
    assert.deepEqual(await ids({ tab: TAB_DEFAULT }), [old]);
  } finally {
    await t.done();
  }
});

// 깨지면 agent가 남의 탭 id로 그 탭 profile의 login을 보거나, 다른 profile의 agent가 자기 preview·artifact 탭에서 기본 profile의 login을 본다.
test("logins/list의 탭은 부른 쪽의 탭이어야 하고, browser 탭이 아닌 탭의 login은 기본 profile의 것이라 기본 profile의 agent와 사람만 본다", async () => {
  const t = await setup();
  try {
    const plain = `ses_${"2".repeat(26)}` as Id<"ses">;
    const worker = `ses_${"3".repeat(26)}` as Id<"ses">;
    const own: Record<string, string | null> = {
      [plain]: null,
      [worker]: WORK,
    };
    const clock = manualClock(0);
    const queue = createHostQueue({
      clock,
      ids: createIdSource({ clock, random: seededRandom(1) }),
    });
    const list = loginsListHandler({
      logins: t.logins,
      secrets: t.secrets,
      tabProfile: (tab, caller) =>
        queue.tabProfile(tab as Id<"tab">, caller as Id<"ses"> | "person"),
      agentBrowserProfile: (session) => ok(own[session] ?? null),
    });
    const saved = await t.save(CTX, {
      label: "Work account",
      origin: ORIGIN,
      username: "worker",
      profile: WORK,
    });
    assert.ok(saved.ok);
    const work = (saved.value as { id: string }).id;
    const place = (
      owner: Id<"ses"> | "person",
      target: Parameters<typeof queue.openTab>[0]["target"],
      profile?: Id<"bpf">,
    ) =>
      queue.openTab({
        owner,
        workspace: { kind: "project", id: `prj_${"1".repeat(26)}` as never },
        target,
        relation: null,
        source: null,
        ...(profile === undefined ? {} : { profile }),
      });
    const workerBrowser = place(
      worker,
      { browser: { url: ORIGIN } },
      WORK as Id<"bpf">,
    );
    const workerPreview = place(worker, {
      preview: { app: `app_${"1".repeat(26)}`, device: null, screen: null },
    });
    const plainArtifact = place(plain, { artifact: { name: "report" } });
    const personArtifact = place("person", { artifact: { name: "notes" } });
    const agentOf = (session: string) =>
      ({ actor: `agent:${session}`, conditions: { session } }) as never;
    const ids = async (who: never, tab: string) => {
      const result = await list(who, { tab });
      assert.ok(result.ok, JSON.stringify(result));
      return (result.value as { id: string }[]).map((l) => l.id);
    };
    assert.deepEqual(await ids(agentOf(worker), workerBrowser), [work]);
    assert.deepEqual(await ids(agentOf(plain), plainArtifact), [t.id]);
    assert.deepEqual(await ids(PERSON, personArtifact), [t.id]);
    assert.deepEqual(await ids(agentOf(worker), workerPreview), []);
    // 남의 탭은 없는 탭과 같고 login은 하나도 싣지 않는다.
    for (const [who, tab] of [
      [agentOf(plain), workerBrowser],
      [PERSON, workerBrowser],
      [agentOf(worker), plainArtifact],
    ] as const) {
      const refused = await list(who, { tab });
      assert.ok(!refused.ok);
      assert.equal(refused.error.code, "not_found");
      assert.ok(!JSON.stringify(refused).includes("Work account"));
    }
  } finally {
    await t.done();
  }
});
