// 네 loading 관측 테스트다(coding-agent/harnesses#R3, R10, connection#R13·R14,
// T32). 모든 HOME·project·lophn home은 temp fixture이고 실제 harness binary나
// 사람의 설정 root는 열지 않는다. MCP server는 testing/mcp-fixture.ts 대역을
// 설치된 Deno executable로 띄운다.
import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { filePort } from "./integration/journal.ts";
import {
  type LoadingInput,
  type LoadingReport,
  observeLoading,
} from "./loading.ts";
import { stdioMcpProbe } from "./mcp-probe.ts";
import {
  CAC,
  type Fixture,
  fixture,
  fixtureLaunch,
  inputOf,
  rootFor,
  SKILLS,
  snapshot,
  snapshotAll,
  write,
  writeGuide,
  writeMcpConfig,
  writeSkills,
} from "./testing/mod.ts";

function probeFor(fx: Fixture, timeout_ms = 8_000) {
  const ambient: Record<string, string> = {
    PATH: "/usr/bin:/bin",
    HOME: fx.home,
    DENO_DIR: `${fx.base}/deno`,
  };
  return stdioMcpProbe({ timeout_ms, ambient: (name) => ambient[name] });
}

async function run(
  fx: Fixture,
  input: LoadingInput,
  timeout_ms?: number,
): Promise<LoadingReport[]> {
  return await observeLoading(input, {
    files: filePort(),
    mcp: probeFor(fx, timeout_ms),
  });
}

function stage(reports: LoadingReport[], name: string): LoadingReport {
  const found = reports.find((item) => item.stage === name);
  assert(found !== undefined, `stage ${name}`);
  return found!;
}

function results(reports: LoadingReport[]): string[] {
  return reports.map((item) => `${item.stage}:${item.result}`);
}

// Claude 앱 범위가 네 단계 모두 읽히는 fixture다.
async function claudeApp(fx: Fixture, mode = "ok"): Promise<void> {
  await writeMcpConfig(fx, "claude", "app", fixtureLaunch(mode));
  await writeSkills(`${fx.project}/.claude/skills`, SKILLS);
  await writeGuide(fx, "claude");
}

Deno.test("coding-agent/harnesses#R10: 설치된 MCP와 skill·안내가 있으면 네 단계가 각각 success다", async () => {
  const fx = await fixture();
  try {
    await claudeApp(fx);
    const reports = await run(
      fx,
      inputOf(fx, "claude", "app", { trust: "trusted" }),
    );
    assertEquals(results(reports), [
      "mcp_initialize:success",
      "tool_discovery:success",
      "skill_discovery:success",
      "app_guide_loading:success",
    ]);
    // 네 단계는 한 번씩이고 모두 다음 확인을 가진다.
    assertEquals(reports.length, 4);
    for (const report of reports) assert(report.next !== "");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/harnesses#R3: 설정 파일이 있어도 server가 못 뜨면 mcp_initialize는 failure이고 tool은 unknown이다", async () => {
  const fx = await fixture();
  try {
    await claudeApp(fx, "crash");
    const reports = await run(
      fx,
      inputOf(fx, "claude", "app", { trust: "trusted" }),
    );
    const init = stage(reports, "mcp_initialize");
    assertEquals(init.result, "failure");
    assertStringIncludes(init.reason, "exit code 3");
    // 초기화를 모르면 tool 발견은 성공도 실패도 아닌 unknown이다.
    assertEquals(stage(reports, "tool_discovery").result, "unknown");
    // 다른 단계는 이 실패에 끌려가지 않는다.
    assertEquals(stage(reports, "skill_discovery").result, "success");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/harnesses#R3: 응답 timeout은 성공도 실패도 아닌 unknown이다", async () => {
  const fx = await fixture();
  try {
    await claudeApp(fx, "hang");
    const hung = await run(
      fx,
      inputOf(fx, "claude", "app", { trust: "trusted" }),
      400,
    );
    assertEquals(stage(hung, "mcp_initialize").result, "unknown");
    assertStringIncludes(stage(hung, "mcp_initialize").reason, "시간이 초과");
    assertEquals(stage(hung, "tool_discovery").result, "unknown");

    // initialize는 되고 tools/list만 멈추면 앞 단계는 success로 남는다.
    await writeMcpConfig(fx, "claude", "app", fixtureLaunch("tools-hang"));
    const half = await run(
      fx,
      inputOf(fx, "claude", "app", { trust: "trusted" }),
      1_500,
    );
    assertEquals(stage(half, "mcp_initialize").result, "success");
    assertEquals(stage(half, "tool_discovery").result, "unknown");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/harnesses#R10: initialize 거절·tools/list 거절·빈 목록·없는 tool·잘못된 응답을 단계별로 가른다", async () => {
  const fx = await fixture();
  try {
    const cases: [string, readonly string[], string, string][] = [
      ["init-error", [], "failure", "unknown"],
      ["bad-json", [], "failure", "unknown"],
      ["tools-error", [], "success", "failure"],
      ["empty-tools", [], "success", "failure"],
      ["ok", ["--tools", "lophn_index"], "success", "failure"],
    ];
    for (const [mode, extra, init, tools] of cases) {
      await writeMcpConfig(fx, "claude", "app", fixtureLaunch(mode, extra));
      const reports = await run(
        fx,
        inputOf(fx, "claude", "app", { trust: "trusted" }),
      );
      assertEquals(
        [
          stage(reports, "mcp_initialize").result,
          stage(reports, "tool_discovery").result,
        ],
        [init, tools],
        mode,
      );
    }
    // 없는 tool은 이름을 이유에 남긴다.
    const missing = await run(
      fx,
      inputOf(fx, "claude", "app", { trust: "trusted" }),
    );
    assertStringIncludes(stage(missing, "tool_discovery").reason, "lophn_read");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/harnesses#R10: 설치 Deno가 아니거나 권한을 넓힌 설정 항목은 실행하지 않고 unknown이다", async () => {
  const fx = await fixture();
  try {
    const sentinel = `${fx.base}/ran`;
    // 설치된 Deno가 아닌 command는 실행하지 않는다.
    await writeMcpConfig(fx, "claude", "app", {
      executable: "/bin/sh",
      args: ["-c", `touch ${sentinel}`],
      env: { LOPHN_CONNECTION: CAC },
    });
    const other = await run(fx, inputOf(fx, "claude", "app"));
    assertEquals(stage(other, "mcp_initialize").result, "unknown");
    assertStringIncludes(stage(other, "mcp_initialize").reason, "Deno");

    // 설치 Deno라도 `-A`처럼 권한을 넓힌 args는 실행하지 않는다.
    const wide = fixtureLaunch("ok");
    for (const flag of ["-A", "--allow-run", "--allow-write=/tmp"]) {
      await writeMcpConfig(fx, "claude", "app", {
        ...wide,
        args: ["run", flag, ...wide.args.slice(1)],
      });
      const reports = await run(fx, inputOf(fx, "claude", "app"));
      assertEquals(stage(reports, "mcp_initialize").result, "unknown", flag);
      assertStringIncludes(stage(reports, "mcp_initialize").reason, "권한");
    }
    assertFalse(await exists(sentinel));
  } finally {
    await fx.dispose();
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("coding-agent/harnesses#R10: CLI fallback이 되어도 MCP loading 성공을 만들지 않는다", async () => {
  const fx = await fixture();
  try {
    // Codex는 user config에 lophn 항목이 없다. CLI fallback이 success여도
    // MCP 단계는 failure다.
    const reports = await run(
      fx,
      inputOf(fx, "codex", "user", { cliFallback: "success" }),
    );
    const init = stage(reports, "mcp_initialize");
    assertEquals(init.result, "failure");
    assertStringIncludes(init.reason, "CLI fallback");
    assertEquals(stage(reports, "tool_discovery").result, "unknown");

    // OpenClaw는 session 소유 stdio를 확인하지 못해 unknown이다.
    const claw = await run(
      fx,
      inputOf(fx, "openclaw", "app", { cliFallback: "success" }),
    );
    assertEquals(stage(claw, "mcp_initialize").result, "unknown");
    assertEquals(stage(claw, "tool_discovery").result, "unknown");
    assertStringIncludes(stage(claw, "mcp_initialize").reason, "CLI fallback");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/connection#R13: active 연결이나 credential은 설치·loading 성공이 아니고 회수된 연결은 mcp 단계의 이유가 된다", async () => {
  const fx = await fixture();
  try {
    // 연결이 active여도 설정이 없으면 failure다.
    const active = await run(
      fx,
      inputOf(fx, "codex", "user", {
        connection: { id: CAC, state: "active" },
      }),
    );
    assertEquals(stage(active, "mcp_initialize").result, "failure");

    // 회수된 연결은 설정이 맞아도 failure이고 다음 확인이 사람 행동이다.
    await writeMcpConfig(fx, "claude", "app", fixtureLaunch());
    const revoked = await run(
      fx,
      inputOf(fx, "claude", "app", {
        trust: "trusted",
        connection: { id: CAC, state: "revoked" },
      }),
    );
    const init = stage(revoked, "mcp_initialize");
    assertEquals(init.result, "failure");
    assertStringIncludes(init.reason, CAC);
    assertStringIncludes(init.next, "새 연결");
    assertEquals(stage(revoked, "tool_discovery").result, "unknown");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/connection#R13: 신뢰하지 않은 앱은 단계별 이유가 나오고 신뢰나 파일은 바뀌지 않는다", async () => {
  const fx = await fixture();
  try {
    await claudeApp(fx);
    const before = await snapshotAll(fx);
    const rejected = await run(
      fx,
      inputOf(fx, "claude", "app", { trust: "rejected" }),
    );
    assertEquals(stage(rejected, "mcp_initialize").result, "failure");
    assertStringIncludes(stage(rejected, "mcp_initialize").reason, "신뢰");
    assertEquals(stage(rejected, "skill_discovery").result, "failure");
    assertStringIncludes(
      stage(rejected, "skill_discovery").next,
      "신뢰를 대신 정하지 않는다",
    );
    // 신뢰를 모르면 성공이라고 하지 않는다.
    const unknown = await run(fx, inputOf(fx, "claude", "app"));
    assertEquals(stage(unknown, "mcp_initialize").result, "unknown");
    assertEquals(stage(unknown, "skill_discovery").result, "unknown");
    assertEquals(await snapshotAll(fx), before);

    // Codex는 untrusted project의 안내를 건너뛴다.
    await writeGuide(fx, "codex");
    const codex = await run(
      fx,
      inputOf(fx, "codex", "app", { trust: "rejected" }),
    );
    assertEquals(stage(codex, "app_guide_loading").result, "failure");
    assertStringIncludes(stage(codex, "app_guide_loading").reason, "신뢰");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/connection#R13: Hermes 신뢰 목록은 사람의 설정 파일에서 읽고 읽기만 한다", async () => {
  const fx = await fixture();
  try {
    await writeMcpConfig(fx, "hermes", "app", fixtureLaunch());
    await writeSkills(`${fx.project}/.hermes/skills`, SKILLS);
    const config = `${rootFor(fx, "hermes_home")}/config.yaml`;
    const base = await Deno.readTextFile(config);
    const before = await snapshotAll(fx);
    const untrusted = await run(fx, inputOf(fx, "hermes", "app"));
    assertEquals(stage(untrusted, "skill_discovery").result, "failure");
    assertStringIncludes(
      stage(untrusted, "skill_discovery").reason,
      "신뢰 목록",
    );
    assertStringIncludes(stage(untrusted, "skill_discovery").next, "hermes");
    assertEquals(await snapshotAll(fx), before);

    // 사람이 `hermes skills trust`로 목록에 더한 것과 같은 파일이다.
    await write(
      config,
      `${base}skills:\n  trusted_project_dirs:\n    - "${fx.project}"\n`,
    );
    const trusted = await run(fx, inputOf(fx, "hermes", "app"));
    assertEquals(stage(trusted, "skill_discovery").result, "success");
    assertEquals(stage(trusted, "mcp_initialize").result, "success");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/connection#R13: override·가져오기 누락·설정 목록 누락이 안내를 가리면 app_guide_loading은 failure다", async () => {
  const fx = await fixture();
  try {
    // Codex: 가까운 AGENTS.override.md가 AGENTS.md를 가린다.
    await writeGuide(fx, "codex");
    await write(`${fx.project}/AGENTS.override.md`, "# mine\n");
    const before = await snapshotAll(fx);
    const codex = await run(
      fx,
      inputOf(fx, "codex", "app", { trust: "trusted" }),
    );
    assertEquals(stage(codex, "app_guide_loading").result, "failure");
    assertStringIncludes(
      stage(codex, "app_guide_loading").reason,
      "AGENTS.override.md",
    );
    assertEquals(await snapshotAll(fx), before);

    // Hermes: `.hermes.md`가 AGENTS.md 체인을 건너뛰게 한다.
    await Deno.remove(`${fx.project}/AGENTS.override.md`);
    await write(`${fx.project}/.hermes.md`, "# mine\n");
    const hermes = await run(fx, inputOf(fx, "hermes", "app"));
    assertEquals(stage(hermes, "app_guide_loading").result, "failure");
    assertStringIncludes(
      stage(hermes, "app_guide_loading").reason,
      ".hermes.md",
    );

    // Claude: CLAUDE.md가 @AGENTS.md를 가져오지 않으면 안내를 읽지 않는다.
    await writeGuide(fx, "claude");
    await write(`${fx.project}/CLAUDE.md`, "# only mine\n");
    const claude = await run(fx, inputOf(fx, "claude", "app"));
    assertEquals(stage(claude, "app_guide_loading").result, "failure");
    assertStringIncludes(
      stage(claude, "app_guide_loading").reason,
      "@AGENTS.md",
    );

    // Gemini: context.fileName에 AGENTS.md가 없으면 읽지 않는다.
    await writeGuide(fx, "gemini");
    await write(
      `${fx.project}/.gemini/settings.json`,
      JSON.stringify({ context: { fileName: ["GEMINI.md"] } }),
    );
    const gemini = await run(
      fx,
      inputOf(fx, "gemini", "app", { trust: "trusted" }),
    );
    assertEquals(stage(gemini, "app_guide_loading").result, "failure");
    assertStringIncludes(
      stage(gemini, "app_guide_loading").reason,
      "context.fileName",
    );
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/connection#R13: 더 우선하는 root의 동명 skill이 가리면 skill_discovery는 failure이고 skill은 지워지지 않는다", async () => {
  const fx = await fixture();
  try {
    await writeMcpConfig(fx, "gemini", "app", fixtureLaunch());
    await writeSkills(`${fx.project}/.gemini/skills`, SKILLS);
    // 사람의 `.agents/skills`가 Gemini에서 `.gemini/skills`보다 우선한다.
    await write(
      `${fx.project}/.agents/skills/lophn-save/SKILL.md`,
      "---\nname: lophn-save\ndescription: mine\n---\n",
    );
    const before = await snapshotAll(fx);
    const reports = await run(
      fx,
      inputOf(fx, "gemini", "app", { trust: "trusted" }),
    );
    const skill = stage(reports, "skill_discovery");
    assertEquals(skill.result, "failure");
    assertStringIncludes(skill.reason, "lophn-save");
    assertStringIncludes(skill.reason, ".agents/skills");
    assertStringIncludes(skill.next, "자동으로 교체하거나 지우지 않는다");
    assertEquals(await snapshotAll(fx), before);

    // 사람의 동명 skill을 지우면 같은 설치가 success다.
    await Deno.remove(`${fx.project}/.agents/skills/lophn-save`, {
      recursive: true,
    });
    const clear = await run(
      fx,
      inputOf(fx, "gemini", "app", { trust: "trusted" }),
    );
    assertEquals(stage(clear, "skill_discovery").result, "success");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/harnesses#R10: 없는 skill·설명 없는 skill은 failure이고 이름을 이유에 남긴다", async () => {
  const fx = await fixture();
  try {
    await writeSkills(`${fx.project}/.claude/skills`, SKILLS.slice(0, 2));
    const missing = await run(
      fx,
      inputOf(fx, "claude", "app", { trust: "trusted" }),
    );
    assertEquals(stage(missing, "skill_discovery").result, "failure");
    assertStringIncludes(
      stage(missing, "skill_discovery").reason,
      "lophn-repair",
    );

    await writeSkills(`${fx.project}/.claude/skills`, SKILLS, null);
    const blank = await run(
      fx,
      inputOf(fx, "claude", "app", { trust: "trusted" }),
    );
    assertEquals(stage(blank, "skill_discovery").result, "failure");
    assertStringIncludes(stage(blank, "skill_discovery").reason, "설명");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/connection#R14: 더 가까운 안내와 별도 workspace는 unknown이고 workspace 파일은 바뀌지 않는다", async () => {
  const fx = await fixture();
  try {
    await claudeApp(fx);
    await writeGuide(fx, "codex");
    // 작업 폴더 안쪽에 더 가까운 안내가 있다.
    await write(`${fx.project}/packages/sub/AGENTS.md`, "# nearer\n");
    const away = `${fx.base}/elsewhere`;
    await Deno.mkdir(away);
    const before = await snapshotAll(fx);
    const nearer = await run(
      fx,
      inputOf(fx, "codex", "app", {
        trust: "trusted",
        workspace: `${fx.project}/packages/sub`,
      }),
    );
    const guide = stage(nearer, "app_guide_loading");
    assertEquals(guide.result, "unknown");
    assertStringIncludes(guide.reason, "packages/sub/AGENTS.md");

    // session이 앱 root 밖 workspace에서 돈다.
    const other = await run(
      fx,
      inputOf(fx, "claude", "app", { trust: "trusted", workspace: away }),
    );
    assertEquals(stage(other, "mcp_initialize").result, "unknown");
    assertEquals(stage(other, "skill_discovery").result, "unknown");
    assertEquals(stage(other, "app_guide_loading").result, "unknown");
    assertStringIncludes(stage(other, "app_guide_loading").reason, "workspace");
    assertEquals(await snapshotAll(fx), before);
    assertEquals(await snapshot(away), "");

    // OpenClaw는 agent workspace를 모르면 앱 안내를 읽는지 알 수 없다.
    const claw = await run(fx, inputOf(fx, "openclaw", "app"));
    assertEquals(stage(claw, "app_guide_loading").result, "unknown");
    assertStringIncludes(stage(claw, "app_guide_loading").reason, "workspace");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/harnesses#R10: 앱이 없는 target의 앱 안내는 unknown이다", async () => {
  const fx = await fixture();
  try {
    await writeMcpConfig(fx, "codex", "user", fixtureLaunch());
    const reports = await run(fx, inputOf(fx, "codex", "user"));
    assertEquals(stage(reports, "mcp_initialize").result, "success");
    const guide = stage(reports, "app_guide_loading");
    assertEquals(guide.result, "unknown");
    assertStringIncludes(guide.reason, "not_applicable");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/harnesses#R8: 깨진 Hermes YAML은 mcp_initialize failure 이유가 되고 파일은 그대로다", async () => {
  const fx = await fixture();
  try {
    const path = `${rootFor(fx, "hermes_home")}/config.yaml`;
    const broken = "mcp_servers:\n  lophn: {\n";
    await write(path, broken);
    const before = await snapshotAll(fx);
    const reports = await run(fx, inputOf(fx, "hermes", "user"));
    const init = stage(reports, "mcp_initialize");
    assertEquals(init.result, "failure");
    assertStringIncludes(init.reason, "기본값으로 대체");
    assertStringIncludes(init.next, "고치지 않는다");
    assertEquals(stage(reports, "tool_discovery").result, "unknown");
    assertEquals(await Deno.readTextFile(path), broken);
    assertEquals(await snapshotAll(fx), before);
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/harnesses#R10: Hermes YAML의 block 목록 args도 읽어 probe한다", async () => {
  const fx = await fixture();
  try {
    await writeMcpConfig(fx, "hermes", "user", fixtureLaunch());
    await writeSkills(`${rootFor(fx, "hermes_home")}/skills`, SKILLS);
    const text = await Deno.readTextFile(
      `${rootFor(fx, "hermes_home")}/config.yaml`,
    );
    assertStringIncludes(text, "args:\n      - ");
    const reports = await run(fx, inputOf(fx, "hermes", "user"));
    assertEquals(stage(reports, "mcp_initialize").result, "success");
    assertEquals(stage(reports, "tool_discovery").result, "success");
    assertEquals(stage(reports, "skill_discovery").result, "success");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/harnesses#R10: pi의 깨진 mcp.json과 형식이 다른 항목은 각각 이유가 다른 failure다", async () => {
  const fx = await fixture();
  try {
    await write(`${fx.project}/.pi/mcp.json`, '{"mcpServers": {');
    const broken = await run(
      fx,
      inputOf(fx, "pi", "app", { trust: "trusted" }),
    );
    const init = stage(broken, "mcp_initialize");
    assertEquals(init.result, "failure");
    assertStringIncludes(init.reason, "파일 전체 건너뛴다");

    await write(
      `${fx.project}/.pi/mcp.json`,
      JSON.stringify({ mcpServers: { lophn: { command: 3 } } }),
    );
    const shape = await run(fx, inputOf(fx, "pi", "app", { trust: "trusted" }));
    assertEquals(stage(shape, "mcp_initialize").result, "failure");
    assertStringIncludes(stage(shape, "mcp_initialize").reason, "모양");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/harnesses#R12: 설정의 다른 env 값과 설정 원문은 관측 결과에 나오지 않는다", async () => {
  const fx = await fixture();
  try {
    await claudeApp(fx);
    await writeMcpConfig(
      fx,
      "claude",
      "app",
      fixtureLaunch("ok", [], { LOPHN_API_KEY: "sk-very-secret-value" }),
    );
    const reports = await run(
      fx,
      inputOf(fx, "claude", "app", { trust: "trusted" }),
    );
    assertEquals(stage(reports, "mcp_initialize").result, "success");
    const text = JSON.stringify(reports);
    assertFalse(text.includes("sk-very-secret-value"));
    assertFalse(text.includes(fx.home));
  } finally {
    await fx.dispose();
  }
});
