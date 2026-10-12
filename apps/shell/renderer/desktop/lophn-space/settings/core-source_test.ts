// settings 통로(shell#T31). 일반 설정·skill 폴더·도구 server를 읽고 쓰는 route·입력·비교 기준과 secret
// 값이 이 통로를 지나지 않는다는 것을 가짜 core 위에서 본다. provider와 agent 기본값은 각자의 통로
// (providers/core-source, agents/core-source)가 맡는다.
import { assert, assertEquals } from "@std/assert";

import { mcpServersSetting } from "../../../../../../packages/contracts/lophn-agent/mod.ts";
import type { CoreReply } from "../../../../ipc/core-api.ts";
import { coreSettingsSource } from "./core-source.ts";
import type { ServerRow } from "./source.ts";
import {
  assertCallsFitRoutes,
  authStateAnswer,
  fail,
  fakeCore,
  HTTP_SERVER,
  OAUTH_SERVER,
  settingsAnswers,
  settingsCore,
} from "./testdata/fake-core.ts";

const NOW = Date.parse("2026-10-07T00:00:00.000Z");

const OPTIONS = {
  openWindow: undefined,
  picker: undefined,
  now: () => NOW,
  random: () => "r1",
};

Deno.test("shell/wording#R13: 설정은 정의와 현재 적용값·효력 시점·기본값을 합치고 확장 설정과 server의 credential 저장 여부(이름만)를 읽는다", async () => {
  const servers = [
    HTTP_SERVER("notes", "bearer", "sec:mcp-notes"),
    HTTP_SERVER("search", "api_key", "sec:mcp-search"),
    HTTP_SERVER("open", "none"),
  ];
  const { core, calls } = settingsCore(servers, ["/home/me/skills"]);
  const view = await coreSettingsSource(core, OPTIONS).settings();
  assert(view.ok);
  assertEquals(view.value.revision, 7);
  assertEquals(view.value.defaultsRevision, "d1");
  assertEquals(view.value.folders, ["/home/me/skills"]);
  const row = view.value.rows.find((r) => r.key === "shell.os_notifications")!;
  assertEquals(
    [row.title, row.value, row.changed, row.defaultValue, row.applyAt],
    ["Show a desktop notification.", true, true, false, "current_check"],
  );
  const unset = view.value.rows.find((r) => r.key === "unset.one")!;
  assertEquals([unset.resolved, unset.hasDefault, unset.changed], [
    false,
    false,
    false,
  ]);
  assertEquals(
    view.value.servers.map((s) => [s.name, s.auth, s.secret, s.credential]),
    [
      ["notes", "bearer", "mcp-notes", "set"],
      ["search", "api_key", "mcp-search", "missing"],
      ["open", "none", null, null],
    ],
  );
  const secrets = calls.find((call) => call.resource === "secrets")!;
  assertEquals(secrets.body, { names: ["mcp-notes", "mcp-search"] });
  // 값은 읽지 않는다. 이름과 저장 여부만이다.
  assert(!JSON.stringify(view.value).includes("Bearer"));
});

Deno.test("shell/wording#R10: skill 폴더는 OS 선택기가 준 폴더만 기존 목록 뒤에 더하고 읽은 비교 기준으로 적용하며 이미 있으면 다시 쓰지 않는다", async () => {
  const { core, calls } = settingsCore([], ["/home/me/old"]);
  const picks = ["/home/me/new", "/home/me/old", null];
  const source = coreSettingsSource(core, {
    ...OPTIONS,
    picker: {
      pick: () => Promise.resolve({ ok: true, path: picks.shift() ?? null }),
    },
  });
  const view = await source.settings();
  assert(view.ok);
  const added = await source.addSkillFolder(view.value);
  assertEquals(added, { ok: true, value: { path: "/home/me/new" } });
  const apply = calls.find((call) => call.method === "apply")!.body as Record<
    string,
    unknown
  >;
  assertEquals(apply.compare, { revision: 7, defaults_revision: "d1" });
  assertEquals(apply.input, {
    changes: [{
      layer: "common",
      key: "lophn-agent.extensions.skill_folders",
      action: "set",
      value: ["/home/me/old", "/home/me/new"],
    }],
  });
  const applies = () => calls.filter((call) => call.method === "apply").length;
  assertEquals(await source.addSkillFolder(view.value), {
    ok: true,
    value: { path: "/home/me/old" },
  });
  assertEquals(applies(), 1);
  assertEquals(await source.addSkillFolder(view.value), {
    ok: true,
    value: null,
  });
  assertEquals(applies(), 1);
  const none = coreSettingsSource(core, OPTIONS);
  assertEquals(await none.addSkillFolder(view.value), {
    ok: false,
    code: "unavailable",
  });
});

Deno.test("shell/wording#R10: 도구 server는 기존 설정 뒤에 stdio 또는 HTTP 설정으로 더하고 credential은 값 없이 이름 참조(sec:)로만 가리킨다", async () => {
  const existing = HTTP_SERVER("notes", "none");
  const { core, calls } = settingsCore([existing]);
  const source = coreSettingsSource(core, OPTIONS);
  const view = await source.settings();
  assert(view.ok);
  assert(
    (await source.addServer(view.value, {
      transport: "stdio",
      name: "files",
      executable: "/usr/bin/files-mcp",
      args: ["--root", "/docs"],
    })).ok,
  );
  assert(
    (await source.addServer(view.value, {
      transport: "http",
      name: "search",
      url: "https://search.example.com/mcp",
      auth: "api_key",
      header: "X-Api-Key",
    })).ok,
  );
  assert(
    (await source.addServer(view.value, {
      transport: "http",
      name: "wiki",
      url: "http://127.0.0.1:9000/mcp",
      auth: "bearer",
      header: null,
    })).ok,
  );
  const values = calls.filter((call) => call.method === "apply").map((call) => {
    const change = (call.body as { input: { changes: { value: unknown[] }[] } })
      .input.changes[0]!;
    return change.value;
  });
  assertEquals(values[0], [existing, {
    name: "files",
    revision: 1,
    enabled: true,
    call_timeout_ms: 60_000,
    classifications: {},
    transport: "stdio",
    stdio: {
      executable: "/usr/bin/files-mcp",
      args: ["--root", "/docs"],
      cwd: null,
      env: {},
    },
  }]);
  const search = values[1]![1] as { http: { auth: unknown } };
  assertEquals(search.http.auth, {
    kind: "api_key",
    secret_ref: "sec:mcp-search",
    header_name: "X-Api-Key",
  });
  const wiki = values[2]![1] as { http: { auth: unknown } };
  assertEquals(wiki.http.auth, { kind: "bearer", secret_ref: "sec:mcp-wiki" });
  // 설정 정의의 값 모양을 그대로 통과한다.
  for (const value of values) {
    assert(mcpServersSetting.value_type.safeParse(value).success);
  }
});

Deno.test("shell/wording#R10: 보내는 입력과 비교 기준은 contract route의 schema를 그대로 통과한다", async () => {
  const { core, calls } = fakeCore(settingsAnswers([]));
  const source = coreSettingsSource(core, {
    ...OPTIONS,
    picker: { pick: () => Promise.resolve({ ok: true, path: "/home/me/s" }) },
    openWindow: () => Promise.resolve({ windowId: "w1" }),
  });
  const view = await source.settings();
  assert(view.ok);
  await source.addSkillFolder(view.value);
  await source.addServer(view.value, {
    transport: "http",
    name: "wiki",
    url: "https://wiki.example.com/mcp",
    auth: "bearer",
    header: null,
  });
  await source.addServer(view.value, {
    transport: "stdio",
    name: "files",
    executable: "/usr/bin/files-mcp",
    args: [],
  });
  await source.enterServerCredential("mcp-wiki");
  assert(calls.length >= 5);
  assertCallsFitRoutes(calls);
});

const AUTH_URL =
  "https://auth.example.com/authorize?client_id=lophn-client&state=s1";

Deno.test("lophn-agent/extensions#R16 #R17 [agent-I52]: 켜진 OAuth server마다 core의 로그인 상태를 읽어 줄에 싣고, 상태는 끝난 세션이 아니라 core가 답한 값이며 token 이름은 묻지 않는다", async () => {
  const servers = [
    OAUTH_SERVER("fresh", null),
    OAUTH_SERVER("stored", "sec:mcp-oauth:global:stored"),
    OAUTH_SERVER("lost", "sec:mcp-oauth:global:lost"),
    OAUTH_SERVER("waiting", null),
    OAUTH_SERVER("off", null, false),
    HTTP_SERVER("plain", "none"),
  ];
  const { core, calls } = fakeCore({
    ...settingsAnswers(servers),
    "memory:agent-mcp-auth/state": authStateAnswer({
      stored: { state: "signed_in" },
      lost: { state: "failed", reason: "refresh_rejected" },
      waiting: { state: "in_progress" },
    }),
  });
  const view = await coreSettingsSource(core, OPTIONS).settings();
  assert(view.ok);
  const scopes = ["read", "write"];
  const sign = (
    state: string,
    reason: string | null = null,
  ) => ({ place: null, clientId: "lophn-client", scopes, state, reason });
  assertEquals(
    view.value.servers.map((row) => [row.name, row.signIn]),
    [
      ["fresh", sign("none")],
      ["stored", sign("signed_in")],
      ["lost", sign("failed", "refresh_rejected")],
      ["waiting", sign("in_progress")],
      ["off", null],
      ["plain", null],
    ],
  );
  // 켜진 OAuth server만 이름과 자리(전역은 null)로 한 번에 묻는다. token 값도 이름도 묻지 않는다.
  const states = calls.filter((call) => call.method === "state");
  assertEquals(states.length, 1);
  assertEquals([states[0]!.kind, states[0]!.resource], [
    "memory",
    "agent-mcp-auth",
  ]);
  assertEquals(states[0]!.body, {
    servers: ["fresh", "stored", "lost", "waiting"].map((name) => ({
      name,
      place: null,
    })),
  });
  assertEquals(calls.find((call) => call.resource === "secrets"), undefined);
  assertCallsFitRoutes(calls.filter((call) => call.method === "state"));
  assert(!JSON.stringify(view.value).includes("sec:"));
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: 로그인 상태를 읽지 못해도 설정 화면은 뜨고 그 줄은 상태를 모르는 채 로그인을 시작할 수 있다", async () => {
  const { core } = fakeCore({
    ...settingsAnswers([
      OAUTH_SERVER("fresh", null),
      HTTP_SERVER("plain", "none"),
    ]),
    "memory:agent-mcp-auth/state": () => fail("unavailable"),
  });
  const view = await coreSettingsSource(core, OPTIONS).settings();
  assert(view.ok);
  assertEquals(view.value.servers[0]!.signIn, {
    place: null,
    clientId: "lophn-client",
    scopes: ["read", "write"],
    state: "unknown",
    reason: null,
  });
  assertEquals(view.value.servers[1]!.signIn, null);
});

function authCore(answers: {
  begin?: () => CoreReply;
  complete?: () => CoreReply;
  cancel?: () => CoreReply;
} = {}) {
  return fakeCore({
    ...settingsAnswers([OAUTH_SERVER("fresh", null)]),
    "memory:agent-mcp-auth/state": authStateAnswer({}),
    "memory:agent-mcp-auth/cancel": answers.cancel ??
      (() => ({ ok: true, value: { cancelled: true } })),
    "memory:agent-mcp-auth/begin": answers.begin ??
      (() => ({ ok: true, value: { url: AUTH_URL, callback_port: 4321 } })),
    "memory:agent-mcp-auth/complete": answers.complete ??
      (() => ({ ok: true, value: { completed: true } })),
  });
}

const rowOf = async (
  source: ReturnType<typeof coreSettingsSource>,
): Promise<ServerRow> => {
  const view = await source.settings();
  assert(view.ok);
  return view.value.servers[0]!;
};

Deno.test("lophn-agent/extensions#R16 shell/app-frame#R7 [agent-I51]: 로그인을 시작하면 server 이름과 자리(전역은 null)·client_id·scopes로 BeginMcpAuth를 부르고 돌려받은 인증 주소를 OS browser로 연다", async () => {
  const { core, calls } = authCore();
  const opened: string[] = [];
  const source = coreSettingsSource(core, {
    ...OPTIONS,
    openLink: (url) => {
      opened.push(url);
      return Promise.resolve({ ok: true });
    },
  });
  const row = await rowOf(source);
  const begun = await source.beginSignIn(row);
  assertEquals(begun, { ok: true, value: { callbackPort: 4321 } });
  const begin = calls.find((call) => call.method === "begin")!;
  assertEquals([begin.kind, begin.resource], ["memory", "agent-mcp-auth"]);
  assertEquals(begin.body, {
    name: "fresh",
    place: null,
    client_id: "lophn-client",
    scopes: ["read", "write"],
  });
  assertEquals(opened, [AUTH_URL]);
  // 자리에 등록한 server는 그 자리를 그대로 싣는다.
  const place = { kind: "project", id: "prj_01k6qs0000000000000000000a" };
  await source.beginSignIn({
    ...row,
    signIn: { ...row.signIn!, place } as ServerRow["signIn"],
  });
  const second = calls.filter((call) => call.method === "begin")[1]!;
  assertEquals((second.body as { place: unknown }).place, place);
  assertCallsFitRoutes(calls.filter((call) => call.resource !== "settings"));
});

Deno.test("lophn-agent/extensions#R16 [agent-I51]: 로그인을 끝내면 같은 server와 자리·callback port로 CompleteMcpAuth를 부르고 거절된 반환은 실패다", async () => {
  const replies: CoreReply[] = [
    { ok: true, value: { completed: true } },
    { ok: true, value: { completed: false } },
    { ok: false, error: { code: "unavailable", message: "unavailable" } },
  ];
  const { core, calls } = authCore({ complete: () => replies.shift()! });
  const source = coreSettingsSource(core, OPTIONS);
  const row = await rowOf(source);
  assertEquals(await source.finishSignIn(row, 4321), {
    ok: true,
    value: null,
  });
  const complete = calls.find((call) => call.method === "complete")!;
  assertEquals([complete.kind, complete.resource], [
    "memory",
    "agent-mcp-auth",
  ]);
  assertEquals(complete.body, {
    name: "fresh",
    place: null,
    callback_port: 4321,
  });
  assertEquals(await source.finishSignIn(row, 4321), {
    ok: false,
    code: "rejected",
  });
  assertEquals(await source.finishSignIn(row, 4321), {
    ok: false,
    code: "unavailable",
  });
  assertCallsFitRoutes(calls.filter((call) => call.resource !== "settings"));
});

Deno.test("lophn-agent/extensions#R16 shell/app-frame#R7 [agent-I51]: 시작이 거절되면 그 오류가 가고 browser를 열지 않으며, 주소를 열지 못하면 not_opened다", async () => {
  const opened: string[] = [];
  const open = (ok: boolean) => (url: string) => {
    opened.push(url);
    return Promise.resolve(
      ok
        ? { ok: true as const }
        : { ok: false as const, code: "forbidden" as const },
    );
  };
  const refused = authCore({
    begin: () => ({
      ok: false,
      error: { code: "conflict", message: "conflict" },
    }),
  });
  const source = coreSettingsSource(refused.core, {
    ...OPTIONS,
    openLink: open(true),
  });
  const row = await rowOf(source);
  assertEquals(await source.beginSignIn(row), { ok: false, code: "conflict" });
  assertEquals(opened, []);

  // 시작이 거절되면 취소할 것이 없다.
  assertEquals(
    refused.calls.filter((call) => call.method === "cancel").length,
    0,
  );

  const good = authCore();
  const row2 = await rowOf(coreSettingsSource(good.core, OPTIONS));
  let cancels = 0;
  for (
    const openLink of [
      open(false),
      () => Promise.reject(new Error("boom")),
      undefined,
    ]
  ) {
    const failing = coreSettingsSource(good.core, { ...OPTIONS, openLink });
    assertEquals(await failing.beginSignIn(row2), {
      ok: false,
      code: "not_opened",
    });
    // 주소를 열지 못한 로그인은 core에 기다리는 채로 남지 않는다: 바로 그만둔다.
    cancels += 1;
    const sent = good.calls.filter((call) => call.method === "cancel");
    assertEquals(sent.length, cancels);
    assertEquals(sent.at(-1)!.body, { name: "fresh", place: null });
  }
  // 로그인이 필요하지 않은 줄은 core를 부르지 않는다.
  const before = good.calls.length;
  const plain = { ...row2, signIn: null };
  assertEquals(await source.beginSignIn(plain), {
    ok: false,
    code: "invalid_input",
  });
  assertEquals(await source.finishSignIn(plain, 1), {
    ok: false,
    code: "invalid_input",
  });
  assertEquals(good.calls.length, before);
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: 기다리는 로그인을 그만두면 같은 server와 자리로 CancelMcpAuth를 부르고 로그인이 필요하지 않은 줄은 core를 부르지 않는다", async () => {
  const { core, calls } = authCore();
  const source = coreSettingsSource(core, OPTIONS);
  const row = await rowOf(source);
  assertEquals(await source.cancelSignIn(row), { ok: true, value: null });
  const cancel = calls.find((call) => call.method === "cancel")!;
  assertEquals([cancel.kind, cancel.resource], ["memory", "agent-mcp-auth"]);
  assertEquals(cancel.body, { name: "fresh", place: null });
  // 자리에 등록한 server는 그 자리를 싣는다.
  const place = { kind: "project", id: "prj_01k6qs0000000000000000000a" };
  await source.cancelSignIn({
    ...row,
    signIn: { ...row.signIn!, place } as ServerRow["signIn"],
  });
  assertEquals(
    (calls.filter((call) => call.method === "cancel")[1]!.body as {
      place: unknown;
    }).place,
    place,
  );
  assertCallsFitRoutes(calls.filter((call) => call.method === "cancel"));
  // 실패는 그 오류 code가 간다.
  const refused = authCore({ cancel: () => fail("forbidden") });
  const second = coreSettingsSource(refused.core, OPTIONS);
  assertEquals(await second.cancelSignIn(await rowOf(second)), {
    ok: false,
    code: "forbidden",
  });
  // 로그인이 필요하지 않은 줄은 core를 부르지 않는다.
  const before = calls.length;
  assertEquals(await source.cancelSignIn({ ...row, signIn: null }), {
    ok: false,
    code: "invalid_input",
  });
  assertEquals(calls.length, before);
});
