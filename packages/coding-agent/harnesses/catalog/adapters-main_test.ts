// Claude Code·Codex·OpenCode·Gemini CLI adapter 테스트다(coding-agent/
// harnesses#R8, R11, guides#R5, R13, R18, cli#R9, connection#R1, R14, T30).
// 모든 HOME·CODEX_HOME·XDG·project·lophn home은 temp fixture이고 사람의 실제
// 설정 root는 열지 않는다.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type {
  HarnessId,
  IntegrationTarget,
} from "../../../contracts/coding-agent/mod.ts";
import { type BuildInput, buildResources } from "../builder.ts";
import { type LaunchInputs, launchOf } from "../launch.ts";
import { rootOf } from "../resolvers.ts";
import { skillGuidanceOf, skillShadowsOf } from "../skills.ts";
import { install, observe } from "../integration/apply.ts";
import { planOf } from "../integration/plan.ts";
import { remove } from "../integration/remove.ts";
import { filePort, storeOf } from "../integration/journal.ts";
import { catalogOf } from "./definitions.ts";

const NOW = "2026-10-06T00:00:00.000Z";
const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";

type Fixture = {
  home: string;
  project: string;
  lophn: string;
  env: Map<string, string>;
};

async function fixture(): Promise<Fixture> {
  const base = await Deno.makeTempDir({ prefix: "lophn-t30-" });
  const home = `${base}/home`;
  const project = `${base}/project`;
  const lophn = `${base}/lophn-home`;
  for (const dir of [home, project, lophn]) {
    await Deno.mkdir(dir, { recursive: true });
  }
  return { home, project, lophn, env: new Map() };
}

async function write(path: string, text: string): Promise<void> {
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(path, text);
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return null;
  }
}

const LAUNCH: LaunchInputs = {
  executable: "/opt/lophn/bin/deno",
  resources: "/opt/lophn/resources",
  cache: "/opt/lophn/cache",
  discoveryFiles: ["/opt/lophn/run/daemon.json"],
  submissionRoot: "/work/app",
  coreAddress: "127.0.0.1:7431",
  appAddresses: [],
  connection: CAC,
  toolsets: "core,app",
};

function target(harness: HarnessId, scope: "user" | "app", fx: Fixture) {
  const value: IntegrationTarget = scope === "app"
    ? {
      scope_kind: "app",
      environment: { kind: "host", identity: "fixture" },
      profile_id: null,
      harness_id: harness,
      app: "app_01h455vb4pex5v6nkc6gd5fdw1",
      app_realpath: fx.project,
    }
    : {
      scope_kind: "user",
      environment: { kind: "host", identity: "fixture" },
      profile_id: null,
      harness_id: harness,
      app: null,
      app_realpath: null,
    };
  return value;
}

function definitionOf(id: HarnessId) {
  const found = catalogOf(id);
  assert(found !== undefined);
  return found!;
}

// 읽은 현재 text를 builder 입력으로 모은다. root 기준 상대 경로 key다.
async function observeCurrent(
  fx: Fixture,
  harness: HarnessId,
  paths: string[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const path of paths) {
    out[path] = (await readOrNull(`${fx.project}/${path}`)) ??
      (await readOrNull(`${fx.home}/${path}`));
  }
  void harness;
  return out;
}

type Installed = {
  outcomes: Record<string, string>;
  notices: string[];
};

async function installAll(
  fx: Fixture,
  harness: HarnessId,
  scope: "user" | "app",
  extra: Partial<BuildInput> = {},
): Promise<Installed> {
  const definition = definitionOf(harness);
  const built = buildResources({
    definition,
    scope,
    launch: launchOf(LAUNCH),
    version: null,
    current: {},
    ...extra,
  });
  const store = storeOf(fx.lophn);
  const outcomes: Record<string, string> = {};
  for (const group of built.groups) {
    const root = rootOf(group.root_resolver, {
      home: fx.home,
      env: fx.env,
      cwd: fx.project,
    });
    assert(root.ok);
    if (!root.ok) continue;
    const plan = planOf({
      definition,
      target: target(harness, scope, fx),
      connection: CAC,
      resources: group.resources,
    });
    assert(plan.ok);
    if (!plan.ok) continue;
    const seen = await observe(filePort(), root.value, plan.value);
    assert(typeof seen !== "string");
    if (typeof seen === "string") continue;
    const applied = await install(
      filePort(),
      store,
      root.value,
      plan.value,
      seen,
      `op-${group.root_resolver}`,
      NOW,
    );
    for (const item of applied.resources) {
      outcomes[item.resource_identity] = item.outcome;
    }
  }
  return { outcomes, notices: built.notices };
}

const SKILL = {
  name: "lophn",
  files: [
    { path: "SKILL.md", content: "# lophn\n" },
    { path: "notes.md", content: "helper\n" },
  ],
};

Deno.test("coding-agent/harnesses#R8: Claude user는 ~/.claude.json의 mcpServers.lophn만 넣고 기존 server·permission을 보존한다", async () => {
  const fx = await fixture();
  await write(
    `${fx.home}/.claude.json`,
    JSON.stringify({
      mcpServers: { other: { command: "keep", env: { A: "1" } } },
      permissions: { allow: ["Bash"] },
    }),
  );
  const done = await installAll(fx, "claude", "user", { skill: SKILL });
  assertEquals(done.outcomes["mcp:user"], "changed");
  const parsed = JSON.parse((await readOrNull(`${fx.home}/.claude.json`))!);
  assertEquals(parsed.mcpServers.other, {
    command: "keep",
    env: { A: "1" },
  });
  assertEquals(parsed.permissions.allow, ["Bash"]);
  assertEquals(parsed.mcpServers.lophn.command, "/opt/lophn/bin/deno");
  assertEquals(parsed.mcpServers.lophn.args.includes("--connection"), true);
  // skill은 ~/.claude/skills에 본문과 보조 자료가 함께 간다(guides#R5).
  assertEquals(
    await readOrNull(`${fx.home}/.claude/skills/lophn/SKILL.md`),
    "# lophn\n",
  );
  assertEquals(
    await readOrNull(`${fx.home}/.claude/skills/lophn/notes.md`),
    "helper\n",
  );
});

Deno.test("coding-agent/connection#R1: Claude app은 .mcp.json에 설치하고 동명 사람 항목은 conflict로 둔다", async () => {
  const fx = await fixture();
  const human = JSON.stringify({
    mcpServers: { lophn: { command: "mine" } },
  });
  await write(`${fx.project}/.mcp.json`, human);
  const done = await installAll(fx, "claude", "app");
  assertEquals(done.outcomes["mcp:app"], "conflict");
  assertEquals(await readOrNull(`${fx.project}/.mcp.json`), human);
});

Deno.test("coding-agent/guides#R13: Claude CLAUDE.md는 관리 구간 안 @AGENTS.md만 쓰고 바깥 bytes를 보존한다", async () => {
  const fx = await fixture();
  const before =
    "# mine\n\n@docs/extra.md\n\n<!-- begin lophn-managed -->\n<!-- end lophn-managed -->\n\n끝\n";
  await write(`${fx.project}/CLAUDE.md`, before);
  const current = await observeCurrent(fx, "claude", ["CLAUDE.md"]);
  const done = await installAll(fx, "claude", "app", { current });
  assertEquals(done.outcomes["instruction:region"], "changed");
  const after = (await readOrNull(`${fx.project}/CLAUDE.md`))!;
  assertEquals(
    after,
    "# mine\n\n@docs/extra.md\n\n<!-- begin lophn-managed -->\n@AGENTS.md\n<!-- end lophn-managed -->\n\n끝\n",
  );
});

Deno.test("coding-agent/guides#R13: marker 없는 CLAUDE.md와 없는 CLAUDE.md는 무변경이다", async () => {
  const fx = await fixture();
  await write(`${fx.project}/CLAUDE.md`, "# 사람이 쓴 것\n");
  const current = await observeCurrent(fx, "claude", ["CLAUDE.md"]);
  const done = await installAll(fx, "claude", "app", { current });
  assertEquals(done.outcomes["instruction:region"], undefined);
  assertEquals(
    await readOrNull(`${fx.project}/CLAUDE.md`),
    "# 사람이 쓴 것\n",
  );
  assert(done.notices.some((text) => text.includes("관리 구간이 없어")));
  const fresh = await fixture();
  const none = await installAll(fresh, "claude", "app", { current: {} });
  assertEquals(await readOrNull(`${fresh.project}/CLAUDE.md`), null);
  assert(none.notices.length > 0);
});

Deno.test("coding-agent/harnesses#R11: Claude SessionStart는 검증 version 이상일 때 settings.local.json의 lophn 항목만 넣는다", async () => {
  const fx = await fixture();
  await write(
    `${fx.project}/.claude/settings.local.json`,
    JSON.stringify({
      permissions: { allow: ["Read"] },
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "mine" }] }],
        Stop: [{ hooks: [{ type: "command", command: "keep" }] }],
      },
    }),
  );
  const done = await installAll(fx, "claude", "app", {
    version: "2.1.0",
    hookArgv: ["/opt/lophn/bin/lophn", "hook", "session-summary"],
  });
  assertEquals(done.outcomes["hook:SessionStart"], "changed");
  const parsed = JSON.parse(
    (await readOrNull(`${fx.project}/.claude/settings.local.json`))!,
  );
  assertEquals(parsed.permissions.allow, ["Read"]);
  assertEquals(parsed.hooks.Stop[0].hooks[0].command, "keep");
  assertEquals(parsed.hooks.SessionStart.length, 2);
  assertEquals(parsed.hooks.SessionStart[0].hooks[0].command, "mine");
  assertStringIncludes(
    parsed.hooks.SessionStart[1].hooks[0].command,
    "lophn-summary-hook",
  );
  // status event는 검증하지 않아 설치되지 않는다.
  assertEquals(parsed.hooks.PermissionRequest, undefined);
});

Deno.test("coding-agent/harnesses#R11: version을 모르거나 낮으면 Claude hook을 쓰지 않는다", async () => {
  for (const version of [null, "1.0.30"]) {
    const fx = await fixture();
    const done = await installAll(fx, "claude", "app", {
      version,
      hookArgv: ["/opt/lophn/bin/lophn", "hook"],
    });
    assertEquals(done.outcomes["hook:SessionStart"], undefined);
    assertEquals(
      await readOrNull(`${fx.project}/.claude/settings.local.json`),
      null,
    );
    assert(done.notices.some((text) => text.includes("SessionStart")));
  }
  // catalog의 event는 제품별이고 version이 같이 있다.
  const events = definitionOf("claude").hooks.map((hook) =>
    `${hook.event}@${hook.minimum_version}`
  );
  assertEquals(events, [
    "SessionStart@1.0.62",
    "PermissionRequest@2.0.45",
    "PostCompact@2.1.76",
  ]);
});

Deno.test("coding-agent/harnesses#R8: Codex는 effective CODEX_HOME의 config.toml mcp_servers.lophn만 receipt와 함께 쓴다", async () => {
  const fx = await fixture();
  const codexHome = `${fx.home}/custom-codex`;
  fx.env.set("CODEX_HOME", codexHome);
  const before =
    '# my config\nmodel = "x"\n\n[mcp_servers.other]\ncommand = "keep"\n\n[projects."/a"]\ntrust_level = "trusted"\n';
  await write(`${codexHome}/config.toml`, before);
  const done = await installAll(fx, "codex", "user", { skill: SKILL });
  assertEquals(done.outcomes["mcp:user"], "changed");
  const after = (await readOrNull(`${codexHome}/config.toml`))!;
  assert(after.startsWith(before.trimEnd()));
  assertStringIncludes(after, "[mcp_servers.lophn]");
  assertStringIncludes(after, 'LOPHN_CONNECTION = "cac_');
  // 기본 ~/.codex는 만들지 않는다.
  assertEquals(await readOrNull(`${fx.home}/.codex/config.toml`), null);
  // skill은 ~/.agents/skills다.
  assertEquals(
    await readOrNull(`${fx.home}/.agents/skills/lophn/SKILL.md`),
    "# lophn\n",
  );
  const receipt = await storeOf(fx.lophn).receipt(
    target("codex", "user", fx),
  );
  assert(receipt !== null);
  assertEquals(
    receipt!.resources.map((item) => item.canonical_identity).sort(),
    ["mcp:user", "skill:user:lophn"],
  );
});

Deno.test("coding-agent/guides#R18: Codex 사람이 고친 lophn 표는 덮지 않고 conflict이며 앱 TOML은 만들지 않는다", async () => {
  const fx = await fixture();
  await installAll(fx, "codex", "user");
  const path = `${fx.home}/.codex/config.toml`;
  const installed = (await readOrNull(path))!;
  const edited = installed.replace("--cached-only", "--edited");
  await write(path, edited);
  const again = await installAll(fx, "codex", "user", {
    // 같은 조각을 다시 계획해도 사람이 고친 hash는 conflict다.
  });
  assertEquals(again.outcomes["mcp:user"], "conflict");
  assertEquals(await readOrNull(path), edited);
  const app = await installAll(fx, "codex", "app", { skill: SKILL });
  assertEquals(app.outcomes["mcp:app"], undefined);
  assertEquals(await readOrNull(`${fx.project}/.codex/config.toml`), null);
  assertEquals(await readOrNull(`${fx.project}/config.toml`), null);
  assert(app.notices.some((text) => text.includes("MCP 설정 파일을 만들지")));
});

Deno.test("coding-agent/guides#R13: Codex는 AGENTS.override.md가 정본을 가리는 것을 알리고 AGENTS.md는 고치지 않는다", async () => {
  const fx = await fixture();
  await write(`${fx.project}/AGENTS.md`, "# 정본\n");
  await write(`${fx.project}/AGENTS.override.md`, "# override\n");
  const current = await observeCurrent(fx, "codex", ["AGENTS.override.md"]);
  const done = await installAll(fx, "codex", "app", { current });
  assert(done.notices.some((text) => text.includes("AGENTS.override.md")));
  assertEquals(await readOrNull(`${fx.project}/AGENTS.md`), "# 정본\n");
});

Deno.test("coding-agent/harnesses#R8: OpenCode는 XDG opencode.json의 mcp.lophn(type local, command 배열, environment)을 쓰고 rules를 보존한다", async () => {
  const fx = await fixture();
  fx.env.set("XDG_CONFIG_HOME", `${fx.home}/xdg`);
  await write(
    `${fx.home}/xdg/opencode/opencode.json`,
    JSON.stringify({
      instructions: ["rules/a.md"],
      mcp: { other: { type: "local", command: ["x"] } },
    }),
  );
  const done = await installAll(fx, "opencode", "user", { skill: SKILL });
  assertEquals(done.outcomes["mcp:user"], "changed");
  const parsed = JSON.parse(
    (await readOrNull(`${fx.home}/xdg/opencode/opencode.json`))!,
  );
  assertEquals(parsed.instructions, ["rules/a.md"]);
  assertEquals(parsed.mcp.other.command, ["x"]);
  assertEquals(parsed.mcp.lophn.type, "local");
  assertEquals(parsed.mcp.lophn.command[0], "/opt/lophn/bin/deno");
  assertEquals(parsed.mcp.lophn.environment.LOPHN_CONNECTION, CAC);
  assertEquals(
    await readOrNull(`${fx.home}/xdg/opencode/skills/lophn/SKILL.md`),
    "# lophn\n",
  );
  // app은 프로젝트 opencode.json과 .opencode/skills다.
  const app = await installAll(fx, "opencode", "app", { skill: SKILL });
  assertEquals(app.outcomes["mcp:app"], "changed");
  assertEquals(
    await readOrNull(`${fx.project}/.opencode/skills/lophn/SKILL.md`),
    "# lophn\n",
  );
});

Deno.test("coding-agent/guides#R5: OpenCode는 다른 발견 root의 동명 skill을 가림·가려짐 conflict로 낸다", () => {
  const opencode = definitionOf("opencode");
  const found = skillShadowsOf(opencode, "app", "lophn", [
    {
      scope_kind: "app",
      root_resolver: "project",
      path: ".claude/skills",
      names: ["lophn"],
    },
    {
      scope_kind: "user",
      root_resolver: "home",
      path: ".agents/skills",
      names: ["lophn", "other"],
    },
    {
      scope_kind: "app",
      root_resolver: "project",
      path: ".agents/skills",
      names: ["unrelated"],
    },
  ]);
  assertEquals(found.length, 2);
  assertEquals(found.map((item) => item.path).sort(), [
    ".agents/skills",
    ".claude/skills",
  ]);
  for (const item of found) assertEquals(item.relation, "shadows");
  // Gemini는 `.agents/skills`가 `.gemini/skills`보다 위라 lophn skill이 가려진다.
  const gemini = definitionOf("gemini");
  const hidden = skillShadowsOf(gemini, "app", "lophn", [{
    scope_kind: "app",
    root_resolver: "project",
    path: ".agents/skills",
    names: ["lophn"],
  }]);
  assertEquals(hidden.map((item) => item.relation), ["shadowed_by"]);
  // user 설치에서 app root는 이 session 밖이다.
  assertEquals(
    skillShadowsOf(gemini, "user", "lophn", [{
      scope_kind: "app",
      root_resolver: "project",
      path: ".agents/skills",
      names: ["lophn"],
    }]),
    [],
  );
});

Deno.test("coding-agent/guides#R5: 제품별 skill 발견 위치와 trust 안내가 있고 동명 skill은 자동 교체하지 않는다", async () => {
  for (const id of ["claude", "codex", "opencode", "gemini"] as const) {
    const notes = skillGuidanceOf(definitionOf(id));
    assertStringIncludes(notes[0], definitionOf(id).label);
  }
  for (const id of ["claude", "codex", "gemini"] as const) {
    assertEquals(skillGuidanceOf(definitionOf(id)).length, 2, id);
  }
  const fx = await fixture();
  await write(`${fx.home}/.claude/skills/lophn/SKILL.md`, "# mine\n");
  const done = await installAll(fx, "claude", "user", { skill: SKILL });
  assertEquals(done.outcomes["skill:user:lophn"], "conflict");
  assertEquals(
    await readOrNull(`${fx.home}/.claude/skills/lophn/SKILL.md`),
    "# mine\n",
  );
});

Deno.test("coding-agent/guides#R13: Gemini는 기존 context.fileName 목록을 보존하고 AGENTS.md만 더하며 trust를 만들지 않는다", async () => {
  const fx = await fixture();
  const path = `${fx.home}/.gemini/settings.json`;
  await write(
    path,
    JSON.stringify({
      context: { fileName: ["GEMINI.md", "NOTES.md"] },
      mcpServers: { other: { command: "keep", trust: true } },
    }),
  );
  const current = await observeCurrent(fx, "gemini", [
    ".gemini/settings.json",
  ]);
  const done = await installAll(fx, "gemini", "user", { current });
  assertEquals(done.outcomes["mcp:user"], "changed");
  assertEquals(done.outcomes["instruction:user"], "changed");
  const parsed = JSON.parse((await readOrNull(path))!);
  assertEquals(parsed.context.fileName, ["GEMINI.md", "NOTES.md", "AGENTS.md"]);
  assertEquals(parsed.mcpServers.other, { command: "keep", trust: true });
  assertEquals(parsed.mcpServers.lophn.trust, undefined);
  assertEquals("hooks" in parsed, false);
});

Deno.test("coding-agent/guides#R13: Gemini fileName이 문자열이거나 이미 AGENTS.md가 있으면 값을 잃지 않는다", async () => {
  const fx = await fixture();
  const path = `${fx.home}/.gemini/settings.json`;
  await write(path, JSON.stringify({ context: { fileName: "GEMINI.md" } }));
  await installAll(fx, "gemini", "user", {
    current: { ".gemini/settings.json": await readOrNull(path) },
  });
  assertEquals(JSON.parse((await readOrNull(path))!).context.fileName, [
    "GEMINI.md",
    "AGENTS.md",
  ]);
  const second = await fixture();
  const path2 = `${second.home}/.gemini/settings.json`;
  await write(path2, JSON.stringify({ context: { fileName: ["AGENTS.md"] } }));
  const done = await installAll(second, "gemini", "user", {
    current: { ".gemini/settings.json": await readOrNull(path2) },
  });
  assertEquals(done.outcomes["instruction:user"], undefined);
  assert(done.notices.some((text) => text.includes("이미 있어")));
  assertEquals(JSON.parse((await readOrNull(path2))!).context.fileName, [
    "AGENTS.md",
  ]);
});

Deno.test("coding-agent/guides#R13: 깨진 Gemini settings는 무변경이다", async () => {
  const fx = await fixture();
  const path = `${fx.home}/.gemini/settings.json`;
  await write(path, "{ broken");
  const done = await installAll(fx, "gemini", "user", {
    current: { ".gemini/settings.json": "{ broken" },
  });
  assertEquals(done.outcomes["mcp:user"], "conflict");
  assertEquals(done.outcomes["instruction:user"], "conflict");
  assertEquals(await readOrNull(path), "{ broken");
});

Deno.test("coding-agent/connection#R1: Gemini scope는 사람이 고른 user 또는 app이고 기본 project를 따르지 않는다", async () => {
  const fx = await fixture();
  const user = await installAll(fx, "gemini", "user");
  assertEquals(user.outcomes["mcp:user"], "changed");
  assertEquals(await readOrNull(`${fx.project}/.gemini/settings.json`), null);
  const app = await installAll(fx, "gemini", "app");
  assertEquals(app.outcomes["mcp:app"], "changed");
  assert(
    (await readOrNull(`${fx.project}/.gemini/settings.json`))!.includes(
      "mcpServers",
    ),
  );
});

Deno.test("coding-agent/harnesses#R11: Gemini hook event는 Claude와 다른 이름이고 검증 전이라 설치하지 않는다", async () => {
  const gemini = definitionOf("gemini");
  assertEquals(gemini.hooks.map((hook) => hook.event), [
    "SessionStart",
    "BeforeTool",
  ]);
  for (const hook of gemini.hooks) assertEquals(hook.capability, "unverified");
  const fx = await fixture();
  const done = await installAll(fx, "gemini", "user", {
    version: "9.9.9",
    hookArgv: ["/opt/lophn/bin/lophn", "hook"],
  });
  assertEquals(done.outcomes["hook:SessionStart"], undefined);
  const parsed = JSON.parse(
    (await readOrNull(`${fx.home}/.gemini/settings.json`))!,
  );
  assertEquals("hooks" in parsed, false);
});

Deno.test("coding-agent/connection#R14: 제거는 receipt의 lophn 소유 조각만 지우고 사람 항목은 남긴다", async () => {
  const fx = await fixture();
  const path = `${fx.home}/.gemini/settings.json`;
  await write(
    path,
    JSON.stringify({
      context: { fileName: ["GEMINI.md"] },
      mcpServers: { other: { command: "keep" } },
    }),
  );
  const current = await observeCurrent(fx, "gemini", [
    ".gemini/settings.json",
  ]);
  await installAll(fx, "gemini", "user", { current });
  const definition = definitionOf("gemini");
  const built = buildResources({
    definition,
    scope: "user",
    launch: launchOf(LAUNCH),
    version: null,
    current,
  });
  const plan = planOf({
    definition,
    target: target("gemini", "user", fx),
    connection: CAC,
    resources: built.groups[0].resources,
  });
  assert(plan.ok);
  if (!plan.ok) return;
  const removed = await remove(
    filePort(),
    storeOf(fx.lophn),
    fx.home,
    plan.value,
    "op-remove",
    NOW,
  );
  assertEquals(removed.resources.map((item) => item.outcome), [
    "changed",
    "changed",
  ]);
  const parsed = JSON.parse((await readOrNull(path))!);
  assertEquals(parsed.context.fileName, ["GEMINI.md"]);
  assertEquals(parsed.mcpServers, { other: { command: "keep" } });
});
