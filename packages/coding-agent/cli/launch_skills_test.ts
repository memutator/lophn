// `skills install`의 launcher 권한 계획 시험이다(cli#R10, open-issues coding-agent/mcp-server#Q9). 순수 계산이라
// 파일을 열지 않는다. 고른 제품 skill root 아래 배포 skill 이름의 디렉터리만 정확한 경로로 열리고 root 폴더
// 전체·사람의 다른 skill·다른 제품 root는 열리지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import type { IntegrationTarget } from "../../contracts/coding-agent/mod.ts";
import { SKILL_RELEASES } from "../guides/mod.ts";
import { NO_SELECTION, planSelection, selectionFlags } from "./launch.ts";

const target = (
  harness: IntegrationTarget["harness_id"],
): IntegrationTarget => ({
  scope_kind: "user",
  environment: { kind: "host", identity: "native" },
  profile_id: null,
  harness_id: harness,
  app: null,
  app_realpath: null,
});

const roots = {
  home: "/h/person",
  env: { get: (_name: string): string | undefined => undefined },
  cwd: "/h/project",
};

const deps = { sourceDirOf: () => Promise.resolve(undefined) };

Deno.test("coding-agent/cli#R10: skills install은 선택 제품의 skill root 아래 배포 skill 디렉터리만 읽기·쓰기로 연다", async () => {
  const selection = await planSelection(
    { command: "skills install", input: { target: target("claude") }, roots },
    deps,
  );
  assertEquals(
    [...(selection.skillDirs ?? [])].sort(),
    SKILL_RELEASES.map((release) => `/h/person/.claude/skills/${release.name}`)
      .sort(),
  );
  const flags = selectionFlags(selection);
  assertEquals(flags.length, 2);
  for (const flag of flags) {
    assertFalse(flag.includes(",/h/person/.claude/skills,"));
    assertFalse(flag.endsWith("/h/person/.claude/skills"));
    assertFalse(flag.includes("*"));
    // 다른 제품 root나 사람 home 전체는 없다.
    assertFalse(flag.includes("/.codex"));
    assertFalse(flag.includes("/.agents"));
  }
  assert(
    flags[0].startsWith("--allow-read=") &&
      flags[1].startsWith("--allow-write="),
  );
});

Deno.test("coding-agent/cli#R10: names로 고르면 그 skill 디렉터리만 열리고 배포하지 않는 이름은 아무것도 열지 않는다", async () => {
  const one = await planSelection({
    command: "skills install",
    input: { target: target("codex"), names: ["lophn-save"] },
    roots,
  }, deps);
  assertEquals(one.skillDirs, ["/h/person/.agents/skills/lophn-save"]);
  const unknown = await planSelection({
    command: "skills install",
    input: { target: target("codex"), names: ["lophn-save", "my-own"] },
    roots,
  }, deps);
  assertEquals(unknown, NO_SELECTION);
});

Deno.test("coding-agent/cli#R10: target이 없거나 지원하지 않는 환경이면 아무것도 열지 않는다", async () => {
  assertEquals(
    await planSelection({ command: "skills install", input: {}, roots }, deps),
    NO_SELECTION,
  );
  const wsl = {
    ...target("claude"),
    environment: { kind: "wsl" as const, identity: "x" },
  };
  assertEquals(
    await planSelection(
      { command: "skills install", input: { target: wsl }, roots },
      deps,
    ),
    NO_SELECTION,
  );
});

Deno.test("coding-agent/cli#R17, coding-agent/cli#R29: app sync-tools는 앱 root 두 위치(안내 파일·.gitignore과 lophn skill 디렉터리)만 읽기·쓰기로 연다", async () => {
  const appTarget = (
    harness: IntegrationTarget["harness_id"],
  ): IntegrationTarget => ({
    scope_kind: "app",
    environment: { kind: "host", identity: "native" },
    profile_id: null,
    harness_id: harness,
    app: "app_01h455vb4pex5v6nkc6gd5fdw1",
    app_realpath: "/w/notes",
  });
  const selection = await planSelection(
    {
      command: "app sync-tools",
      input: { target: appTarget("claude"), roots },
      roots,
    },
    deps,
  );
  // 관리 구간 지침 파일(CLAUDE.md)·MCP 설정(.mcp.json)·.gitignore가 앱 root에 있다.
  // temp 이름은 selectionFlags가 파일마다 함께 더한다(WRITE_TEMP_SUFFIX).
  const expected = [
    "/w/notes/.mcp.json",
    "/w/notes/CLAUDE.md",
    "/w/notes/.gitignore",
  ];
  const files = new Set(selection.harnessFiles);
  for (const path of expected) assert(files.has(path), path);
  const flagged = selectionFlags(selection).join(",");
  assert(flagged.includes("/w/notes/CLAUDE.md.lophn-tmp"), "temp");
  assert(flagged.includes("/w/notes/.gitignore.lophn-tmp"), "temp");
  // lophn skill 디렉터리는 앱의 skill root 아래다.
  assertEquals(
    [...(selection.skillDirs ?? [])].sort(),
    SKILL_RELEASES.map((release) => `/w/notes/.claude/skills/${release.name}`)
      .sort(),
  );
  const flags = selectionFlags(selection);
  assertEquals(flags.length, 2);
  for (const flag of flags) {
    assertFalse(flag.includes(",/w/notes,"));
    assertFalse(flag.endsWith("/w/notes"));
    assertFalse(flag.includes("*"));
    // 사람 home과 다른 제품 root는 없다.
    assertFalse(flag.includes("/h/person"));
    assertFalse(flag.includes("/.codex"));
  }
});

Deno.test("coding-agent/cli#R17: app sync-tools의 names로 고르면 그 skill 디렉터리만 열리고 배포하지 않는 이름은 아무것도 열지 않는다", async () => {
  const appTarget: IntegrationTarget = {
    scope_kind: "app",
    environment: { kind: "host", identity: "native" },
    profile_id: null,
    harness_id: "claude",
    app: "app_01h455vb4pex5v6nkc6gd5fdw1",
    app_realpath: "/w/notes",
  };
  const one = await planSelection({
    command: "app sync-tools",
    input: { target: appTarget, names: ["lophn-save"] },
    roots,
  }, deps);
  assertEquals(one.skillDirs, ["/w/notes/.claude/skills/lophn-save"]);
  const unknown = await planSelection({
    command: "app sync-tools",
    input: { target: appTarget, names: ["lophn-save", "my-own"] },
    roots,
  }, deps);
  assertEquals(unknown, NO_SELECTION);
});

Deno.test("coding-agent/cli#R17: app sync-tools의 user target은 아무것도 열지 않는다", async () => {
  assertEquals(
    await planSelection({
      command: "app sync-tools",
      input: { target: target("claude") },
      roots,
    }, deps),
    NO_SELECTION,
  );
});
