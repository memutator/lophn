// settings 통로(shell#T31). 일반 설정·skill 폴더·도구 server를 읽고 쓰는 route·입력·비교 기준과 secret
// 값이 이 통로를 지나지 않는다는 것을 가짜 core 위에서 본다. provider와 agent 기본값은 각자의 통로
// (providers/core-source, agents/core-source)가 맡는다.
import { assert, assertEquals } from "@std/assert";

import { mcpServersSetting } from "../../../../../../packages/contracts/lophn-agent/mod.ts";
import { coreSettingsSource } from "./core-source.ts";
import {
  assertCallsFitRoutes,
  fakeCore,
  HTTP_SERVER,
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
