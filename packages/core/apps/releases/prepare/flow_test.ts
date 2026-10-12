// release 준비 흐름(apps/releases#R3, R19). source·bundle byte, 파일 수, 300000ms를
// 준비 도중에 세고, 취소·worker 종료·source 변경은 부분 bundle을 확정하지 않는다.
import { assert, assertEquals } from "@std/assert";
import { ok, type Result } from "../../../../base/mod.ts";
import { RELEASE_FILE_MAX_COUNT, RELEASE_SOURCE_MAX_BYTES } from "./limits.ts";
import { prepareRelease, type PrepareReleaseInput } from "./flow.ts";
import { gitCommandRunner, type GitRunner } from "./git-extract.ts";

const APP = "app_01aryz6s41s4z4k7p41s4z4k7p";
const BLUEPRINT = JSON.stringify({
  name: "Calendar",
  description: "Keeps one calendar",
  screens: [],
  commands: [{
    key: "lookup",
    label: "Lookup",
    description: "Reads one account",
    effect: "read",
    confirm: false,
    input: null,
    revert: { supported: false },
  }],
  automatic_tasks: [],
  permissions: [],
  problem_codes: [],
  documents: [],
  agent_context: [],
  app_connections: [],
  sdk_dependencies: [],
});

async function git(cwd: string, args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(output.success, new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim();
}

async function repo(): Promise<
  { source: string; commit: string; home: string }
> {
  const home = await Deno.makeTempDir({ prefix: "lophn-prepare-" });
  const source = `${home}/src`;
  await Deno.mkdir(source);
  await git(source, ["init"]);
  await git(source, ["config", "user.email", "dev@lophn.local"]);
  await git(source, ["config", "user.name", "dev"]);
  await Deno.writeTextFile(`${source}/main.ts`, "export const x = 1;\n");
  await git(source, ["add", "main.ts"]);
  await git(source, ["commit", "-m", "init"]);
  const commit = await git(source, ["rev-parse", "HEAD"]);
  return { source, commit, home };
}

function input(
  source: string,
  commit: string,
  dataRoot: string,
): PrepareReleaseInput {
  return {
    dataRoot,
    app: APP,
    sourceRoot: source,
    commit,
    entrypoint: "main.ts",
    blueprintSource: BLUEPRINT,
    screens: [{
      path: "screens/one.js",
      bytes: new TextEncoder().encode("export const one = 1;\n"),
    }],
    sdkDependencies: [{ name: "@lophn/blueprint", version: "1.0.0" }],
    uiDependencies: [{ name: "react", version: "19.0.0" }],
  };
}

Deno.test("apps/releases#R19: 준비 중 취소와 worker 종료는 bundle을 확정하지 않는다", async () => {
  const made = await repo();
  const data = `${made.home}/data`;
  await Deno.mkdir(data);
  let blobs = 0;
  const cancelled = await prepareRelease(
    input(made.source, made.commit, data),
    {
      git: gitCommandRunner(),
      cancelled: () => true,
      prepareBlob: () => {
        blobs += 1;
        return Promise.resolve(ok({ hash: "aa".repeat(32), size_bytes: 1 }));
      },
    },
  );
  assertEquals(cancelled.ok, false);
  if (!cancelled.ok) assertEquals(cancelled.error.reason, "cancelled");
  assertEquals(blobs, 0);
  const apps = await Array.fromAsync(Deno.readDir(`${data}`));
  assertEquals(apps.length, 0);
  await Deno.remove(made.home, { recursive: true });
});

Deno.test("apps/releases#R19: source byte와 파일 수를 준비 도중에 센다", async () => {
  const made = await repo();
  const data = `${made.home}/data`;
  await Deno.mkdir(data);
  const huge = new Uint8Array(RELEASE_SOURCE_MAX_BYTES + 1);
  await Deno.writeFile(`${made.source}/huge.bin`, huge);
  await git(made.source, ["add", "huge.bin"]);
  await git(made.source, ["commit", "-m", "huge"]);
  const commit = await git(made.source, ["rev-parse", "HEAD"]);
  const refused = await prepareRelease(input(made.source, commit, data), {
    git: gitCommandRunner(),
  });
  assertEquals(refused.ok, false);
  if (!refused.ok) assertEquals(refused.error.reason, "source_bytes");
  const real = gitCommandRunner();
  const many: GitRunner = {
    async run(args) {
      if (args[2] === "ls-tree") {
        const lines = Array.from(
          { length: RELEASE_FILE_MAX_COUNT + 1 },
          (_unused, index) => `100644 blob h\tfile-${index}.txt`,
        );
        return ok(encoder(`${lines.join("\0")}\0`));
      }
      if (args[2] === "cat-file" && args[3] === "blob") return ok(encoder("x"));
      return await real.run(args);
    },
  };
  const counted = await prepareRelease(
    { ...input(made.source, commit, data), screens: [] },
    { git: many },
  );
  assertEquals(counted.ok, false);
  if (!counted.ok) assertEquals(counted.error.reason, "file_count");
  await Deno.remove(made.home, { recursive: true });
});

const encoder = (value: string) => new TextEncoder().encode(value);

Deno.test("apps/releases#R3: 준비 중 HEAD가 바뀌면 source_changed로 취소한다", async () => {
  const made = await repo();
  const data = `${made.home}/data`;
  await Deno.mkdir(data);
  let calls = 0;
  const git: GitRunner = {
    async run(args) {
      const real = gitCommandRunner();
      calls += 1;
      if (calls > 4 && args.includes("rev-parse") && args.includes("HEAD")) {
        return ok(encoder(`${"ab".repeat(20)}\n`));
      }
      return await real.run(args);
    },
  };
  const moved = await prepareRelease(input(made.source, made.commit, data), {
    git,
  });
  assertEquals(moved.ok, false);
  if (!moved.ok) {
    assert(
      moved.error.reason === "source_changed" ||
        moved.error.reason === "commit_unknown",
    );
  }
  await Deno.remove(made.home, { recursive: true });
});

Deno.test("apps/releases#R1: extract부터 seal과 blob prepare까지 한 흐름이다", async () => {
  const made = await repo();
  const data = `${made.home}/data`;
  await Deno.mkdir(data);
  const hashes: string[] = [];
  const prepared = await prepareRelease(input(made.source, made.commit, data), {
    git: gitCommandRunner(),
    prepareBlob(blob): Promise<Result<{ hash: string; size_bytes: number }>> {
      hashes.push(blob.purpose);
      return Promise.resolve(ok({ hash: "cc".repeat(32), size_bytes: 4 }));
    },
  });
  assert(prepared.ok, prepared.ok ? "" : prepared.error.reason);
  const blueprint = await Deno.readTextFile(
    `${prepared.value.copyPath}/blueprint.json`,
  );
  assert(blueprint.includes("Calendar"));
  const map = await Deno.readTextFile(`${prepared.value.copyPath}/app.js.map`);
  assert(map.includes("sourcesContent"));
  assertEquals(hashes, ["app_bundle"]);
  await widen(prepared.value.copyPath);
  await Deno.remove(made.home, { recursive: true });
});

async function widen(directory: string): Promise<void> {
  await Deno.chmod(directory, 0o755);
  for await (const entry of Deno.readDir(directory)) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory) await widen(path);
    else await Deno.chmod(path, 0o644);
  }
}
