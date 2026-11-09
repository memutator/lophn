// 빠른 check: npm run check, full check: npm run check:full
// 옵션: --full, --base <rev>
import { type ChildProcess, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { availableParallelism, constants, setPriority } from "node:os";
import process from "node:process";
import { platformNpmCliPath } from "../packages/core/supervision/security/node-shims.ts";
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
// `.bin/`은 Windows에서 .cmd라 shell 없이 못 띄운다. 패키지의 JS 입구를 이 node로 띄운다.
const BIOME_CMD = [process.execPath, "node_modules/@biomejs/biome/bin/biome"];
const TSC = [process.execPath, "node_modules/typescript/bin/tsc"];
// npm도 Windows에서는 npm.cmd다. npm의 JS 입구를 띄운다.
const NPM = [process.execPath, platformNpmCliPath()];
// test는 core를 import하므로 Temporal이 있는 Electron의 Node로 띄운다. plain node에는 Temporal이 없다.
const ELECTRON = createRequire(import.meta.url)("electron") as string;
const ALL_PACKAGES = [
  "base",
  "protocol",
  "core",
  "cli",
  "coding-agent",
  "design",
  "sdk",
  "shell",
  "tools",
  "tests",
];
const FOLDERS: Record<string, string> = Object.fromEntries(
  ALL_PACKAGES.map((p) => [
    p,
    p === "tools" || p === "tests" ? p : `packages/${p}`,
  ]),
);
// check-deps.ts의 표에 terminal host의 coding-agent와 tools의 넓은 사용을 더한다.
const USES: Record<string, string[]> = {
  ...PACKAGE_DEPENDENCIES,
  shell: [...PACKAGE_DEPENDENCIES.shell, "coding-agent"],
  // binary 입구(main.ts)만 coding-agent의 local 명령을 끼운다.
  cli: [...PACKAGE_DEPENDENCIES.cli, "coding-agent"],
  tools: ALL_PACKAGES.filter((p) => p !== "tools" && p !== "tests"),
  // 어느 package가 바뀌어도 harness가 같이 돈다.
  tests: ALL_PACKAGES.filter((p) => p !== "tests"),
};
// agent 여럿이 check를 겹쳐 돌리면 core와 memory를 다 먹어 사람이 쓰는 터미널·창이 밀린다. 그래서 check는 낮은
// 우선순위로 돌고(자식이 물려받는다), 무거운 둘의 동시 수를 묶는다. TypeScript 7 tsc는 혼자서도 여러 thread를 쓰고
// project 하나에 1GB 넘게 잡는다. test는 file마다 Electron process 하나다.
const TSC_AT_ONCE = 4;
const TEST_CONCURRENCY = `--test-concurrency=${Math.max(2, Math.floor(availableParallelism() / 3))}`;
// check의 test에서 뺀다. e2e는 `npm run e2e`, live는 `npm run test:live`로만 돈다.
const NOT_IN_CHECK = ["tests/e2e", "tests/live"];
const under = (f: string, paths: string[]) =>
  paths.some((x) => f === x || f.startsWith(`${x}/`));
// file 목록을 만들 때 뺄 폴더. shell main·preload는 shell 단계에서 따로 돈다.
const EXCLUDED = [
  "packages/shell/main/",
  "packages/shell/preload/",
  "node_modules/",
  "dist/",
  "build/",
  ".claude/",
  ".dev-data/",
  "project-docs/",
];

type Captured = { code: number | null; stdout: string; stderr: string };

// stdout·stderr를 끝까지 읽은 뒤 close(exit code)를 기다린다.
function collect(child: ChildProcess): Promise<Captured> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => (stdout += chunk));
    child.stderr!.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function output(command: string[]): Promise<string> {
  const out = await collect(
    spawn(command[0], command.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  if (out.code !== 0) return "";
  return out.stdout;
}

const lines = (text: string) => text.split("\n").filter((l) => l !== "");

async function changedFiles(base?: string): Promise<string[]> {
  const rev =
    base ??
    lines(await output(["git", "merge-base", "HEAD", "main"]))[0] ??
    "HEAD";
  const files = [
    ...lines(await output(["git", "diff", "--name-only", rev])),
    ...lines(await output(["git", "ls-files", "-o", "--exclude-standard"])),
  ];
  return files.filter((f) => !f.split("/").includes("node_modules"));
}

// "all"은 전부 바뀐 것으로 본다.
function packageOf(file: string): string | "all" | undefined {
  if (
    file === "package.json" ||
    file === "package-lock.json" ||
    file === "biome.json" ||
    /^tools\/check[^/]*\.ts$/.test(file)
  )
    return "all";
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

// 바뀐 package의 file 목록을 만든다. Biome은 file로 줘도 biome.json의 include·exclude를 따른다.
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
    if (EXCLUDED.some((x) => f.startsWith(x))) continue;
    if (await exists(f)) found.push(f);
  }
  return found.sort();
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// package마다 type check하는 tsc project(tsconfig.json이 있는 폴더). shell main·preload·ipc·terminal-host는
// "shell main" 단계의 `npm run check`가 본다.
const TSC_PROJECTS: Record<string, string[]> = {
  base: ["packages/base"],
  protocol: ["packages/protocol"],
  core: ["packages/core"],
  cli: ["packages/cli"],
  "coding-agent": ["packages/coding-agent"],
  design: ["packages/design", "packages/design/i18n"],
  sdk: ["packages/sdk", "packages/sdk/flow"],
  shell: ["packages/shell/renderer"],
  tools: ["tools", "tools/wireframes"],
  tests: ["tests"],
};
function typeChecks(p: string): string[][] {
  return TSC_PROJECTS[p].map((dir) => [...TSC, "--noEmit", "-p", dir]);
}

async function buildSteps(
  run: Set<string>,
  full: boolean,
  catalogChanged: boolean,
): Promise<{ checks: Step[]; test: Step; skipped: Result[] }> {
  const has = (...names: string[]) => full || names.some((n) => run.has(n));
  const pkgFolders = ALL_PACKAGES.filter((p) => run.has(p)).map(
    (p) => FOLDERS[p],
  );
  const fmtFiles = (
    await Promise.all(
      pkgFolders.map((f) => packageFiles(f, /\.(tsx?|js|jsonc?)$/)),
    )
  ).flat();
  const lintFiles = (
    await Promise.all(pkgFolders.map((f) => packageFiles(f, /\.(tsx?|js)$/)))
  ).flat();
  const checks: Step[] = [];
  const skipped: Result[] = [];
  const skip = (name: string, note: string) =>
    skipped.push({ name, status: "건너뜀", note });

  // 전부 도는데 file 이름을 늘어놓으면 Windows 명령줄 한도(32K)를 넘는다. biome.json 범위가 같으니 목록 없이 돈다.
  if (full || run.size === ALL_PACKAGES.length) {
    checks.push({ name: "fmt", commands: [[...BIOME_CMD, "format"]] });
    checks.push({ name: "lint", commands: [[...BIOME_CMD, "lint"]] });
  } else if (pkgFolders.length > 0) {
    checks.push({
      name: "fmt",
      commands: [
        [...BIOME_CMD, "format", "--no-errors-on-unmatched", ...fmtFiles],
      ],
    });
    checks.push({
      name: "lint",
      commands: [
        [...BIOME_CMD, "lint", "--no-errors-on-unmatched", ...lintFiles],
      ],
    });
  } else {
    skip("fmt", "돌 package 없음");
    skip("lint", "돌 package 없음");
  }
  checks.push({
    name: "deps",
    commands: [["node", "tools/check-deps.ts"]],
  });

  if (full || run.size > 0) {
    checks.push({
      name: "source",
      commands: [["node", "tools/check-source.ts"]],
    });
  } else skip("source", "돌 package 없음");
  // 폴더가 늘거나 줄어도, project-docs/*.yaml이 바뀌어도 돈다.
  if (full || catalogChanged || run.size > 0) {
    checks.push({
      name: "modules",
      commands: [["node", "tools/check-modules.ts"]],
    });
  } else skip("modules", "package와 catalog가 안 바뀜");
  // 문서만 바뀐 변경을 잡는 check라 조건 없이 돈다.
  checks.push({
    name: "docs",
    commands: [["node", "tools/check-docs.ts"]],
  });
  // entry나 test file은 어느 package를 고쳐도 늘거나 줄어 flow catalog가 틀어지므로 조건 없이 돈다.
  checks.push({
    name: "flows",
    commands: [["node", "tools/flows.ts", "check"]],
  });
  // issue·change-log yaml과 architecture 문서의 꼴은 문서만 바뀌어도 틀어지므로 조건 없이 돈다.
  checks.push({
    name: "records",
    commands: [["node", "tools/records.ts", "check"]],
  });
  // SDK 판을 올리고 메모를 빼먹는 변경은 sdk 폴더만 바뀌므로 조건 없이 돈다.
  checks.push({
    name: "sdk notes",
    commands: [["node", "tools/check-sdk-notes.ts"]],
  });

  for (const p of ALL_PACKAGES.filter((p) => full || run.has(p))) {
    const commands = typeChecks(p);
    if (commands.length > 0) checks.push({ name: `check ${p}`, commands });
  }

  if (has("design", "sdk", "shell")) {
    checks.push({
      name: "style",
      commands: [["node", "tools/check-style.ts"]],
    });
  } else skip("style", "design, sdk, shell이 안 돎");
  if (has("design", "tools")) {
    checks.push({
      name: "kit",
      commands: [["node", "tools/check-kit.ts"]],
    });
  } else skip("kit", "design, tools가 안 돎");
  // 브라우저(offscreen Electron)로 gallery 전체를 그리는 데 30초쯤 걸려 check:full에서만 돈다.
  if (full) {
    checks.push({
      name: "wireframes smoke",
      commands: [["node", "tools/wireframes/smoke.ts"]],
    });
  } else skip("wireframes smoke", "full에서만 돎");
  if (has("design")) {
    checks.push({
      name: "token 생성",
      commands: [["node", "packages/design/generate.ts", "--check"]],
    });
  } else skip("token 생성", "design이 안 돎");

  if (has("shell")) {
    // shell main과 preload는 EXCLUDED라 공용 fmt/lint에서 빠지므로 따로 돈다.
    const dirs = [SHELL_MAIN, "packages/shell/preload"];
    checks.push({
      name: "shell fmt",
      commands: [[...BIOME_CMD, "format", ...dirs]],
    });
    checks.push({
      name: "shell lint",
      commands: [[...BIOME_CMD, "lint", ...dirs]],
    });
  } else skip("shell fmt/lint", "shell이 안 돎");
  if (has("shell", "protocol", "base", "design", "coding-agent")) {
    // shell main은 root npm workspace의 member다. 의존은 root node_modules에 있다.
    const installed = await exists("node_modules");
    const commands = [[...NPM, "--prefix", SHELL_MAIN, "run", "check"]];
    if (!installed) commands.unshift([...NPM, "ci"]);
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
        commands: [
          [
            "node",
            "--test",
            TEST_CONCURRENCY,
            "--experimental-strip-types",
            "--no-warnings",
            ...mainTests,
          ],
        ],
      });
    }
  } else skip("shell main", "shell 쪽이 안 돎");

  // 바뀐 package의 test만 돈다. full이면 pkgFolders가 전부다.
  const testFiles = (
    await Promise.all(pkgFolders.map((f) => packageFiles(f, /_test\.tsx?$/)))
  )
    .flat()
    .filter((f) => !under(f, NOT_IN_CHECK));
  const commands: string[][] = [];
  if (testFiles.length > 0)
    commands.push([ELECTRON, "--test", TEST_CONCURRENCY, ...testFiles]);
  return { checks, test: { name: "test", commands }, skipped };
}

const running = new Set<ChildProcess>();
let aborted = false;

function killAll() {
  for (const child of running) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* 이미 끝남 */
    }
  }
}

let tscRunning = 0;
const tscWaiting: (() => void)[] = [];
async function tscSlot(): Promise<() => void> {
  if (tscRunning < TSC_AT_ONCE) tscRunning++;
  else await new Promise<void>((resolve) => tscWaiting.push(resolve));
  // 기다리는 쪽이 있으면 자리를 그대로 넘긴다. 세었다 줄였다 하면 그 사이에 다른 쪽이 끼어든다.
  return () => {
    const next = tscWaiting.shift();
    if (next) next();
    else tscRunning--;
  };
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
    const release = command[1] === TSC[1] ? await tscSlot() : undefined;
    if (aborted) {
      release?.();
      ok = false;
      break;
    }
    try {
      const child = spawn(command[0], command.slice(1), {
        cwd: step.cwd,
        // Electron binary는 ELECTRON_RUN_AS_NODE가 있어야 Node처럼 뜬다.
        env:
          command[0] === ELECTRON
            ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
            : undefined,
        stdio: ["ignore", "pipe", "pipe"],
      });
      running.add(child);
      const out = await collect(child);
      running.delete(child);
      text += out.stdout + out.stderr;
      if (out.code !== 0) {
        ok = false;
        break;
      }
    } catch (error) {
      text += `${error}\n`;
      ok = false;
      break;
    } finally {
      release?.();
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
  const dones = await Promise.all(
    steps.map(async (step) => {
      const done = await runStep(step);
      if (done.result.status === "실패" && !aborted) {
        aborted = true;
        failed = done;
        killAll();
      }
      return done;
    }),
  );
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
    Math.max(width(h), ...rows.map((r) => width(r[i]))),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c + " ".repeat(widths[i] - width(c)))
      .join("  ")
      .trimEnd();
  return [
    line(head),
    "-".repeat(widths.reduce((a, b) => a + b + 2, -2)),
    ...rows.map(line),
  ].join("\n");
}

async function main() {
  setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
  const args = process.argv.slice(2);
  const full = args.includes("--full");
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : undefined;

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
          : "바뀐 package: 전부 (package.json, package-lock.json, tools/check 변경)",
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

  process.on("SIGINT", () => {
    aborted = true;
    killAll();
    process.exit(130);
  });

  const { checks, test, skipped } = await buildSteps(run, full, catalogChanged);
  const results: Result[] = [];
  let ok = await runStage(checks, results);
  if (!ok) {
    results.push({ name: "test", status: "건너뜀", note: "check 실패" });
  } else if (test.commands.length === 0) {
    results.push({ name: "test", status: "건너뜀", note: "돌 package 없음" });
  } else {
    ok = await runStage([test], results);
  }
  results.push(...skipped);

  console.log(table(results));
  process.exit(ok ? 0 : 1);
}

if (import.meta.main) await main();
