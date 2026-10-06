// rate limit 대시보드 앱 fixture를 끝까지 돌린다(apps#T25). 앱 폴더를 temp로 풀어 자기 test·type 검사를 지나고, 화면이
// build되고, release 준비(T6)로 bundle이 되고, problems app test의 선언 검사를 지나는지 본다. 같은 앱의 패널 둘과 카드 하나는
// 실제 앱 자식 프로세스 하나에서 열리고, 만든 화면은 실제 Chromium(화면 없이)에서 전체·패널 320px·카드 240px 폭에 넣어 가로
// scroll을 잰다. 앱 자기 test는 앱 폴더의 tests/에 있고 요구 번호별 확인은 거기 있다.
import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../packages/base/mod.ts";
import { prepareFromSource } from "../../packages/apps/releases/prepare/from-source.ts";
import { verifySealedPermissions } from "../../packages/apps/releases/mod.ts";
import { createCoreSigner } from "../../packages/apps/runtime/signing.ts";
import {
  appProcessesReading,
  startFixtureApp,
} from "../../packages/apps/runtime/testing/app-process.ts";
import {
  generateAppTestChecks,
  loadSources,
  scanCodeUsage,
  sdkDependenciesHash,
} from "../../packages/problems/tests/mod.ts";
import {
  devImportMap,
  readTemplateDirectory,
} from "../../packages/apps/sdk/mod.ts";
import {
  APP_TEST_ARGS,
  deno,
  installedHome,
  removeTree,
} from "../../packages/apps/sdk/testing/mod.ts";

const APP = "app_01aryz6s41s4z4k7p41s4z4k7p";
const IMPORT_MAP = "--import-map=.lophn/import-map.json";
const FIXTURE =
  new URL("../../fixtures/apps/rate-limit-dashboard/", import.meta.url)
    .pathname;
const REPO = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

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
  dispose(): Promise<void>;
};

// 저장소의 fixture 원본(`.tmpl`)을 앱 폴더로 풀고 개발용 import map을 둔다.
async function madeApp(): Promise<Made> {
  const installed = await installedHome([
    "@lophn/cap-fs",
    "@lophn/ui-chart",
    "@lophn/ui-filter",
    "@lophn/ui-stat",
    "@lophn/ui-table",
  ]);
  const parent = await Deno.makeTempDir({ prefix: "lophn-rate-limit-" });
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
  return {
    parent,
    dir,
    home: installed.home,
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

async function buildScreen(dir: string): Promise<void> {
  const built = await deno(dir, [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-run",
    "scripts/build-ui.ts",
  ]);
  assertEquals(built.code, 0, built.stderr);
}

Deno.test("apps/blueprint#R19 apps/invocations#R14 problems/tests#R18: 앱이 잠긴 lock으로 type 검사와 자기 test를 통과하고 수집·집계·기간·시간대·coverage test가 모두 돈다", async () => {
  const made = await madeApp();
  try {
    const check = await deno(made.dir, [
      "check",
      IMPORT_MAP,
      "--frozen-lockfile",
      "--cached-only",
      "main.ts",
      "blueprint.ts",
      "src/screens/usage/main.tsx",
      "scripts/build-ui.ts",
      "tests/blueprint_test.ts",
      "tests/declaration_test.ts",
      "tests/failure_path_test.ts",
      "tests/usage_test.ts",
      "tests/wording_test.ts",
    ]);
    assertEquals(check.code, 0, check.stderr);
    const tests = await deno(made.dir, APP_TEST_ARGS);
    assertEquals(tests.code, 0, tests.stderr + tests.stdout);
    for (
      const name of [
        "apps/blueprint#R19: usage 화면은 전체·패널·카드를",
        "apps/invocations#R14: 수집했지만 0건인 기간과 수집하지 않은 기간은",
        "apps/invocations#R14: 일부만 수집한 기간은 partial이고",
        "apps/invocations#R14: 이어 읽기는",
        "problems/tests#R18: 집계는 요청한 기간·시간대의",
        "failure_path:store_unavailable usage_report",
        "failure_path:file_unavailable collect_usage",
      ]
    ) assert(tests.stdout.includes(name), `${name} did not run`);
  } finally {
    await made.dispose();
  }
});

Deno.test("apps/blueprint#R19: 화면 build → release 준비(T6) bundle → problems app test 선언 검사가 통과하고 화면은 전체·패널·카드를 선언한다", async () => {
  const made = await madeApp();
  try {
    const blueprint = await evaluate(made.dir);
    assertEquals(blueprint.value.screens[0].sizes, ["full", "panel", "card"]);

    // source commit에서 봉인 bundle까지. 앱의 build script는 실행되지 않고 src/screens/<key>/main.tsx가 build된다.
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
        "migrations/0-1.sql",
        "src/usage.ts",
        "screens/usage/main.js",
        "screens/usage/index.html",
        "screens/usage/main.css",
        "sdk/ui-chart/1.0.0/mod.ts",
      ]
    ) assert(paths.includes(path), `${path} is not in the bundle`);
    const bundled = JSON.parse(
      await Deno.readTextFile(`${prepared.value.copyPath}/blueprint.json`),
    ) as EvaluatedBlueprint;
    assertEquals(bundled.screens.map((item) => [item.key, item.sizes]), [
      ["usage", ["full", "panel", "card"]],
    ]);
    const sdk = bundled.sdk_dependencies;

    // problems app test의 선언 검사. 고정 SDK·선언 code의 실패 경로·source의 code 사용이 모두 맞다.
    const failureTest = await sha256Hex("failure_path:store_unavailable");
    const plan = generateAppTestChecks({
      bundle_hash: prepared.value.bundleHash,
      test_hash: failureTest,
      blueprint: blueprint.value as never,
      data: { schema: 1, previous_schema: null },
      blueprint_hash: prepared.value.blueprintHash,
      frozen: {
        blueprint: prepared.value.blueprintHash,
        sdk_dependencies: sdkDependenciesHash(sdk),
        failure_paths: blueprint.value.problem_codes.map((item) => ({
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
    assertEquals(status["migration_empty"], "required");
    assertEquals(status["migration_upgrade"], "not_applicable");
    // read command가 있어 read 계약 검사가 필수이고, 되돌림·secret이 없어 그 검사는 해당 없음이다.
    assertEquals(status["read_contract"], "required");
    assertEquals(status["revert_restore"], "not_applicable");
    assertEquals(status["secret_grant"], "not_applicable");
    assert(plan.harness.has_view);
    const usage = scanCodeUsage(await loadSources(made.dir));
    assertEquals(
      [...new Set(usage.literals.map((use) => use.code))].sort(),
      blueprint.value.problem_codes.map((item) => item.code).sort(),
    );
    assertEquals(usage.dynamic, []);
  } finally {
    await made.dispose();
  }
});

Deno.test("apps/runtime#R31: 같은 앱의 패널 둘과 카드 하나는 앱 프로세스 하나에서 각자 view session으로 열린다", async () => {
  const made = await madeApp();
  const signer = await createCoreSigner();
  let child: Awaited<ReturnType<typeof startFixtureApp>> | undefined;
  try {
    const blueprint = await evaluate(made.dir);
    // 앱의 실제 blueprint로 실제 앱 자식 프로세스(runtime 진입점)를 띄운다. 화면 byte만 시험 대역이다.
    child = await startFixtureApp({
      verifyKey: signer.verifyKey,
      blueprint: JSON.parse(blueprint.text),
    });
    const connection = {
      app: child.app,
      release: child.release!,
      bundle_hash: child.bundleHash,
      mode: "live" as const,
      process_nonce: child.nonce,
      actor: "user" as const,
      credential_ref: "user-1",
      screens: ["usage"],
      screen_sizes: { usage: ["full", "panel", "card"] as const },
      caller: null,
      commands: [],
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const authorization = JSON.stringify(
      await signer.signConnection(connection as never),
    );
    const client = Deno.createHttpClient({
      proxy: { transport: "unix", path: child.endpoint },
    });
    try {
      const open = async (size: string, view: string) => {
        const response = await fetch(
          `http://lophn.invalid/screens/usage/index.html?size=${size}&view_session=${view}`,
          { client, headers: { authorization } },
        );
        return { status: response.status, body: await response.text() };
      };
      // 패널 둘과 카드 하나가 모두 열린다. 각각 자기 view session이다.
      for (
        const [size, view] of [
          ["panel", "panel-a"],
          ["panel", "panel-b"],
          ["card", "card-a"],
        ]
      ) {
        const shown = await open(size, view);
        assertEquals(shown.status, 200, `${view}: ${shown.body}`);
        assertEquals(shown.body, "screen usage index.html");
      }
      // view session은 처음 연 화면과 크기에 묶여 다른 크기로 다시 열면 거절된다. 세 session이 섞이지 않는다.
      assertEquals((await open("card", "panel-a")).status, 409);
      assertEquals((await open("panel", "card-a")).status, 409);
      assertEquals((await open("panel", "panel-a")).status, 200);
    } finally {
      client.close();
    }
    // 앱 프로세스는 하나다. 이 앱 폴더를 읽는 deno 프로세스는 띄운 자식 하나뿐이다.
    assertEquals(await appProcessesReading(child.dir), [child.pid]);
  } finally {
    await child?.stop();
    await made.dispose();
  }
});

// 화면 build 결과를 화면 없이(show:false·offscreen) 정해진 폭의 창에 띄워 가로 scroll과 조작 자리를 재는 Electron main이다.
// window.lophnApp은 preload의 대역이고 usage_report만 답한다.
const PROBE_PRELOAD = `
const DAY = 24 * 60 * 60 * 1000;
const scenario = new URLSearchParams(location.search).get("scenario");
function days(from, to) {
  const found = [];
  for (let time = Date.parse(from); time <= Date.parse(to); time += DAY) {
    found.push(new Date(time).toISOString().slice(0, 10));
  }
  return found;
}
function report(input) {
  const all = days(input.from, input.to);
  const wanted = input.providers.length > 0 ? input.providers : ["alpha", "beta"];
  const base = {
    continuation: null,
    period: { from: input.from, to: input.to, timezone: input.timezone },
    providers: ["alpha", "beta"],
  };
  if (scenario === "uncollected") {
    return { ...base, rows: [], coverage: "uncollected", freshness: "unknown", collected_through: null };
  }
  const partial = scenario === "partial";
  const shown = partial ? all.slice(0, Math.ceil(all.length / 2)) : all;
  const rows = shown.flatMap((day, index) =>
    wanted.map((provider, which) => {
      const peak = Math.min(100, 20 + ((index * 17 + which * 31) % 80));
      return { day, provider, samples: 6, peak_used: peak, quota: 100, peak_percent: peak, limited_samples: 0 };
    })
  );
  return {
    ...base,
    rows,
    coverage: partial ? "partial" : "complete",
    freshness: partial ? "stale" : "fresh",
    collected_through: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  };
}
window.lophnApp = {
  call(command, input) {
    if (command !== "usage_report") return Promise.reject(new Error("unexpected command"));
    return Promise.resolve(report(input));
  },
};
`;

const PROBE_MAIN = `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const config = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], "utf8"));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function measure() {
  const width = window.innerWidth;
  const button = document.querySelector('[data-filter="date-range"]');
  const box = button ? button.getBoundingClientRect() : null;
  return {
    innerWidth: width,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    text: document.body.innerText,
    filter: box && { left: box.left, right: box.right },
  };
}
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const results = [];
  for (const shot of config.shots) {
    const window = new BrowserWindow({
      show: false,
      width: shot.width,
      height: shot.height,
      useContentSize: true,
      webPreferences: { offscreen: true, preload: config.preload, contextIsolation: false, sandbox: false },
    });
    let image;
    window.webContents.on("paint", (_event, _dirty, picture) => { image = picture; });
    const errors = [];
    window.webContents.on("console-message", (event) => {
      const details = event.message === undefined ? {} : event;
      if (details.level === "error") errors.push(String(details.message));
    });
    await window.loadFile(config.index, { query: { scenario: shot.scenario, shot: shot.name } });
    await wait(1500);
    const result = await window.webContents.executeJavaScript("(" + measure.toString() + ")()");
    if (shot.open) {
      await window.webContents.executeJavaScript("document.querySelector('[data-filter=\\"date-range\\"]').click()");
      await wait(700);
      result.opened = await window.webContents.executeJavaScript("(" + measure.toString() + ")()");
    }
    await wait(300);
    fs.writeFileSync(config.out + "/" + shot.name + ".png", image.toPNG());
    results.push({ name: shot.name, errors, ...result });
    window.destroy();
    await wait(300);
  }
  fs.writeFileSync(config.out + "/result.json", JSON.stringify(results));
  app.quit();
});
`;

const ELECTRON = Deno.env.get("LOPHN_ELECTRON") ??
  `${REPO}/apps/shell/main/node_modules/electron/dist/electron`;
const hasElectron = await Deno.stat(ELECTRON).then(() => true, () => false);

type Measured = {
  name: string;
  errors: string[];
  innerWidth: number;
  scrollWidth: number;
  bodyScrollWidth: number;
  text: string;
  filter: { left: number; right: number } | null;
  opened?: { innerWidth: number; scrollWidth: number; text: string };
};

Deno.test({
  name:
    "apps/blueprint#R19: 같은 화면이 전체 1024px·패널 320px·카드 240px에서 가로 scroll 없이 읽히고 기간 filter를 조작할 수 있으며 미수집·일부 수집·신선도 부족을 따로 보인다",
  ignore: !hasElectron,
  async fn() {
    const made = await madeApp();
    const work = await Deno.makeTempDir({ prefix: "lophn-rate-limit-probe-" });
    // 화면 사진을 보고 싶으면 LOPHN_SHOT_DIR에 폴더를 준다. 없으면 temp에 두고 지운다.
    const out = Deno.env.get("LOPHN_SHOT_DIR") ?? `${work}/shots`;
    try {
      await buildScreen(made.dir);
      await Deno.mkdir(out, { recursive: true });
      await Deno.writeTextFile(`${work}/preload.cjs`, PROBE_PRELOAD);
      await Deno.writeTextFile(`${work}/main.cjs`, PROBE_MAIN);
      await Deno.writeTextFile(
        `${work}/config.json`,
        JSON.stringify({
          index: `${made.dir}/dist/screens/usage/index.html`,
          preload: `${work}/preload.cjs`,
          out,
          shots: [
            { name: "full", width: 1024, height: 700, scenario: "complete" },
            { name: "panel", width: 320, height: 700, scenario: "complete" },
            {
              name: "panel-filter",
              width: 320,
              height: 700,
              scenario: "complete",
              open: true,
            },
            { name: "card", width: 240, height: 700, scenario: "complete" },
            {
              name: "card-filter",
              width: 240,
              height: 700,
              scenario: "complete",
              open: true,
            },
            {
              name: "card-uncollected",
              width: 240,
              height: 520,
              scenario: "uncollected",
            },
            {
              name: "panel-partial",
              width: 320,
              height: 700,
              scenario: "partial",
            },
          ],
        }),
      );
      // 사람 화면에 창을 띄우지 않는다(show:false·offscreen). 띄운 프로세스만 끝낸다.
      const probe = new Deno.Command(ELECTRON, {
        args: ["--no-sandbox", `${work}/main.cjs`, `${work}/config.json`],
        cwd: work,
        stdout: "null",
        stderr: "null",
      }).spawn();
      const timer = setTimeout(() => {
        try {
          probe.kill("SIGKILL");
        } catch { /* 이미 끝났다 */ }
      }, 90_000);
      const status = await probe.status;
      clearTimeout(timer);
      assertEquals(status.code, 0);
      const results = JSON.parse(
        await Deno.readTextFile(`${out}/result.json`),
      ) as Measured[];
      assertEquals(results.length, 7);
      for (const shot of results) {
        // 페이지가 가로로 scroll되지 않는다.
        assert(shot.scrollWidth <= shot.innerWidth, `${shot.name} scrolls`);
        assert(shot.bodyScrollWidth <= shot.innerWidth, `${shot.name} body`);
        // 조작(기간 filter)이 화면 안에 있다.
        assert(
          shot.filter !== null && shot.filter.left >= 0 &&
            shot.filter.right <= shot.innerWidth,
          `${shot.name} filter is out of view`,
        );
        assertEquals(shot.errors, [], shot.name);
        if (shot.opened) {
          assert(shot.opened.scrollWidth <= shot.opened.innerWidth);
          // 열린 filter에서도 정한 기간 선택이 남는다.
          assert(shot.opened.text.includes("Last 30 days"), shot.name);
        }
      }
      const by = Object.fromEntries(results.map((shot) => [shot.name, shot]));
      assertEquals(
        [by["full"].innerWidth, by["panel"].innerWidth, by["card"].innerWidth],
        [1024, 320, 240],
      );
      // 읽기: 모든 폭에서 수치와 차트 범례가 보인다.
      for (const name of ["full", "panel", "card"]) {
        assert(by[name].text.includes("Peak usage"), name);
        assert(by[name].text.includes("alpha"), name);
      }
      // 미수집·일부 수집·신선도 부족은 정상 0건과 다른 문장이다.
      assert(
        by["card-uncollected"].text.includes(
          "Nothing has been collected for this period yet.",
        ),
      );
      assert(
        by["panel-partial"].text.includes(
          "Only part of this period was collected.",
        ),
      );
      assert(by["panel-partial"].text.includes("Last updated"));
    } finally {
      await removeTree(work);
      await made.dispose();
    }
  },
});
