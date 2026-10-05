// release 준비의 git extract(apps/releases#R2). 연결된 실제 source 경계에서 지정한
// commit의 파일만 읽는다. symlink 자체·uncommitted 변경·git 관리 정보·개발
// credential·agent 도구(coding-agent 제외 목록)는 bundle에 넣지 않는다.
import { assert, assertEquals } from "@std/assert";
import { ok, type Result } from "../../../base/mod.ts";
import {
  extractCommit,
  type ExtractedFile,
  gitCommandRunner,
  type GitRunner,
  parseLsTree,
  parsePorcelain,
  validCommit,
} from "./git-extract.ts";

const COMMIT_OK = "ab".repeat(20);

function gitScript(script: Map<string, string | Uint8Array>): GitRunner {
  return {
    run(args) {
      const key = args.join(" ");
      const found = script.get(key);
      if (found === undefined) {
        return Promise.resolve({
          ok: false,
          error: { code: "not_found", message: key },
        });
      }
      return Promise.resolve(
        ok(
          typeof found === "string" ? new TextEncoder().encode(found) : found,
        ),
      );
    },
  };
}

function okGit(): GitRunner {
  return gitScript(
    new Map([
      [`-C /src rev-parse --is-inside-work-tree`, "true\n"],
      [`-C /src ls-tree -r -z ${COMMIT_OK}`, "100644 blob h\tmain.ts\0"],
      [`-C /src cat-file blob ${COMMIT_OK}:main.ts`, "export const x = 1;\n"],
      [`-C /src status --porcelain -z`, ""],
    ]),
  );
}

// 스크립트 git은 디스크를 보지 않는다. 테스트가 안쪽이라고 답하는 경계만 넣는다.
function scriptBoundary(
  root: string,
): Promise<
  Result<string, { code: "invalid_input"; reason: "source_outside_boundary" }>
> {
  return root === "/src" ? Promise.resolve(ok(root)) : Promise.resolve({
    ok: false,
    error: { code: "invalid_input", reason: "source_outside_boundary" },
  });
}

const INPUT = {
  sourceRoot: "/src",
  commit: COMMIT_OK,
  boundary: scriptBoundary,
};

Deno.test("apps/releases#R2: 지정 commit의 tree object 파일만 읽는다", async () => {
  const files = await extractCommit(okGit(), INPUT);
  assert(files.ok, files.ok ? "" : files.error.reason);
  assertEquals(files.value.length, 1);
  assertEquals(files.value[0].path, "main.ts");
  assertEquals(files.value[0].bytes.length > 0, true);
});

Deno.test("apps/releases#R2: source 밖 경로와 잘못된 commit은 거절이다", async () => {
  const bad = await extractCommit(okGit(), {
    sourceRoot: "/elsewhere",
    commit: COMMIT_OK,
    boundary: scriptBoundary,
  });
  assertEquals(bad.ok, false);
  if (!bad.ok) assertEquals(bad.error.reason, "source_outside_boundary");
  const short = await extractCommit(okGit(), {
    sourceRoot: "/src",
    commit: "abc123",
  });
  assertEquals(short.ok, false);
  if (!short.ok) assertEquals(short.error.reason, "commit_unknown");
  assertEquals(validCommit("abc123"), false);
  assertEquals(validCommit(COMMIT_OK), true);
});

Deno.test("apps/releases#R2: commit에 없는 파일과 working tree 변경은 거절이다", async () => {
  const changed = gitScript(
    new Map([
      [`-C /src rev-parse --is-inside-work-tree`, "true\n"],
      [`-C /src ls-tree -r -z ${COMMIT_OK}`, "100644 blob h\tmain.ts\0"],
      [`-C /src cat-file blob ${COMMIT_OK}:main.ts`, "export const x = 1;\n"],
      [`-C /src status --porcelain -z`, ` M main.ts\0`],
    ]),
  );
  const refused = await extractCommit(changed, INPUT);
  assertEquals(refused.ok, false);
  if (!refused.ok) assertEquals(refused.error.reason, "working_tree_changed");
});

Deno.test("apps/releases#R2: uncommitted 파일이 있으면 거절이다", async () => {
  const untracked = gitScript(
    new Map([
      [`-C /src rev-parse --is-inside-work-tree`, "true\n"],
      [`-C /src ls-tree -r -z ${COMMIT_OK}`, "100644 blob h\tmain.ts\0"],
      [`-C /src cat-file blob ${COMMIT_OK}:main.ts`, "export const x = 1;\n"],
      [`-C /src status --porcelain -z`, `?? extra.ts\0`],
    ]),
  );
  const refused = await extractCommit(untracked, INPUT);
  assertEquals(refused.ok, false);
  if (!refused.ok) assertEquals(refused.error.reason, "uncommitted_file");
});

Deno.test("apps/releases#R2: symlink 자체와 git 관리 정보는 거절이다", async () => {
  const symlinked = gitScript(
    new Map([
      [`-C /src rev-parse --is-inside-work-tree`, "true\n"],
      [`-C /src ls-tree -r -z ${COMMIT_OK}`, "120000 blob h\tlink.ts\0"],
      [`-C /src status --porcelain -z`, ""],
    ]),
  );
  const refused = await extractCommit(symlinked, INPUT);
  assertEquals(refused.ok, false);
  if (!refused.ok) assertEquals(refused.error.reason, "symlink_itself");
  const submodule = gitScript(
    new Map([
      [`-C /src rev-parse --is-inside-work-tree`, "true\n"],
      [`-C /src ls-tree -r -z ${COMMIT_OK}`, "160000 commit h\tvendor/pkg\0"],
      [`-C /src status --porcelain -z`, ""],
    ]),
  );
  const subRefused = await extractCommit(submodule, INPUT);
  assertEquals(subRefused.ok, false);
  if (!subRefused.ok) assertEquals(subRefused.error.reason, "git_metadata");
});

Deno.test("apps/releases#R2: 개발 credential과 agent 도구는 bundle에 넣지 않는다", async () => {
  // coding-agent 제외 목록: AGENTS.md, CLAUDE.md, bin/lophn, .mcp.json,
  // .claude/settings.local.json, skill 사본, .lophn/skills, .lophn/hooks.
  const tree = [
    "100644 blob h\tmain.ts\0",
    "100644 blob h\tAGENTS.md\0",
    "100644 blob h\tCLAUDE.md\0",
    "100755 blob h\tbin/lophn\0",
    "100644 blob h\t.mcp.json\0",
    "100644 blob h\t.claude/settings.local.json\0",
    "100644 blob h\tskills/lophn-navigate/SKILL.md\0",
    "100644 blob h\t.lophn/skills/lophn-save.md\0",
    "100644 blob h\t.lophn/hooks/hook.json\0",
  ].join("\0");
  const calls: string[] = [];
  const git: GitRunner = {
    run(args) {
      calls.push(args.join(" "));
      if (args[2] === "ls-tree") {
        return Promise.resolve(ok(new TextEncoder().encode(tree)));
      }
      if (args[2] === "cat-file") {
        return Promise.resolve(
          ok(new TextEncoder().encode("excluded bytes\n")),
        );
      }
      if (args[2] === "rev-parse") {
        return Promise.resolve(ok(new TextEncoder().encode("true\n")));
      }
      return Promise.resolve(ok(new TextEncoder().encode("")));
    },
  };
  const files = await extractCommit(git, INPUT);
  assert(files.ok, files.ok ? "" : files.error.reason);
  assertEquals(
    files.value.map((file: ExtractedFile) => file.path),
    ["main.ts"],
    "제외 목록의 파일은 bundle에 없다",
  );
  // 제외 파일의 blob을 읽지 않았다.
  const blobCalls = calls.filter((call) => call.includes("cat-file"));
  assertEquals(blobCalls.length, 1);
  assert(blobCalls[0].endsWith("main.ts"), "제외 파일 blob을 읽지 않는다");
});

async function git(cwd: string, args: string[]): Promise<void> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "null",
    stderr: "piped",
  }).output();
  assert(output.success, new TextDecoder().decode(output.stderr));
}

Deno.test("apps/releases#R2: 실제 git에서 symlink·밖 경로·uncommitted 변경을 거절한다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-git-extract-" });
  const source = `${home}/src`;
  await Deno.mkdir(source);
  await git(source, ["init"]);
  await git(source, ["config", "user.email", "dev@lophn.local"]);
  await git(source, ["config", "user.name", "dev"]);
  await Deno.writeTextFile(`${source}/main.ts`, "export const x = 1;\n");
  await Deno.symlink("main.ts", `${source}/link.ts`);
  await git(source, ["add", "main.ts", "link.ts"]);
  await git(source, ["commit", "-m", "init"]);
  const head = await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
    cwd: source,
    stdout: "piped",
  }).output();
  const commit = new TextDecoder().decode(head.stdout).trim();
  const runner = gitCommandRunner();
  const linked = await extractCommit(runner, { sourceRoot: source, commit });
  assertEquals(linked.ok, false);
  if (!linked.ok) assertEquals(linked.error.reason, "symlink_itself");
  await git(source, ["rm", "link.ts"]);
  await git(source, ["commit", "-m", "drop link"]);
  const cleanHead = await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
    cwd: source,
    stdout: "piped",
  }).output();
  const clean = new TextDecoder().decode(cleanHead.stdout).trim();
  const outside = `${home}/outside`;
  await Deno.mkdir(outside);
  const escaped = await extractCommit(runner, {
    sourceRoot: outside,
    commit: clean,
  });
  assertEquals(escaped.ok, false);
  if (!escaped.ok) {
    assertEquals(escaped.error.reason, "source_outside_boundary");
  }
  const linkedRoot = `${home}/linked-root`;
  await Deno.symlink(source, linkedRoot);
  const viaLink = await extractCommit(runner, {
    sourceRoot: linkedRoot,
    commit: clean,
  });
  assert(viaLink.ok, viaLink.ok ? "" : viaLink.error.reason);
  await Deno.writeTextFile(`${source}/extra.ts`, "export const extra = 1;\n");
  const dirty = await extractCommit(runner, {
    sourceRoot: source,
    commit: clean,
  });
  assertEquals(dirty.ok, false);
  if (!dirty.ok) assertEquals(dirty.error.reason, "uncommitted_file");
  await Deno.remove(home, { recursive: true });
});

Deno.test("apps/releases#R2: ls-tree와 porcelain 출력을 나눈다", () => {
  const entries = parseLsTree(
    "100644 blob h\tmain.ts\x00120000 blob h\tlink.ts\x00",
  );
  assertEquals(entries, [
    { mode: "100644", path: "main.ts" },
    { mode: "120000", path: "link.ts" },
  ]);
  const status = parsePorcelain(` M main.ts\0?? extra.ts\0`);
  assertEquals(status, ["main.ts", "extra.ts"]);
  // rename은 두 record로 나온다.
  const renamed = parsePorcelain(`R  from.ts\0to.ts\0`);
  assertEquals(renamed, ["from.ts", "to.ts"]);
});
