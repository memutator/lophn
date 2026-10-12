// 일부러 깨지는 앱 fixture를 끝까지 돌린다(apps#T26). 깨진 종류는 환경 값이 아니라 fixture 설정
// (src/board.ts의 MODE)으로 고른다. 앱 폴더를 temp로 풀어 자기 test·type 검사를 지나고, board A의
// source commit이 봉인 bundle이 되고, problems app test의 선언 검사를 지나는지 본다. board 모드
// 다섯(A 깨짐, B 고침, C 약화, D 여전히 깨짐, E 다른 실패)은 각자 source commit을 만들어 서로 다른
// bundle hash가 남는다(판마다 source commit이 따로 있어 T6 bundle 준비와 release 준비로
// 이어진다). runtime 깨짐은 감독 harness(R2 시작 실패·handler 불일치, R19 반복 종료)와 실제
// 자식 프로세스(R22 stderr·exit 1, R28 V8 OOM 근거 구별)로 본다. data 깨짐은 fixture와 같은
// migration 두 단계(R7 둘째 단계 실패 복원)와 activation 실패(R11 이전 release 복귀)로 본다.
// 사람 데이터 root(~/.lophn, ~/.config/lophn)는 열지 않고 temp dir만 쓴다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  createIdSource,
  cryptoRandom,
  manualClock,
  ok,
  type Result,
  sha256Hex,
} from "../../packages/base/mod.ts";
import type { ObservedExceptionInput } from "../../packages/protocol/problems/mod.ts";
import { exceptionObservationInputSchema } from "../../packages/protocol/problems/mod.ts";
import { prepareFromSource } from "../../packages/core/apps/releases/prepare/from-source.ts";
import { verifySealedPermissions } from "../../packages/core/apps/releases/mod.ts";
import type {
  CoreLink,
  RuntimeRecord,
} from "../../packages/core/apps/runtime/core-link.ts";
import {
  CRASH_EVIDENCE,
  type CrashEvent,
  createCrashObserver,
} from "../../packages/core/apps/runtime/observations/crash.ts";
import { createSupervisor } from "../../packages/core/apps/runtime/supervisor/supervisor.ts";
import type {
  AppChild,
  DesiredApp,
  ProbeResult,
} from "../../packages/core/apps/runtime/supervisor/supervisor.ts";
import {
  migrateAppDatabase,
  type MigrationScript,
} from "../../packages/core/apps/data/worker/migrate.ts";
import { createAppBackup } from "../../packages/core/apps/data/worker/backup.ts";
import { openAppDatabase } from "../../packages/core/apps/data/worker/db.ts";
import { verifyDatabase } from "../../packages/core/apps/data/worker/integrity.ts";
import {
  generateAppTestChecks,
  loadSources,
  scanCodeUsage,
  sdkDependenciesHash,
} from "../../packages/core/problems/tests/mod.ts";
import {
  devImportMap,
  readTemplateDirectory,
} from "../../packages/core/apps/packages/mod.ts";
import {
  APP_TEST_ARGS,
  deno,
  installedHome,
  removeTree,
} from "../../packages/core/apps/packages/testing/mod.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const IMPORT_MAP = "--import-map=.lophn/import-map.json";
const FIXTURE = new URL("../../fixtures/apps/broken/", import.meta.url)
  .pathname;

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

type Made = {
  parent: string;
  dir: string;
  home: string;
  // board 모드를 바꾼다(환경 값이 아니라 fixture 설정으로 고른다).
  board: (mode: string) => Promise<void>;
  commit: () => Promise<string>;
  dispose: () => Promise<void>;
};

// 저장소의 fixture 원본(`.tmpl`)을 앱 폴더로 풀고 개발용 import map을 둔다.
async function madeApp(): Promise<Made> {
  const installed = await installedHome();
  const parent = await Deno.makeTempDir({ prefix: "lophn-broken-app-" });
  const dir = `${parent}/app`;
  const config = JSON.parse(
    await Deno.readTextFile(`${FIXTURE}/deno.json.tmpl`),
  ) as { imports: Record<string, string> };
  const files = await readTemplateDirectory(FIXTURE, { stripSuffix: true });
  assert(files.ok, files.ok ? "" : files.error.message);
  for (const file of files.value) {
    const target = `${dir}/${file.path}`;
    await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.writeFile(target, file.bytes);
  }
  await Deno.mkdir(`${dir}/.lophn`);
  await Deno.writeTextFile(
    `${dir}/.lophn/import-map.json`,
    JSON.stringify(devImportMap(config.imports, installed.sdkRoot, dir)),
  );
  const board = async (mode: string): Promise<void> => {
    const path = `${dir}/src/board.ts`;
    const source = await Deno.readTextFile(path);
    const changed = source.replace(
      /export const MODE: BoardMode = "[A-E]+";/,
      `export const MODE: BoardMode = "${mode}";`,
    );
    assert(changed !== source, `board mode ${mode} did not apply`);
    await Deno.writeTextFile(path, changed);
  };
  const commit = async (): Promise<string> => {
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "board"]);
    return await git(dir, ["rev-parse", "HEAD"]);
  };
  return {
    parent,
    dir,
    home: installed.home,
    board,
    commit,
    async dispose() {
      await removeTree(parent);
      await installed.dispose();
    },
  };
}

type EvaluatedBlueprint = {
  sdk_dependencies: { name: string; version: string }[];
  problem_codes: { code: string }[];
  screens: { key: string; path: string; sizes: string[] }[];
  commands: { key: string; effect: string }[];
};

async function evaluate(
  dir: string,
): Promise<{ text: string; value: EvaluatedBlueprint }> {
  const evaluated = await deno(dir, [
    "eval",
    IMPORT_MAP,
    "--allow-read",
    `import b from "file://${dir}/blueprint.ts"; console.log(JSON.stringify(b));`,
  ]);
  assertEquals(evaluated.code, 0, evaluated.stderr);
  return {
    text: evaluated.stdout,
    value: JSON.parse(evaluated.stdout) as EvaluatedBlueprint,
  };
}

Deno.test(
  "apps/blueprint#R19 apps/runtime#R2 apps/runtime#R28 problems/tests#R18: 깨진 앱이 잠긴 lock으로 type 검사와 자기 test를 통과하고 선언 실패 경로·틀린 집계·미선언 code test가 모두 돈다",
  async () => {
    const made = await madeApp();
    try {
      const check = await deno(made.dir, [
        "check",
        IMPORT_MAP,
        "--frozen-lockfile",
        "--cached-only",
        "main.ts",
        "blueprint.ts",
        "src",
        "scripts",
        "tests",
      ]);
      assertEquals(check.code, 0, check.stderr);
      const tests = await deno(made.dir, APP_TEST_ARGS);
      assertEquals(tests.code, 0, tests.stderr + tests.stdout);
      for (
        const name of [
          "apps/blueprint#R19: panel 화면은",
          "apps/runtime#R2: run_broken은",
          "apps/runtime#R28: 선언한 problem code는",
          "blueprint: the declaration is valid",
          "blueprint: every declared command has a registered handler",
          "blueprint: sdk_dependencies are exact",
          "failure_path:fixture_broken run_broken reports the declared code",
          "failure_path:fixture_broken run_broken type_error leaves",
          "failure_path:fixture_broken flood_reports sends more",
          "failure_path:fixture_broken chatter_then_fail fails",
          "failure_path:fixture_broken list_broken answers a wrong aggregate",
          "failure_path:fixture_misconfigured read_settings reports the declared code",
          "report_wrong_code sends an undeclared code; fixture_misconfigured comes only from read_settings",
          "wording: placeholders.ts is generated",
        ]
      ) assert(tests.stdout.includes(name), `${name} did not run`);
    } finally {
      await made.dispose();
    }
  },
);

Deno.test(
  "apps/blueprint#R19 apps/runtime#R2 apps/data#R7: board A source → 봉인 bundle → problems 선언 검사가 통과하고 migration 두 단계와 problem code 2개가 bundle에 그대로 담긴다",
  async () => {
    const made = await madeApp();
    try {
      const blueprint = await evaluate(made.dir);
      assertEquals(blueprint.value.screens[0].sizes, ["full", "panel"]);
      assertEquals(
        blueprint.value.problem_codes.map((code) => code.code).sort(),
        ["fixture_broken", "fixture_misconfigured"],
      );

      // source commit에서 봉인 bundle까지. 앱의 build script는 실행되지 않고
      // src/screens/<key>/main.tsx가 build된다.
      await git(made.dir, ["init", "-q"]);
      await git(made.dir, ["config", "user.email", "dev@lophn.local"]);
      await git(made.dir, ["config", "user.name", "dev"]);
      await git(made.dir, ["add", "-A"]);
      await git(made.dir, ["commit", "-q", "-m", "init"]);
      const commit = await git(made.dir, ["rev-parse", "HEAD"]);
      const prepared = await prepareFromSource({
        dataRoot: made.home,
        app: APP,
        sourceRoot: made.dir,
        commit,
      });
      assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
      const sealed = await verifySealedPermissions(prepared.value.copyPath);
      assert(sealed.ok, sealed.ok ? "" : sealed.error.message);
      const paths = prepared.value.manifest.files.map((file) => file.path);
      for (
        const path of [
          "main.ts",
          "deno.lock",
          "blueprint.json",
          "import-map.json",
          "migrations/0-1.sql",
          "migrations/1-3.sql",
          "src/commands.ts",
          "src/board.ts",
          "screens/panel/main.js",
          "screens/panel/index.html",
          "screens/panel/main.css",
          "sdk/cap-problem/1.0.0/mod.ts",
          "sdk/cap-schedule/1.0.0/mod.ts",
          "sdk/design/1.0.0/mod.ts",
          "sdk/ui-state/1.0.0/mod.ts",
        ]
      ) assert(paths.includes(path), `${path} is not in the bundle`);
      // AGENTS.md·CLAUDE.md는 bundle에 들어가지 않는다(release exclude).
      assert(!paths.includes("AGENTS.md"));
      assert(!paths.includes("CLAUDE.md"));
      const bundled = JSON.parse(
        await Deno.readTextFile(`${prepared.value.copyPath}/blueprint.json`),
      ) as EvaluatedBlueprint;
      assertEquals(bundled.screens.map((item) => [item.key, item.sizes]), [
        ["panel", ["full", "panel"]],
      ]);
      const sdk = bundled.sdk_dependencies;

      // problems app test의 선언 검사. 고정 SDK·선언 code의 실패 경로가 모두 맞다.
      const failureTest = await sha256Hex("failure_path:fixture_broken");
      const plan = generateAppTestChecks({
        bundle_hash: prepared.value.bundleHash,
        test_hash: failureTest,
        blueprint: bundled as never,
        data: { schema: 3, previous_schema: null },
        blueprint_hash: prepared.value.blueprintHash,
        frozen: {
          blueprint: prepared.value.blueprintHash,
          sdk_dependencies: sdkDependenciesHash(sdk),
          failure_paths: bundled.problem_codes.map((item) => ({
            code: item.code,
            test_hash: failureTest,
          })),
        },
        fixed_sdk: sdk,
        previous_declarations: null,
      });
      const precomputed = plan.checks.filter((check) => check.precomputed);
      assertEquals(
        precomputed.map((check) => check.name).sort(),
        ["declarations", "failure_path_coverage", "fixed_sdk"],
      );
      for (const check of precomputed) {
        assertEquals(
          check.precomputed?.status,
          "pass",
          check.precomputed?.reason,
        );
      }
      const status = Object.fromEntries(
        plan.checks.map((check) => [check.name, check.status]),
      );
      // 마지막 단계가 1→3이라 schema 3이고 이전 release가 없다.
      assertEquals(status["migration_empty"], "required");
      assertEquals(status["migration_upgrade"], "not_applicable");
      // read command가 있어 read 계약 검사가 필수이고, 되돌림·secret·automation이
      // 없어 그 검사는 해당 없음이다.
      assertEquals(status["read_contract"], "required");
      assertEquals(status["revert_restore"], "not_applicable");
      assertEquals(status["revert_conflict"], "not_applicable");
      assertEquals(status["revert_duplicate"], "not_applicable");
      assertEquals(status["secret_grant"], "not_applicable");
      assertEquals(status["automation_scope"], "not_applicable");
      // app_connections가 있어 바깥에 닿는 기능의 검사는 필수다.
      assertEquals(status["adapter_isolation"], "required");
      assert(plan.harness.has_view);
      const usage = scanCodeUsage(await loadSources(made.dir));
      // read_settings가 fixture 설정 실패로 fixture_misconfigured를 literal로 보고한다(apps#T26 완료 1번).
      assertEquals(
        [...new Set(usage.literals.map((use) => use.code))].sort(),
        ["fixture_broken", "fixture_misconfigured"],
      );
      // report_wrong_code의 reportProblem 호출은 literal이 아니므로 동적 사용이 하나 남는다.
      assertEquals(usage.dynamic.length, 1);
    } finally {
      await made.dispose();
    }
  },
);

Deno.test(
  "apps/blueprint#R19 problems/tests#R18: board 모드 다섯(A 깨짐, B 고침, C 약화, D 여전히 깨짐, E 다른 실패)은 각자 source commit을 만들어 서로 다른 bundle hash가 남는다",
  async () => {
    const made = await madeApp();
    try {
      await git(made.dir, ["init", "-q"]);
      await git(made.dir, ["config", "user.email", "dev@lophn.local"]);
      await git(made.dir, ["config", "user.name", "dev"]);
      await git(made.dir, ["add", "-A"]);
      await git(made.dir, ["commit", "-q", "-m", "init"]);
      const hashes: string[] = [];
      // 템플릿 MODE는 이미 A다(바꾸면 assert가 실패한다). init commit이 A의 source commit이다.
      const initCommit = await git(made.dir, ["rev-parse", "HEAD"]);
      const preparedA = await prepareFromSource({
        dataRoot: made.home,
        app: APP,
        sourceRoot: made.dir,
        commit: initCommit,
      });
      assert(preparedA.ok, preparedA.ok ? "" : JSON.stringify(preparedA.error));
      hashes.push(preparedA.value.bundleHash);
      for (const mode of ["B", "C", "D", "E"]) {
        await made.board(mode);
        const commit = await made.commit();
        const prepared = await prepareFromSource({
          dataRoot: made.home,
          app: APP,
          sourceRoot: made.dir,
          commit,
        });
        assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
        hashes.push(prepared.value.bundleHash);
      }
      // 같은 고정 reproduction test를 A→B/C/D/E에 적용할 수 있다(판마다 commit이 따로).
      assertEquals(new Set(hashes).size, 5);
    } finally {
      await made.dispose();
    }
  },
);

// supervisor 감독 harness다(R2·R19 실패 경로). 실제 자식은 띄우지 않는다.
type Harness = {
  records: RuntimeRecord[];
  events: { kind: string; reason?: { code?: string; summary?: string } }[];
  spawned: number;
  alive: () => number;
  child: (index: number) => FakeChild;
  supervisor: ReturnType<typeof createSupervisor>;
  clock: ReturnType<
    typeof import("../../packages/base/mod.ts").manualClock
  >;
};

type FakeChild = AppChild & {
  kill: (code: number | null) => void;
  stopRequests: number;
};

function brokenHarness(options: {
  probe?: (index: number) => ProbeResult | Promise<ProbeResult>;
} = {}): Harness {
  const clock = manualClock(0);
  const records: RuntimeRecord[] = [];
  const events: SupervisorEventList[number][] = [];
  const children: FakeChild[] = [];
  let nonce = 0;
  const core: CoreLink = {
    record(record: RuntimeRecord): Promise<Result<{ state: string }>> {
      records.push(record);
      return Promise.resolve(ok({ state: "recorded" }));
    },
  } as unknown as CoreLink;
  const supervisor = createSupervisor({
    clock,
    core,
    deno: () => "/usr/bin/deno",
    environment: { home: "/h", denoDir: "/d", xdgCacheHome: "/c", path: "/p" },
    socketPaths: (app) => {
      void app;
      return { broker: "/run/b.sock", direct: "/run/a.sock" };
    },
    nonce: () => `nonce-${nonce++}`,
    credential: () => "broker-credential",
    onEvent: (event) => events.push(event as never),
    verifyKey: () => "v".repeat(43),
    readyTimeoutMs: 30_000,
    spawn(request): Promise<AppChild> {
      let resolveExit: (code: number | null) => void = () => {};
      const exited = new Promise<number | null>((resolve) => {
        resolveExit = resolve;
      });
      const child: FakeChild = {
        identity: {
          pid: 100 + children.length,
          startedAtMs: request.identity.startedAtMs,
          processNonce: request.identity.processNonce,
        },
        exited,
        stopRequests: 0,
        terminate() {
          child.stopRequests += 1;
          resolveExit(0);
          return Promise.resolve(true);
        },
        kill(code) {
          resolveExit(code);
        },
      };
      children.push(child);
      return Promise.resolve(child);
    },
    probe(_child, _direct) {
      const result = options.probe?.(children.length - 1) ?? {
        ok: true as const,
        commands: ["panel_context", "list_broken"],
        dataSchema: 3,
        bundleHash: "ab".repeat(32),
      };
      return Promise.resolve(result);
    },
    wait: () => Promise.resolve(),
  });
  return {
    records,
    events,
    get spawned() {
      return children.length;
    },
    alive: () => children.filter((child) => child.stopRequests === 0).length,
    child: (index) => children[index],
    supervisor,
    clock,
  };
}

type SupervisorEventList = readonly {
  kind: string;
  reason?: { code?: string; summary?: string };
  exits?: number;
}[];

const BROKEN_DESIRED: Omit<DesiredApp, "app" | "release"> = {
  bundleHash: "ab".repeat(32),
  runEnabled: true,
  archived: false,
  commands: ["panel_context", "list_broken"],
  dataSchema: 3,
  flags: { args: ["--cached-only"], limits: [] },
  entry: "/bundle/main.ts",
  importMap: "/bundle/import-map.json",
  dataPath: "/data",
};

function brokenDesired(over: Partial<DesiredApp> = {}): DesiredApp {
  return {
    app: APP,
    release: "rel_00000000000000000000000001",
    ...BROKEN_DESIRED,
    ...over,
  };
}

Deno.test(
  "apps/runtime#R2: ready timeout과 handler 불일치 앱은 30초 안에 unavailable와 시작 실패 이유가 보인다",
  async () => {
    const hung = brokenHarness({
      probe: () => ({ ok: false, reason: "ready timeout" }),
    });
    await hung.supervisor.reconcile(brokenDesired());
    const failed = hung.records.find((record) =>
      record.method === "record_unavailable"
    );
    assert(failed && failed.method === "record_unavailable");
    assertEquals(failed.reason.code, "start_failed");
    assertEquals(hung.alive(), 0);

    const mismatched = brokenHarness({
      probe: () => ({
        ok: true,
        commands: ["other"],
        dataSchema: 3,
        bundleHash: "ab".repeat(32),
      }),
    });
    await mismatched.supervisor.reconcile(brokenDesired());
    const mismatch = mismatched.records.find((record) =>
      record.method === "record_unavailable"
    );
    assert(mismatch && mismatch.method === "record_unavailable");
    assertEquals(mismatch.reason.summary, "handler or schema mismatch");
  },
);

Deno.test(
  "apps/runtime#R19: 예상 밖 종료가 창 안에서 반복되면 재시작을 멈춰 이유를 남기고 실행 허용값은 몰래 바뀌지 않는다",
  async () => {
    const env = brokenHarness();
    await env.supervisor.reconcile(brokenDesired());
    for (let count = 0; count < 6; count++) {
      const child = env.child(env.spawned - 1);
      child.kill(1);
      await child.exited;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const held = env.records.filter((record) =>
      record.method === "record_unavailable" &&
      record.reason.code === "crash_loop"
    );
    assert(held.length >= 1);
    const spawned = env.spawned;
    env.clock.advance(1_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(env.spawned, spawned);
    for (const record of env.records) {
      assert(!("run_enabled" in record));
    }
  },
);

// 실제 자식을 끝까지 돌려 종료 code와 stderr 끝부분을 받는다. 띄운 자식은 output으로 끝난다.
async function runChild(
  code: string,
  denoArgs: string[] = [],
): Promise<{ exitCode: number | null; stderrTail: string }> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["eval", ...denoArgs, code],
    stdin: "null",
    stdout: "null",
    stderr: "piped",
  }).output();
  return {
    exitCode: output.signal ? null : output.code,
    stderrTail: new TextDecoder().decode(output.stderr).slice(-2000),
  };
}

Deno.test(
  "apps/runtime#R22: 처리되지 않은 exception과 Promise rejection은 stderr에 원래 실패를 남기고 종료 code 1로 끝난다",
  async () => {
    const thrown = await runChild("throw new TypeError('handler blew up');");
    assertEquals(thrown.exitCode, 1);
    assert(thrown.stderrTail.includes("handler blew up"), thrown.stderrTail);
    const rejected = await runChild(
      "Promise.reject(new Error('rejection blew up'));\nawait new Promise((r) => setTimeout(r, 50));",
    );
    assertEquals(rejected.exitCode, 1);
    assert(
      rejected.stderrTail.includes("rejection blew up"),
      rejected.stderrTail,
    );
  },
);

Deno.test(
  "apps/runtime#R28: 실제 V8 OOM 종료와 보통의 예상 밖 종료는 서로 다른 근거로 problems에 간다",
  async () => {
    const sent: ObservedExceptionInput[] = [];
    const crash = createCrashObserver({
      ids: createIdSource({
        clock: manualClock(0),
        random: cryptoRandom,
      }),
      now: () => Date.UTC(2026, 9, 7),
      report: (input) => {
        sent.push(input);
        return Promise.resolve();
      },
    });
    const oom = await runChild(
      "const keep = []; while (true) keep.push(new Array(100_000).fill(1));",
      ["--v8-flags=--max-old-space-size=24"],
    );
    assert(oom.exitCode !== 0);
    const crashed = await runChild("Deno.exit(7)");
    assertEquals(crashed.exitCode, 7);

    const first = await crash.observe({
      kind: "exit",
      intended: false,
      ...oom,
    });
    const second = await crash.observe({
      kind: "exit",
      intended: false,
      ...crashed,
    });
    assertEquals(first?.evidence, "v8_oom");
    assertEquals(second?.evidence, "unexpected_exit");
    assertEquals(sent.length, 2);
    // 보낸 값은 problems contract를 그대로 통과하고 process_exit 관측이다.
    for (const input of sent) {
      assertEquals(input.observation, "process_exit");
      exceptionObservationInputSchema.parse(input);
    }
    assert(sent[0].report_id !== sent[1].report_id);
    // 근거 이름은 모두 관측 근거 목록에 있다.
    for (const name of [first?.evidence, second?.evidence]) {
      assert(name && (CRASH_EVIDENCE as readonly string[]).includes(name));
    }
  },
);

Deno.test(
  "apps/runtime#R28: ready timeout, 기동 실패, crash loop, 신호 종료가 각각 다른 근거 이름으로 남는다",
  async () => {
    const sent: ObservedExceptionInput[] = [];
    const crash = createCrashObserver({
      ids: createIdSource({
        clock: manualClock(0),
        random: cryptoRandom,
      }),
      now: () => Date.UTC(2026, 9, 7),
      report: (input) => {
        sent.push(input);
        return Promise.resolve();
      },
    });
    const events: CrashEvent[] = [
      {
        kind: "start_failed",
        reason: { code: "start_failed", summary: "ready timeout" },
      },
      {
        kind: "start_failed",
        reason: { code: "start_failed", summary: "handler or schema mismatch" },
      },
      { kind: "crash_loop", exits: 6 },
      { kind: "exit", intended: false, exitCode: null, stderrTail: "" },
    ];
    const names: string[] = [];
    for (const event of events) {
      const outcome = await crash.observe(event);
      assert(outcome);
      names.push(outcome.evidence);
    }
    assertEquals(names, [
      "ready_timeout",
      "start_failed",
      "crash_loop",
      "unexpected_exit",
    ]);
    assertEquals(new Set(names).size, 4);
  },
);

// 실제 자식이 맞는지 구별하려는 값이 아니라 종료 관측 자체가 남는지 본다. 의도 표시가
// 있으면 보내지 않는다(R18).
Deno.test(
  "apps/runtime#R28: 의도된 정지는 crash로 세지 않고 보내지 않는다",
  async () => {
    const sent: ObservedExceptionInput[] = [];
    const crash = createCrashObserver({
      ids: createIdSource({
        clock: manualClock(0),
        random: cryptoRandom,
      }),
      now: () => Date.UTC(2026, 9, 7),
      report: (input) => {
        sent.push(input);
        return Promise.resolve();
      },
    });
    const outcome = await crash.observe({
      kind: "exit",
      intended: true,
      exitCode: 0,
      stderrTail: "",
    });
    assertEquals(outcome, undefined);
    assertEquals(sent.length, 0);
  },
);

// fixture와 같은 migration 두 단계(0→1, 1→3)다. 둘째 단계는 항상 abort로 실패한다.
const BROKEN_STEPS = [
  "create table board (\n  id integer primary key,\n  kind text not null check (length(kind) between 1 and 40),\n  note text not null default '',\n  created_at text not null\n)",
  "alter table board add column label text;\ninsert into board (kind, created_at) values ('stop', '2026-10-07T00:00:00.000Z');\nselect raise(abort, 'second migration step always fails');",
];

async function brokenSteps(): Promise<MigrationScript[]> {
  const change = async (
    from: number,
    to: number,
    sql: string,
  ): Promise<MigrationScript> => ({
    change: {
      from,
      to,
      script_hash: `sha256:${await sha256Hex(sql)}`,
      description: `schema ${from} to ${to}`,
    },
    sql,
  });
  return [
    await change(0, 1, BROKEN_STEPS[0]),
    await change(1, 3, BROKEN_STEPS[1]),
  ];
}

Deno.test(
  "apps/data#R7: fixture의 0에서 3으로 가는 변경의 둘째 단계가 실패하면 0의 데이터와 schema로 복원된다",
  async () => {
    const area = await Deno.makeTempDir({ prefix: "lophn-broken-data-" });
    try {
      const path = `${area}/data.db`;
      const db = new DatabaseSync(path);
      db.exec("pragma journal_mode = wal");
      db.prepare(
        "create table notes (body text not null)",
      ).run();
      db.prepare("insert into notes (body) values (?)").run("original");
      db.close();
      const backup = await createAppBackup(area, path, "before");
      assert(backup.ok);
      const steps = await brokenSteps();
      const migrated = await migrateAppDatabase({
        dataArea: area,
        databasePath: path,
        backupPath: `${area}/backups/before`,
        targetSchema: 3,
        scripts: steps,
        appliedAt: "2026-10-07T12:00:00.000Z",
        result: {
          release: "rel_00000000000000000000000001",
          activation_seq: "1",
          invocation: null,
        },
      });
      assert(migrated.ok, migrated.ok ? "" : migrated.error.message);
      assertEquals(migrated.value.restored, true);
      assertEquals(migrated.value.result.data_schema, 0);
      assertEquals(migrated.value.result.integrity_ok, true);
      // 실제 DB는 시작 때로 돌아왔다. 새 표도 중간 변경도 없고 업무 data는 그대로다.
      const kept = new DatabaseSync(path, { readOnly: true });
      const notes = kept.prepare(
        "select body from notes order by rowid",
      ).all().map((row) => String(row["body"]));
      const tables = kept.prepare(
        "select name from sqlite_master where type = 'table' order by name",
      ).all().map((row) => String(row["name"]));
      kept.close();
      assertEquals(notes, ["original"]);
      assert(!tables.includes("board"));
      // 복원한 DB는 무결성과 schema 확인을 통과한다.
      const verified = await verifyDatabase(path);
      assert(verified.ok);
      assertEquals(verified.value.state.dataSchema, 0);
    } finally {
      await Deno.remove(area, { recursive: true });
    }
  },
);

Deno.test(
  "apps/data#R7: fixture의 마지막 단계가 빠진 이전 판은 빈 DB에서 되고 현재 판의 schema에서는 실패한다",
  async () => {
    const area = await Deno.makeTempDir({ prefix: "lophn-broken-data-" });
    try {
      const path = `${area}/previous.db`;
      const opened = openAppDatabase(path);
      assert(opened.ok);
      opened.value.close();
      // 이전 판은 첫 단계만 있어 빈 DB에서 0→1이 된다.
      const steps = await brokenSteps();
      const previous = await migrateAppDatabase({
        dataArea: area,
        databasePath: path,
        backupPath: `${area}/backups/before`,
        targetSchema: 1,
        scripts: steps.slice(0, 1),
        appliedAt: "2026-10-07T12:00:00.000Z",
        result: {
          release: "rel_00000000000000000000000002",
          activation_seq: "1",
          invocation: null,
        },
      });
      assert(previous.ok, previous.ok ? "" : previous.error.message);
      assertEquals(previous.value.restored, false);
      assertEquals(previous.value.result.data_schema, 1);
      // 같은 DB를 현재 판(schema 3)으로 올리면 둘째 단계가 실패해 복원된다.
      const backup = await createAppBackup(area, path, "before-upgrade");
      assert(backup.ok);
      const upgraded = await migrateAppDatabase({
        dataArea: area,
        databasePath: path,
        backupPath: `${area}/backups/before-upgrade`,
        targetSchema: 3,
        scripts: steps,
        appliedAt: "2026-10-07T12:00:01.000Z",
        result: {
          release: "rel_00000000000000000000000002",
          activation_seq: "2",
          invocation: null,
        },
      });
      assert(upgraded.ok, upgraded.ok ? "" : upgraded.error.message);
      assertEquals(upgraded.value.restored, true);
      assertEquals(upgraded.value.result.data_schema, 1);
    } finally {
      await Deno.remove(area, { recursive: true });
    }
  },
);
