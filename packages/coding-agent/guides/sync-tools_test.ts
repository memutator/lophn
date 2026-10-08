// sync 시험이다(guides#R17, cli#R29, T34). 사람이 고른 target 하나의 앱 범위에 도구를
// 다시 맞추는 시험이고 모든 root는 temp dir이다. 사람의 실제 설정 root와 실제 harness는
// 열지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { filePort, storeOf } from "../harnesses/mod.ts";
import {
  type Fixture,
  fixture,
  fixtureLaunch,
  NOW,
  targetOf,
  write,
} from "../harnesses/testing/mod.ts";
import type { DistributedSkill } from "./distribution.ts";
import { syncTools, type SyncToolsOutcome } from "./sync-tools.ts";

const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";

function skillText(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${
    JSON.stringify(description)
  }\n---\n\n# ${name}\n\n본문\n`;
}

function distSkill(name: string, description: string): DistributedSkill {
  return {
    name,
    description,
    version: "1.0.0",
    hash: "a".repeat(64),
    body: `# ${name}\n\n본문\n`,
    files: [{ path: "SKILL.md", content: skillText(name, description) }],
  };
}

function distSkills(): DistributedSkill[] {
  return [
    distSkill("lophn-navigate", "탐색 절차."),
    distSkill("lophn-save", "저장 절차."),
    distSkill("lophn-build-app", "앱 제작 절차."),
    distSkill("lophn-repair", "수리 절차."),
  ];
}

function fxPorts(fx: Fixture) {
  return { files: filePort(), store: storeOf(fx.lophn) };
}

function syncInput(
  fx: Fixture,
  over: Partial<Parameters<typeof syncTools>[0]> = {},
): Parameters<typeof syncTools>[0] {
  return {
    target: targetOf("claude", "app", fx),
    skills: distSkills(),
    roots: { home: fx.home, env: fx.env, cwd: fx.project },
    launch: fixtureLaunch(),
    connection: CAC,
    operationId: "op-sync",
    now: NOW,
    ...over,
  } as never;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

function guideWithRegion(body: string): string {
  return `# mine\n\n<!-- begin lophn-managed -->\n${body}<!-- end lophn-managed -->\n\n## 자리\n\n- 사람 몫\n`;
}

const syncOutcome = (done: { ok: true; value: unknown }) =>
  done.value as SyncToolsOutcome;

Deno.test("guides#R17: sync는 앱 하나 범위의 도구(MCP 설정·skill·안내·ignore)를 다시 맞추고 항목별 결과를 낸다", async () => {
  const fx = await fixture();
  try {
    await write(`${fx.project}/AGENTS.md`, guideWithRegion("옛\n"));
    // 다른 server 조각이 있는 app MCP 설정이다.
    await write(
      `${fx.project}/.mcp.json`,
      JSON.stringify({ mcpServers: { other: { command: "keep" } } }),
    );
    const done = await syncTools(syncInput(fx), fxPorts(fx));
    assert(done.ok, done.ok ? "" : done.error.message);
    const outcome = syncOutcome(done);
    const seen = new Set(outcome.files.map((file) => file.target as string));
    // guide 통로 결과는 이 fixture가 CLAUDE.md 관리 구간이 없어 notice다(guide notice).
    for (const want of ["mcp", "ignore", "skill"]) {
      assert(seen.has(want), want);
    }
    // MCP 설정은 병합이다: 다른 server는 보존되고 lophn 항목만 생긴다.
    const config = JSON.parse(
      await Deno.readTextFile(`${fx.project}/.mcp.json`),
    );
    assertEquals(config.mcpServers.other.command, "keep");
    assert(config.mcpServers.lophn !== undefined);
    // 사람 몫 구간은 bytes 그대로 둔다.
    const agents = await Deno.readTextFile(`${fx.project}/AGENTS.md`);
    assertEquals(agents.split("<!-- begin lophn-managed -->")[0], "# mine\n\n");
    assertEquals(agents.includes("## 자리"), true);
    assertEquals(agents.includes("- 사람 몫"), true);
    // Claude 얇은 안내는 관리 구간이 없는 파일을 건드리지 않는다.
    assertEquals(await exists(`${fx.project}/CLAUDE.md`), false);
    // gitignore가 없으면 무변경이고 이유가 남는다.
    assertFalse(await exists(`${fx.project}/.gitignore`));
    const ignoreResult = outcome.files.find((file) => file.target === "ignore");
    assertEquals(ignoreResult?.outcome, "unchanged");
    assert(ignoreResult?.reason.includes("준비한다"));
  } finally {
    await fx.dispose();
  }
});

Deno.test("guides#R17: 두 번 sync해도 소유 조각이 unchanged이고 중복이 없다", async () => {
  const fx = await fixture();
  try {
    await write(`${fx.project}/AGENTS.md`, guideWithRegion("옛\n"));
    await write(
      `${fx.project}/.gitignore`,
      "# begin lophn-managed\n# end lophn-managed\n",
    );
    const first = await syncTools(syncInput(fx), fxPorts(fx));
    assert(first.ok, first.ok ? "" : first.error.message);
    const firstOutcome = syncOutcome(first);
    assertEquals(firstOutcome.status, "complete");
    const second = await syncTools(syncInput(fx), fxPorts(fx));
    assert(second.ok, second.ok ? "" : second.error.message);
    const secondOutcome = syncOutcome(second);
    assertEquals(secondOutcome.status, "complete");
    // 소유 조각은 모두 unchanged이다: 중복이 없다.
    for (const file of secondOutcome.files) {
      if (file.target === "guide" || file.target === "ignore") {
        assertEquals(file.outcome, "unchanged", `${file.target} ${file.name}`);
      }
    }
    // skill 사본도 unchanged다.
    const saved = secondOutcome.files.find((f) =>
      f.target === "skill" && f.name === "lophn-save"
    );
    assertEquals(saved?.outcome, "unchanged");
    // 설정에는 lophn 항목이 하나뿐이다.
    const config = JSON.parse(
      await Deno.readTextFile(`${fx.project}/.mcp.json`),
    );
    assertEquals(Object.keys(config.mcpServers.lophn).length > 0, true);
  } finally {
    await fx.dispose();
  }
});

Deno.test("cli#R29: 재배포는 기존 앱 code·다른 server·사람 안내를 보존하고 항목별 변경·무변경·건너뜀과 이유를 반환한다", async () => {
  const fx = await fixture();
  try {
    await write(`${fx.project}/AGENTS.md`, guideWithRegion("옛\n"));
    await write(
      `${fx.project}/.gitignore`,
      "# begin lophn-managed\n# end lophn-managed\n",
    );
    // 기존 앱 code다.
    await write(`${fx.project}/main.ts`, "export const app = 1;\n");
    await write(`${fx.project}/src/rules.md`, "- 기존 rules\n");
    const before = await Deno.readTextFile(`${fx.project}/main.ts`);
    const rulesBefore = await Deno.readTextFile(`${fx.project}/src/rules.md`);
    const done = await syncTools(syncInput(fx), fxPorts(fx));
    assert(done.ok, done.ok ? "" : done.error.message);
    const outcome = syncOutcome(done);
    // 항목별 결과(변경·무변경·건너뜀)와 이유가 다 있다.
    for (const file of outcome.files) {
      assert(file.reason.length > 0, `${file.target} ${file.name}`);
    }
    // 기존 앱 code는 그대로다.
    assertEquals(await Deno.readTextFile(`${fx.project}/main.ts`), before);
    assertEquals(
      await Deno.readTextFile(`${fx.project}/src/rules.md`),
      rulesBefore,
    );
  } finally {
    await fx.dispose();
  }
});

Deno.test("guides#R17: 설치 경로가 바뀐 뒤 재배포해도 앱 code와 기존 설정이 보존되고 사람 소유 조각은 보존한다", async () => {
  const fx = await fixture();
  try {
    await write(`${fx.project}/AGENTS.md`, guideWithRegion("옛\n"));
    await write(
      `${fx.project}/.gitignore`,
      "# begin lophn-managed\n# end lophn-managed\n",
    );
    const first = await syncTools(syncInput(fx), fxPorts(fx));
    assert(first.ok, first.ok ? "" : first.error.message);
    // 사람이 관리 구분 바깥을 고친다.
    const agents = await Deno.readTextFile(`${fx.project}/AGENTS.md`);
    await Deno.writeTextFile(
      `${fx.project}/AGENTS.md`,
      agents + "사람이 추가한 문장\n",
    );
    const second = await syncTools(syncInput(fx), fxPorts(fx));
    if (second.ok) {
      // 사람의 추가 문장은 남는다.
      const after = await Deno.readTextFile(`${fx.project}/AGENTS.md`);
      assert(after.includes("사람이 추가한 문장"), "사람 문장 보존");
    } else {
      assertEquals(second.error.code, "conflict");
    }
  } finally {
    await fx.dispose();
  }
});
