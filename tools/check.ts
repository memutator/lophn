// 빠른 check: deno task check, full check: deno task check:full
// 옵션: --full, --base <rev>
import { PACKAGE_DEPENDENCIES } from "./check-deps.ts";

type Status = "통과" | "실패" | "건너뜀";

type Step = {
  name: string;
  // 차례로 돈다. 하나라도 실패하면 그 단계가 실패다.
  commands: string[][];
  cwd?: string;
  note?: string;
};

type Result = { name: string; status: Status; ms?: number; note?: string };

const SHELL_MAIN = "packages/shell/main";
const ALL_PACKAGES = [
  "base",
  "protocol",
  "core",
  "coding-agent",
  "design",
  "sdk",
  "shell",
  "tools",
  "tests",
];
const FOLDERS: Record<string, string> = Object.fromEntries(
  ALL_PACKAGES.map((
    p,
  ) => [p, p === "tools" || p === "tests" ? p : `packages/${p}`]),
);
// check-deps.ts의 표에 terminal host의 coding-agent와 tools의 넓은 사용을 더한다.
const USES: Record<string, string[]> = {
  ...PACKAGE_DEPENDENCIES,
  shell: [...PACKAGE_DEPENDENCIES.shell, "coding-agent"],
  tools: ALL_PACKAGES.filter((p) => p !== "tools" && p !== "tests"),
  // 어느 package가 바뀌어도 harness가 같이 돈다.
  tests: ALL_PACKAGES.filter((p) => p !== "tests"),
};
// deno test의 discovery에서 뺀다. e2e는 `deno task e2e`, live는 `deno task test:live`로만 돈다.
const NOT_IN_CHECK = ["tests/e2e", "tests/live"];
const under = (f: string, paths: string[]) =>
  paths.some((x) => f === x || f.startsWith(`${x}/`));
// root deno.json의 exclude. 글로브 대신 file 목록을 줄 때 같이 뺀다.
const DENO_EXCLUDED = [
  "packages/shell/main/",
  "packages/shell/preload/",
  "node_modules/",
  "dist/",
  ".claude/",
  ".dev-data/",
  "project-docs/",
];

async function output(command: string[]): Promise<string> {
  const out = await new Deno.Command(command[0], {
    args: command.slice(1),
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (out.code !== 0) return "";
  return new TextDecoder().decode(out.stdout);
}

const lines = (text: string) => text.split("\n").filter((l) => l !== "");

async function changedFiles(base?: string): Promise<string[]> {
  const rev = base ??
    (lines(await output(["git", "merge-base", "HEAD", "main"]))[0] ?? "HEAD");
  const files = [
    ...lines(await output(["git", "diff", "--name-only", rev])),
    ...lines(await output(["git", "ls-files", "-o", "--exclude-standard"])),
  ];
  return files.filter((f) => !f.split("/").includes("node_modules"));
}

// "all"은 전부 바뀐 것으로 본다.
function packageOf(file: string): string | "all" | undefined {
  if (
    file === "deno.json" || file === "deno.lock" ||
    /^tools\/check[^/]*\.ts$/.test(file)
  ) return "all";
  if (file.startsWith("tools/")) return "tools";
  if (file.startsWith("tests/")) return "tests";
  const name = file.split("/")[1];
  return file.startsWith("packages/") && ALL_PACKAGES.includes(name)
    ? name
    : undefined;
}

// 바뀐 package와 그것을 (간접으로라도) 쓰는 package.
function expand(changed: Set<string>): Set<string> {
  const run = new Set(changed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of ALL_PACKAGES) {
      if (!run.has(p) && USES[p].some((u) => run.has(u))) {
        run.add(p);
        grew = true;
      }
    }
  }
  return run;
}

async function sourceFiles(folder: string): Promise<string[]> {
  const all = lines(
    await output(["git", "ls-files", "-co", "--exclude-standard", folder]),
  );
  const found: string[] = [];
  for (const f of new Set(all)) {
    if (!/\.tsx?$/.test(f)) continue;
    if (DENO_EXCLUDED.some((x) => f.startsWith(x))) continue;
    if (await exists(f)) found.push(f);
  }
  return found.sort();
}

// deno fmt·lint에 package 폴더를 통째로 주면 안쪽에 따로 config가 있는 폴더 옆의 file을 건너뛴다
// (shell/ipc, sdk/cap-store에서 겪었다). 그래서 file을 하나씩 준다.
async function packageFiles(
  folder: string,
  pattern: RegExp,
): Promise<string[]> {
  const all = lines(
    await output(["git", "ls-files", "-co", "--exclude-standard", folder]),
  );
  const found: string[] = [];
  for (const f of new Set(all)) {
    if (!pattern.test(f)) continue;
    if (DENO_EXCLUDED.some((x) => f.startsWith(x))) continue;
    if (await exists(f)) found.push(f);
  }
  return found.sort();
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function buildSteps(
  run: Set<string>,
  full: boolean,
  catalogChanged: boolean,
): Promise<{ checks: Step[]; test: Step; skipped: Result[] }> {
  const has = (...names: string[]) => full || names.some((n) => run.has(n));
  const pkgFolders = ALL_PACKAGES.filter((p) => run.has(p)).map((p) =>
    FOLDERS[p]
  );
  const fmtFiles = (await Promise.all(
    pkgFolders.map((f) => packageFiles(f, /\.(tsx?|js|jsonc?)$/)),
  )).flat();
  const lintFiles = (await Promise.all(
    pkgFolders.map((f) => packageFiles(f, /\.(tsx?|js)$/)),
  )).flat();
  const checks: Step[] = [];
  const skipped: Result[] = [];
  const skip = (name: string, note: string) =>
    skipped.push({ name, status: "건너뜀", note });

  if (full) {
    checks.push({ name: "fmt", commands: [["deno", "fmt", "--check"]] });
    checks.push({ name: "lint", commands: [["deno", "lint"]] });
  } else if (pkgFolders.length > 0) {
    checks.push({
      name: "fmt",
      commands: [["deno", "fmt", "--check", ...fmtFiles]],
    });
    checks.push({ name: "lint", commands: [["deno", "lint", ...lintFiles]] });
  } else {
    skip("fmt", "돌 package 없음");
    skip("lint", "돌 package 없음");
  }
  checks.push({
    name: "deps",
    commands: [["deno", "run", "--allow-read", "tools/check-deps.ts"]],
  });

  if (full || run.size > 0) {
    checks.push({
      name: "source",
      commands: [["deno", "run", "--allow-read", "tools/check-source.ts"]],
    });
  } else skip("source", "돌 package 없음");
  // 폴더가 늘거나 줄어도, project-docs/*.yaml이 바뀌어도 돈다.
  if (full || catalogChanged || run.size > 0) {
    checks.push({
      name: "modules",
      commands: [["deno", "run", "--allow-read", "tools/check-modules.ts"]],
    });
  } else skip("modules", "package와 catalog가 안 바뀜");
  // 문서만 바뀐 변경을 잡는 check라 조건 없이 돈다.
  checks.push({
    name: "docs",
    commands: [["deno", "run", "--allow-read", "tools/check-docs.ts"]],
  });

  if (full) {
    // `deno check`에는 --ignore가 없어 file 목록을 준다. package마다 나누면 type check 메모리가 몇 배가 되므로 process 하나로 돈다.
    const files = (await Promise.all(
      ALL_PACKAGES.map((p) => sourceFiles(FOLDERS[p])),
    )).flat();
    checks.push({ name: "check", commands: [["deno", "check", ...files]] });
  } else {
    for (const p of ALL_PACKAGES.filter((p) => run.has(p))) {
      const files = await sourceFiles(FOLDERS[p]);
      if (files.length === 0) continue;
      checks.push({
        name: `check ${p}`,
        commands: [["deno", "check", ...files]],
      });
    }
  }

  if (has("design", "sdk", "shell")) {
    checks.push({
      name: "style",
      commands: [[
        "deno",
        "run",
        "--allow-read",
        "--allow-env",
        "tools/check-style.ts",
      ]],
    });
    checks.push({
      name: "wording",
      commands: [["deno", "run", "--allow-read", "tools/check-wording.ts"]],
    });
  } else {
    skip("style", "design, sdk, shell이 안 돎");
    skip("wording", "design, sdk, shell이 안 돎");
  }
  if (has("design", "tools")) {
    checks.push({
      name: "kit",
      commands: [["deno", "run", "--allow-read", "tools/check-kit.ts"]],
    });
  } else skip("kit", "design, tools가 안 돎");
  if (has("design")) {
    checks.push({
      name: "wording 생성",
      commands: [[
        "deno",
        "run",
        "--allow-read",
        "packages/design/wording/generate.ts",
        "--check",
      ]],
    });
    checks.push({
      name: "token 생성",
      commands: [[
        "deno",
        "run",
        "--allow-read",
        "--allow-run",
        "packages/design/generate.ts",
        "--check",
      ]],
    });
  } else {
    skip("wording 생성", "design이 안 돎");
    skip("token 생성", "design이 안 돎");
  }

  if (has("shell")) {
    const ignore = "--ignore=node_modules,dist";
    checks.push({
      name: "shell fmt",
      cwd: SHELL_MAIN,
      commands: [["deno", "fmt", "--check", ignore, ".", "../preload"]],
    });
    checks.push({
      name: "shell lint",
      cwd: SHELL_MAIN,
      commands: [["deno", "lint", ignore, ".", "../preload"]],
    });
  } else skip("shell fmt/lint", "shell이 안 돎");
  if (has("shell", "protocol", "base", "design", "coding-agent")) {
    const installed = await exists(`${SHELL_MAIN}/node_modules`);
    const commands = [["npm", "--prefix", SHELL_MAIN, "run", "check"]];
    if (!installed) commands.unshift(["npm", "--prefix", SHELL_MAIN, "ci"]);
    checks.push({
      name: "shell main",
      commands,
      note: installed ? undefined : "npm ci를 먼저 돌림",
    });
    const mainTests = lines(
      await output(["git", "ls-files", `${SHELL_MAIN}/*_test.ts`]),
    ).map((f) => f.slice(SHELL_MAIN.length + 1));
    if (mainTests.length > 0) {
      checks.push({
        name: "shell main test",
        cwd: SHELL_MAIN,
        // precheck가 packages/shell/node_modules/zod를 잇는다. "shell main"과 같이 돌아 먼저 한다.
        commands: [["npm", "run", "precheck"], [
          "node",
          "--test",
          "--experimental-strip-types",
          "--no-warnings",
          ...mainTests,
        ]],
      });
    }
  } else skip("shell main", "shell 쪽이 안 돎");

  const testArgs = ["deno", "test", "--no-check"];
  if (full) testArgs.push("--parallel");
  // CLI --ignore는 root deno.json의 exclude를 더하지 않고 대체하므로 둘 다 담는다.
  const ignore = [...DENO_EXCLUDED, ...NOT_IN_CHECK];
  testArgs.push(
    "--allow-all",
    "--permit-no-files",
    `--ignore=${ignore.join(",")}`,
  );
  if (!full) {
    testArgs.push(
      ...(await Promise.all(
        pkgFolders.map((f) => packageFiles(f, /_test\.tsx?$/)),
      )).flat().filter((f) => !under(f, NOT_IN_CHECK)),
    );
  }
  return { checks, test: { name: "test", commands: [testArgs] }, skipped };
}

const running = new Set<Deno.ChildProcess>();
let aborted = false;

function killAll() {
  for (const child of running) {
    try {
      child.kill("SIGTERM");
    } catch { /* 이미 끝남 */ }
  }
}

type Done = { step: Step; result: Result; text: string };

async function runStep(step: Step): Promise<Done> {
  const start = Date.now();
  let text = "";
  let ok = true;
  for (const command of step.commands) {
    if (aborted) {
      ok = false;
      break;
    }
    try {
      const child = new Deno.Command(command[0], {
        args: command.slice(1),
        cwd: step.cwd,
        // test는 DENO_JOBS가 환경에 없으면 8로 돈다.
        env: command[1] === "test"
          ? { DENO_JOBS: Deno.env.get("DENO_JOBS") ?? "8" }
          : undefined,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      running.add(child);
      const out = await child.output();
      running.delete(child);
      const decoder = new TextDecoder();
      text += decoder.decode(out.stdout) + decoder.decode(out.stderr);
      if (out.code !== 0) {
        ok = false;
        break;
      }
    } catch (error) {
      text += `${error}\n`;
      ok = false;
      break;
    }
  }
  return {
    step,
    text,
    result: {
      name: step.name,
      status: ok ? "통과" : "실패",
      ms: Date.now() - start,
      note: step.note,
    },
  };
}

// 한 묶음을 동시에 돈다. 첫 실패에서 나머지를 멈추고 그 출력을 낸다.
async function runStage(steps: Step[], results: Result[]): Promise<boolean> {
  let failed: Done | undefined;
  const dones = await Promise.all(steps.map(async (step) => {
    const done = await runStep(step);
    if (done.result.status === "실패" && !aborted) {
      aborted = true;
      failed = done;
      killAll();
    }
    return done;
  }));
  for (const done of dones) {
    if (done.result.status === "실패" && done !== failed) {
      results.push({ name: done.step.name, status: "건너뜀", note: "중단" });
    } else results.push(done.result);
  }
  if (failed) {
    const { step, text } = failed;
    console.log(`--- ${step.name} 실패 ---`);
    console.log(text.trimEnd());
    console.log("");
  }
  return !failed;
}

function table(results: Result[]): string {
  const head = ["단계", "결과", "시간", "비고"];
  const rows = results.map((r) => [
    r.name,
    r.status,
    r.ms === undefined ? "" : `${(r.ms / 1000).toFixed(1)}s`,
    r.note ?? "",
  ]);
  // 한글은 두 칸이라 너비를 따로 센다.
  const width = (s: string) =>
    [...s].reduce((n, c) => n + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  const widths = head.map((h, i) =>
    Math.max(width(h), ...rows.map((r) => width(r[i])))
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c + " ".repeat(widths[i] - width(c))).join("  ")
      .trimEnd();
  return [
    line(head),
    "-".repeat(widths.reduce((a, b) => a + b + 2, -2)),
    ...rows.map(line),
  ].join("\n");
}

async function main() {
  const full = Deno.args.includes("--full");
  const baseIndex = Deno.args.indexOf("--base");
  const base = baseIndex >= 0 ? Deno.args[baseIndex + 1] : undefined;

  let run: Set<string>;
  let catalogChanged = false;
  if (full) {
    run = new Set(ALL_PACKAGES);
    console.log("바뀐 package: 전부 (--full)");
  } else {
    const files = await changedFiles(base);
    catalogChanged = files.some((f) => /^project-docs\/[^/]+\.yaml$/.test(f));
    const changed = new Set<string>();
    let everything = files.length === 0;
    for (const f of files) {
      const p = packageOf(f);
      if (p === "all") everything = true;
      else if (p) changed.add(p);
    }
    if (everything) {
      run = new Set(ALL_PACKAGES);
      console.log(
        files.length === 0
          ? "바뀐 package: 전부 (비교 기준 없음)"
          : "바뀐 package: 전부 (deno.json, deno.lock, tools/check 변경)",
      );
    } else {
      run = expand(changed);
      const names = (set: Set<string>) =>
        ALL_PACKAGES.filter((p) => set.has(p)).join(", ") || "없음";
      console.log(
        `바뀐 package: ${names(changed)} / 도는 package: ${names(run)}`,
      );
    }
  }

  Deno.addSignalListener("SIGINT", () => {
    aborted = true;
    killAll();
    Deno.exit(130);
  });

  const { checks, test, skipped } = await buildSteps(run, full, catalogChanged);
  const results: Result[] = [];
  let ok = await runStage(checks, results);
  if (ok) ok = await runStage([test], results);
  else results.push({ name: "test", status: "건너뜀", note: "check 실패" });
  results.push(...skipped);

  console.log(table(results));
  Deno.exit(ok ? 0 : 1);
}

if (import.meta.main) await main();
