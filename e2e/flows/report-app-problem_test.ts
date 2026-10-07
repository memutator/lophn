// problems#T23 flow report-app-problem E2E(docs/flows/report-app-problem.md). 실제 headless shell과
// 실제 core·실제 apps supervisor·실제 앱 자식으로 깨진 앱 fixture(fixtures/apps/broken, board A:
// view root render 오류)를 앱 공간에 띄우고 사람이 [Report a problem]을 눌러 글을 보낸다.
// 앱은 fixture source를 commit한 봉인 bundle이고(prepareFromSource) ledger에는 등록 transaction이 남기는
// 모양으로 앱·release 행을 심는다(앱 만들기·release 활성화 화면은 이 flow의 범위가 아니다). 사람이
// 하는 조작은 화면(renderer·overlay DOM의 click·입력)으로 하고, 사람이 확인하는 결과(접수한 Report·
// snapshot·문제)는 사람 token의 같은 core 읽기 통로(`window.lophnCore`)로 읽는다. 사람 데이터 root
// (~/.lophn)는 열지 않는다. HOME·LOPHN_HOME은 임시 폴더이고 띄운 Electron·core 트리는 정확한 pid로만 끝낸다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";

import { sha256Hex } from "../../packages/base/mod.ts";
import { prepareFromSource } from "../../packages/apps/releases/prepare/from-source.ts";
import {
  bundleCopyPath,
  declarationsOfBlueprint,
  manifestBytes,
  sealBundle,
} from "../../packages/apps/releases/mod.ts";
import type { BundleManifest } from "../../packages/contracts/apps/mod.ts";
import {
  devImportMap,
  readTemplateDirectory,
} from "../../packages/apps/sdk/mod.ts";
import {
  installedHome,
  removeTree,
} from "../../packages/apps/sdk/testing/mod.ts";
import {
  descendantPids,
  e2eEnabled,
  processAlive,
  signalPids,
} from "../harness.ts";
import {
  commandBody,
  delay,
  type FlowShell,
  mustCall,
  openFlowShell,
} from "../flow-support.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const VERIFICATION = "vrf_01h455vb4pex5v6nkc6gd5fdw1";
const DATA_SCHEMA = 3;
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

const encoder = new TextEncoder();
const packagesUrl = new URL("../../packages/", import.meta.url).href;

// 앱 자식 진입 파일. 운영 앱 자식의 실제 기동 entry는 아직 시험 자식뿐이라(docs/plan/apps.md apps#T18
// 이어보냄, apps#T27이 닫는다) 준비된 bundle의 main.ts는 command 등록만 하고 끝난다. 그래서 같은 bundle
// 사본에 실제 runtime entrypoint의 `main()`을 부르는 진입 파일을 더해 다시 봉인한다. command handler·
// 화면 build·blueprint는 fixture의 준비 결과 그대로이고 broker는 닫아 둔다(관측 전달은 앱 응답을 막지 않는다).
const ENTRY =
  `import { main } from "${packagesUrl}apps/runtime/entrypoint/main.ts";
import { bundleScreenFiles } from "${packagesUrl}apps/runtime/entrypoint/screen-files.ts";

async function readLine(): Promise<string> {
  const reader = Deno.stdin.readable.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("\\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

const here = new URL("./", import.meta.url);
const blueprint = JSON.parse(
  await Deno.readTextFile(new URL("blueprint.json", here)),
);
const screens = bundleScreenFiles(decodeURIComponent(here.pathname));
const line = await readLine();
await main({
  readLine: () => Promise.resolve(line),
  importModule: (specifier) => import(specifier),
  blueprint,
  broker: () => Promise.resolve({ status: 503, body: null }),
  dataSchema: ${DATA_SCHEMA},
  reportTransport: () => Promise.resolve(null),
  screenBytes: screens.screenBytes,
  contentType: screens.contentType,
});
`;

async function withRuntimeEntry(
  home: string,
  prepared: { copyPath: string; manifest: BundleManifest },
): Promise<{ bundleHash: string; blueprintHash: string; blueprint: string }> {
  const root = prepared.copyPath;
  const blueprint = await Deno.readTextFile(`${root}/blueprint.json`);
  const importMap = JSON.parse(
    await Deno.readTextFile(`${root}/import-map.json`),
  ) as { imports: Record<string, string> };
  importMap.imports["@lophn/base"] = `${packagesUrl}base/mod.ts`;
  const replaced = new Map<string, Uint8Array>([
    ["import-map.json", encoder.encode(JSON.stringify(importMap))],
    ["entry.ts", encoder.encode(ENTRY)],
  ]);
  const files: { path: string; bytes: Uint8Array }[] = [];
  for (const file of prepared.manifest.files) {
    if (file.path === "blueprint.json" || replaced.has(file.path)) continue;
    files.push({
      path: file.path,
      bytes: await Deno.readFile(`${root}/${file.path}`),
    });
  }
  for (const [path, bytes] of replaced) files.push({ path, bytes });
  const manifest: BundleManifest = {
    entrypoint: "entry.ts",
    files: [
      { path: "blueprint.json", hash: await sha256Hex(blueprint) },
      ...await Promise.all(files.map(async (file) => ({
        path: file.path,
        hash: await sha256Hex(file.bytes),
      }))),
    ],
    sdk_dependencies: prepared.manifest.sdk_dependencies,
  };
  const bundleHash = await sha256Hex(manifestBytes(manifest));
  const copy = bundleCopyPath(home, APP, bundleHash);
  assert(copy.ok, "bundle 사본 자리를 만들지 못했다");
  const sealed = await sealBundle({
    copyPath: copy.value,
    manifest,
    blueprintJson: encoder.encode(blueprint),
    bundleFiles: files,
  });
  assert(sealed.ok, sealed.ok ? "" : sealed.error.message);
  return {
    bundleHash,
    blueprintHash: await sha256Hex(blueprint),
    blueprint,
  };
}

/** fixture source를 commit하고 봉인 bundle로 준비해 `home` 아래에 둔다. 그 blueprint를 돌려준다. */
async function prepareBrokenApp(
  home: string,
): Promise<{ bundleHash: string; blueprintHash: string; blueprint: string }> {
  const installed = await installedHome();
  const parent = await Deno.makeTempDir({ prefix: "lophn-e2e-broken-src-" });
  try {
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
    await git(dir, ["init", "-q"]);
    await git(dir, ["config", "user.email", "dev@lophn.local"]);
    await git(dir, ["config", "user.name", "dev"]);
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "init"]);
    const commit = await git(dir, ["rev-parse", "HEAD"]);
    const prepared = await prepareFromSource({
      dataRoot: home,
      app: APP,
      sourceRoot: dir,
      commit,
      sdkRoot: installed.sdkRoot,
    });
    assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
    return await withRuntimeEntry(home, prepared.value);
  } finally {
    await removeTree(parent);
    await installed.dispose();
  }
}

/** 등록 transaction이 남기는 모양으로 앱·release 행을 심는다(core를 멈춘 동안). */
function seedLedger(
  home: string,
  bundle: { bundleHash: string; blueprintHash: string; blueprint: string },
): void {
  const blueprint = JSON.parse(bundle.blueprint);
  const declarations = declarationsOfBlueprint(RELEASE, blueprint);
  assert(declarations !== undefined, "선언 사실을 만들지 못했다");
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, planning_version, source_path, active_release, run_enabled, revision, status)
       VALUES (?, 'broken', 'Broken', 'A deliberately broken app', NULL, NULL, ?, 1, '1', 'active')`,
    ).run(APP, RELEASE);
    db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash, data_schema, data_changes, ticket_source, created_by, created_at, status, activation, failure, blueprint, declarations)
       VALUES (?, ?, 1, ?, ?, ?, 3, '[]', NULL, 'machine', ?, 'active', NULL, NULL, ?, ?)`,
    ).run(
      RELEASE,
      APP,
      "a".repeat(40),
      bundle.bundleHash,
      bundle.blueprintHash,
      "2026-10-01T00:00:00.000Z",
      bundle.blueprint,
      JSON.stringify(declarations),
    );
    db.prepare(
      "INSERT INTO release_tests (release, verification) VALUES (?, ?)",
    ).run(RELEASE, VERIFICATION);
  } finally {
    db.close();
  }
}

/** 띄운 shell의 Electron main에서 표현식을 평가한다(native view·창 상태를 읽는다). */
function main(flow: FlowShell, expression: string): Promise<unknown> {
  return flow.shell.mainEvaluate(expression);
}

type Page = Awaited<ReturnType<FlowShell["shell"]["connect"]>>;

async function untilPage(
  page: Page,
  expression: string,
  what: string,
  timeoutMs = 30_000,
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      last = await page.evaluate(expression);
    } catch (error) {
      last = String(error);
    }
    if (last) return last;
    await delay(200);
  }
  throw new Error(`${what}: ${JSON.stringify(last)}`);
}

async function pageClick(page: Page, selector: string): Promise<void> {
  const clicked = await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assertEquals(clicked, true, `누를 요소가 없다: ${selector}`);
}

/** 제어 입력(React)이 알도록 native setter와 input event로 글을 쓴다. */
async function pageType(
  page: Page,
  selector: string,
  text: string,
): Promise<void> {
  const typed = await page.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
      .set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  assertEquals(typed, true, `입력칸이 없다: ${selector}`);
}

function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assertEquals(view.getUint32(0), 0x89504e47, "PNG 머리가 아니다");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function fromDataUrl(url: string): Uint8Array {
  const prefix = "data:image/png;base64,";
  assert(url.startsWith(prefix), "PNG data URL이 아니다");
  return Uint8Array.from(
    atob(url.slice(prefix.length)),
    (c) => c.charCodeAt(0),
  );
}

const APP_VIEW =
  `electron.webContents.getAllWebContents().find((c) => c.getURL().startsWith("lophn-app:"))`;

type Rect = { x: number; y: number; width: number; height: number };

/** 창 안 앱 view의 위치와 창 본문 크기. */
async function viewBounds(
  flow: FlowShell,
): Promise<{ view: Rect | null; window: { width: number; height: number } }> {
  return JSON.parse(
    String(
      await main(
        flow,
        `JSON.stringify((() => {
          const w = electron.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("desktop"));
          const v = w.contentView.children.find((c) => c.webContents?.getURL().startsWith("lophn-app:"));
          return { view: v ? v.getBounds() : null, window: { width: w.getContentBounds().width, height: w.getContentBounds().height } };
        })())`,
      ),
    ),
  );
}

type Counts = { problems: Map<string, number>; reports: number };

/** 이 앱의 문제와 보고 수(사람 token의 problems 읽기). */
async function counts(flow: FlowShell): Promise<Counts> {
  const listed = await mustCall(flow, {
    kind: "read",
    resource: "problems",
    method: "list",
    body: { app: APP },
  });
  const problems = new Map<string, number>();
  let reports = 0;
  for (const row of listed.problems as { id: string }[]) {
    const got = await mustCall(flow, {
      kind: "read",
      resource: "problems",
      method: "get",
      body: { problem: row.id },
    });
    const count = Number(got.report_count);
    problems.set(row.id, count);
    reports += count;
  }
  return { problems, reports };
}

function newProblem(before: Counts, after: Counts): string {
  const added = [...after.problems.keys()].filter((id) =>
    !before.problems.has(id)
  );
  assertEquals(added.length, 1, `새 문제가 하나여야 한다: ${added}`);
  return added[0]!;
}

type ReadReport = {
  report: {
    id: string;
    source: string;
    code: string;
    text: string | null;
    content_hash: string;
    problem: string | null;
  };
  snapshot: {
    id: string;
    screen: {
      name: string;
      state: string | null;
      state_missing_reason: unknown;
      screenshot: string | null;
      screenshot_missing_reason: unknown;
    } | null;
    screen_missing_reason: unknown;
    invocation: unknown;
    invocation_missing_reason: unknown;
  } | null;
};

/** 문제에 묶인 feedback 보고 하나를 읽는다. */
async function feedbackReport(
  flow: FlowShell,
  problem: string,
): Promise<ReadReport> {
  const listed = await mustCall(flow, {
    kind: "read",
    resource: "problems",
    method: "list-reports",
    body: { problem },
  });
  const rows = (listed.reports as { id: string; source: string }[]).filter(
    (row) => row.source === "feedback",
  );
  assertEquals(rows.length, 1, `feedback 보고가 하나여야 한다 ${problem}`);
  return await mustCall(flow, {
    kind: "read",
    resource: "problems",
    method: "get-report",
    body: { report: rows[0]!.id },
  }) as unknown as ReadReport;
}

/** home 아래 모든 파일에서 글이 있는지(초안·미제출 글이 디스크에 남지 않았는지). */
async function foundOnDisk(root: string, needle: string): Promise<string[]> {
  const found: string[] = [];
  const bytes = new TextEncoder().encode(needle);
  async function walk(dir: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) await walk(path);
      else if (entry.isFile) {
        const data = await Deno.readFile(path).catch(() => undefined);
        if (data === undefined) continue;
        outer: for (let at = 0; at + bytes.length <= data.length; at++) {
          for (let k = 0; k < bytes.length; k++) {
            if (data[at + k] !== bytes[k]) continue outer;
          }
          found.push(path);
          break;
        }
      }
    }
  }
  await walk(root);
  return found;
}

/** 이 실행의 core 프로세스 pid. */
async function corePid(flow: FlowShell): Promise<number> {
  for (const pid of await descendantPids(flow.shell.pid)) {
    try {
      const cmd = await Deno.readTextFile(`/proc/${pid}/cmdline`);
      if (cmd.includes("apps/core/main.ts")) return pid;
    } catch { /* 이미 끝났다 */ }
  }
  throw new Error("core 프로세스를 찾지 못했다");
}

const DRAFT_HINT = "Your text is kept only while this window is open.";

Deno.test({
  name:
    "problems/feedback#R5 R6 R11 R12 R13 flow report-app-problem: 깨진 앱 화면에서 문제를 알린다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-report-app-" });
    await Deno.chmod(home, 0o700);
    // core 한 번을 띄워 DB를 만든 뒤 멈추고 앱을 심고 앱 공간부터 다시 연다.
    const first = await openFlowShell({ home });
    await first.close();
    const bundle = await prepareBrokenApp(home);
    seedLedger(home, bundle);
    const flow = await openFlowShell({ home, start: `app:${APP}` });
    let overlay: Page | undefined;
    try {
      const untilClosed = () =>
        untilPage(
          overlay!,
          `document.querySelector("[data-feedback-phase]") === null`,
          "dialog가 닫히지 않았다",
        );
      const shotCheckbox = `[data-feedback="screenshot"] [role="checkbox"]`;
      const screenCheckbox = `[data-feedback="screen"] [role="checkbox"]`;
      // 사람이 shell의 [Report a problem]을 누르고 dialog가 설 때까지.
      const pressReport = async (): Promise<void> => {
        await flow.click("[data-report-problem]");
        overlay ??= await flow.shell.connect(
          "lophn-shell://overlay/index.html",
        );
        await untilPage(
          overlay,
          `document.querySelector('[data-feedback="text"]') !== null`,
          "dialog가 열리지 않았다",
        );
      };
      // 이미지 미리보기나 이유가 보일 때까지(캡처는 1.5초까지).
      const untilShotSettled = async (): Promise<void> => {
        await untilPage(
          overlay!,
          `document.querySelector('[data-feedback="screenshot-preview"]') !== null || document.querySelector('[data-feedback="screenshot-reason"]:not([data-reason="pending"])') !== null`,
          "screenshot 상태가 정해지지 않았다",
        );
      };
      const checked = (selector: string) =>
        overlay!.evaluate(
          `document.querySelector(${
            JSON.stringify(selector)
          }).getAttribute("aria-checked")`,
        );
      const sendReport = async (text: string) => {
        await pageType(overlay!, '[data-feedback="text"]', text);
        await untilPage(
          overlay!,
          `!document.querySelector('[data-feedback="send"]').disabled`,
          "[Send report]가 켜지지 않았다",
        );
        await pageClick(overlay!, '[data-feedback="send"]');
      };

      await t.step(
        "flow 1: 앱 공간에 깨진 앱 화면이 열리고 [Report a problem]은 그 view에 묶인다",
        async () => {
          await flow.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "app"`,
            "앱 공간이 서지 않았다",
          );
          // 앱이 뜨기 전에 열려 한 번 실패한 화면은 사람이 [Reload]로 다시 연다.
          const deadline = Date.now() + 60_000;
          for (;;) {
            const runtime = await mustCall(flow, {
              kind: "read",
              resource: "apps",
              method: "runtime",
              body: { app: APP },
            });
            if ((runtime.state as { state: string }).state === "running") break;
            assert(Date.now() < deadline, "앱이 뜨지 않았다");
            await delay(500);
          }
          await flow.until(
            `document.querySelector('[data-phase="failed"] button') !== null || document.querySelector('[data-report-problem]:not([disabled])') !== null`,
            "화면 상태가 오지 않았다",
          );
          if ((await flow.count('[data-phase="failed"] button')) > 0) {
            await flow.click('[data-phase="failed"] button');
          }
          await flow.until(
            `document.querySelector('[data-report-problem]:not([disabled])') !== null`,
            "[Report a problem]이 켜지지 않았다",
          );
          // 앱 view는 fixture의 깨진 화면(board A: root render 오류)이다.
          await delay(1_000);
          const text = await main(
            flow,
            `${APP_VIEW}.executeJavaScript("document.body.innerText")`,
          );
          assert(
            String(text).includes("Couldn't show this screen."),
            `앱 화면이 깨진 화면이 아니다: ${text}`,
          );
        },
      );
      let baseline: Counts = { problems: new Map(), reports: 0 };
      // 캡처한 PNG(미리보기)를 바이트로 읽는다.
      const previewPng = async () => {
        const src = await overlay!.evaluate(
          `document.querySelector('[data-feedback="screenshot-preview"]')?.src ?? null`,
        );
        assert(typeof src === "string", "screenshot 미리보기가 보이지 않는다");
        return fromDataUrl(src);
      };
      const shotOf = (png: Uint8Array) => sha256Hex(png);
      // 앱 view 안에서 평가한다(앱 화면을 사람이 바꾸는 것과 같은 일이다).
      const inApp = (script: string) =>
        main(flow, `${APP_VIEW}.executeJavaScript(${JSON.stringify(script)})`);
      const closeDialog = async (button: "cancel" | "close") => {
        await pageClick(overlay!, `[data-feedback="${button}"]`);
        await untilClosed();
      };

      await t.step(
        "flow 2·R5: 버튼 시점 앱 view만 캡처해 미리보기에 보이고 앱 view는 그대로 붙어 있다",
        async () => {
          baseline = await counts(flow);
          const before = await viewBounds(flow);
          assert(before.view !== null, "앱 view가 창에 붙어 있어야 한다");
          await pressReport();
          await untilShotSettled();
          // dialog가 열려 있는 동안에도 앱 view는 떼지 않는다.
          assertEquals((await viewBounds(flow)).view, before.view);
          const first = await previewPng();
          const size = pngSize(first);
          assertEquals(size.width, before.view.width);
          assert(size.height <= before.window.height);
          const firstHash = await shotOf(first);
          // R6: 안전한 화면 상태만 기본 선택이고 screenshot은 사람이 고르기 전에는 꺼져 있다.
          assertEquals(await checked(screenCheckbox), "true");
          assertEquals(await checked(shotCheckbox), "false");
          // R13: 기존 문제 선택 여부가 보인다(이 제출은 어느 문제에도 더하지 않는다).
          assertEquals(
            await overlay!.evaluate(
              `document.querySelector('[data-feedback="existing-issue"]').textContent`,
            ),
            "This report isn't added to an existing issue.",
          );
          // R11: 초안은 이 창에만 있다고 알리고 복구를 약속하지 않는다.
          assertEquals(
            await overlay!.evaluate(
              `document.querySelector('[data-feedback="text"]').closest(".field_field").querySelector(".field_message").textContent`,
            ),
            DRAFT_HINT,
          );
          await closeDialog("cancel");

          // 앱 view만 캡처한다: shell 크롬(데스크톱 창 본문)을 바꿔도 캡처는 그대로이고
          // 앱 화면을 바꾸면 캡처가 따라 바뀐다.
          await flow.evaluate(`(() => {
            const cover = document.createElement("div");
            cover.id = "flow-chrome-change";
            cover.style.cssText = "position:fixed;top:0;left:0;width:100%;height:48px;background:#ff00ff;z-index:99999";
            document.body.appendChild(cover);
            return true;
          })()`);
          await delay(800);
          await pressReport();
          await untilShotSettled();
          assertEquals(await shotOf(await previewPng()), firstHash);
          await closeDialog("cancel");
          await flow.evaluate(
            `document.getElementById("flow-chrome-change").remove()`,
          );
          await inApp(
            `document.body.style.background = "#00aa55"; document.documentElement.style.background = "#00aa55"; true`,
          );
          await delay(800);
          await pressReport();
          await untilShotSettled();
          const changed = await previewPng();
          assert(
            await shotOf(changed) !== firstHash,
            "앱 화면을 바꿨는데 캡처가 같다",
          );
          // 버튼 뒤 앱 화면이 또 바뀌어도 미리보기의 당시 자료는 그대로다.
          const heldHash = await shotOf(changed);
          await inApp(
            `document.body.style.background = "#aa0055"; document.documentElement.style.background = "#aa0055"; true`,
          );
          await delay(800);
          assertEquals(await shotOf(await previewPng()), heldHash);
          // 이 dialog는 아래 R12 확인으로 이어 쓴다.
        },
      );

      await t.step(
        "R12·R11: 제출 전 취소에는 Report도 문제도 없고 글은 디스크에도 없으며 다시 열면 빈 초안이다",
        async () => {
          const draft = "draft-only-sentinel-3f9a1c7e";
          await pageType(overlay!, '[data-feedback="text"]', draft);
          await closeDialog("cancel");
          const after = await counts(flow);
          assertEquals(after.reports, baseline.reports);
          assertEquals([...after.problems], [...baseline.problems]);
          assertEquals(await foundOnDisk(home, draft), []);
          assert((await viewBounds(flow)).view !== null);
          await pressReport();
          assertEquals(
            await overlay!.evaluate(
              `document.querySelector('[data-feedback="text"]').value`,
            ),
            "",
          );
          await closeDialog("cancel");
        },
      );

      let first_problem = "";
      let first_text = "";
      await t.step(
        "flow 3~5·R6·R12: 안전한 화면 상태만 보내면 접수 완료가 보이고 닫아도 같은 Report가 읽힌다",
        async () => {
          const before = await counts(flow);
          await pressReport();
          await untilShotSettled();
          first_text = "The total on the Orders screen looks wrong";
          // screenshot은 미리보기가 보여도 고르지 않으면 보내지 않는다.
          assertEquals(await checked(shotCheckbox), "false");
          await sendReport(first_text);
          await untilPage(
            overlay!,
            `document.querySelector('[data-feedback-phase="received"]') !== null`,
            "접수 완료가 보이지 않는다",
          );
          assertEquals(
            await overlay!.evaluate(
              `document.querySelector('[data-feedback="received"] [role="status"]').textContent`,
            ),
            "Received. lophn will look into it.",
          );
          const after = await counts(flow);
          first_problem = newProblem(before, after);
          assertEquals(after.reports, before.reports + 1);
          assertEquals(after.problems.get(first_problem), 1);
          const read = await feedbackReport(flow, first_problem);
          assertEquals(read.report.source, "feedback");
          assertEquals(read.report.code, "_feedback");
          assertEquals(read.report.text, await sha256Hex(first_text));
          assert(read.snapshot?.screen?.state, "화면 상태가 고정되지 않았다");
          assertEquals(read.snapshot.screen.name, "panel");
          // 고르지 않은 screenshot은 저장하지 않고 이유가 남는다.
          assertEquals(read.snapshot.screen.screenshot, null);
          assert(read.snapshot.screen.screenshot_missing_reason !== null);
          // 닫아도 같은 Report가 읽힌다(접수한 것은 지우지 않는다).
          await closeDialog("close");
          const again = await feedbackReport(flow, first_problem);
          assertEquals(again.report.id, read.report.id);
          assertEquals(again.report.content_hash, read.report.content_hash);
        },
      );

      // 사람이 [View issue]를 누르면 main이 desktop 창에 보내는 intent를 받아 적는다.
      await flow.evaluate(`(() => {
        window.__intents = [];
        window.lophnIntents.subscribe((intent) => window.__intents.push(intent));
        return true;
      })()`);
      const intents = async () =>
        JSON.parse(
          String(await flow.evaluate(`JSON.stringify(window.__intents)`)),
        ) as { kind: string; app: string; problem: string }[];
      const snapshotBlobs = async (snapshot: string) =>
        (await mustCall(flow, {
          kind: "read",
          resource: "problems",
          method: "get-snapshot",
          body: { snapshot, item: "screen" },
        })).blobs as { purpose: string; hash: string }[];

      let second_problem = "";
      await t.step(
        "R6·R13: screenshot은 미리보기를 보고 골라야 저장되고 저장된 이미지는 미리본 그대로이며 접수 뒤 그 문제로 갈 수 있다",
        async () => {
          const before = await counts(flow);
          await pressReport();
          await untilShotSettled();
          const png = await previewPng();
          const hash = await shotOf(png);
          assertEquals(await checked(shotCheckbox), "false");
          // 미리보기가 있어야 고를 수 있다.
          assertEquals(
            await overlay!.evaluate(
              `document.querySelector(${
                JSON.stringify(shotCheckbox)
              }).disabled`,
            ),
            false,
          );
          await pageClick(overlay!, shotCheckbox);
          assertEquals(await checked(shotCheckbox), "true");
          await sendReport(
            "The Orders screen shows an error instead of a table",
          );
          await untilPage(
            overlay!,
            `document.querySelector('[data-feedback-phase="received"]') !== null`,
            "접수 완료가 보이지 않는다",
          );
          const after = await counts(flow);
          second_problem = newProblem(before, after);
          assert(second_problem !== first_problem, "문제가 겹쳤다");
          const read = await feedbackReport(flow, second_problem);
          // 사람이 본 그대로(가리지 않고) 저장됐다: 저장한 hash가 미리본 PNG의 hash다.
          assertEquals(read.snapshot?.screen?.screenshot, hash);
          assertEquals(read.snapshot?.screen?.screenshot_missing_reason, null);
          assert(
            (await snapshotBlobs(read.snapshot!.id)).some((blob) =>
              blob.hash === hash
            ),
            "저장한 screenshot blob이 없다",
          );
          const firstRead = await feedbackReport(flow, first_problem);
          assert(
            (await snapshotBlobs(firstRead.snapshot!.id)).every((blob) =>
              blob.hash !== hash
            ),
            "고르지 않은 제출에 screenshot이 저장됐다",
          );
          // 접수 뒤 [View issue]로 이 Report가 묶인 문제로 간다.
          await pageClick(overlay!, '[data-feedback="view-issue"]');
          await untilClosed();
          await flow.until(
            `window.__intents.length > 0`,
            "[View issue]가 desktop 창에 닿지 않았다",
          );
          assertEquals(await intents(), [{
            kind: "app-issue",
            app: APP,
            problem: second_problem,
          }]);
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-space]").getAttribute("data-space")`,
            ),
            "app",
          );
        },
      );

      await t.step(
        "flow 5: 새 운영 문제가 열리면 정해진 notification만 생기고 읽어도 문제는 닫히지 않는다",
        async () => {
          const now = await counts(flow);
          const deadline = Date.now() + 30_000;
          type Listed = {
            notification: { id: string; read_at: string | null };
            source_event: string;
          };
          let listed: Listed[] = [];
          for (;;) {
            listed = (await mustCall(flow, {
              kind: "read",
              resource: "notifications",
              method: "list",
              body: {},
            })).notifications as Listed[];
            if (listed.length >= now.problems.size) break;
            assert(Date.now() < deadline, "notification이 생기지 않았다");
            await delay(500);
          }
          // 문제가 열릴 때마다 ProblemOpened notification 하나뿐이다.
          assertEquals(listed.length, now.problems.size);
          assert(listed.every((item) => item.source_event === "ProblemOpened"));
          // 읽음 표시는 문제를 닫지 않는다.
          const read = await mustCall(flow, {
            kind: "command",
            resource: "notifications",
            method: "read",
            body: commandBody({ notification: listed[0]!.notification.id }),
          });
          assertEquals(read.changed, true);
          const listedProblems = await mustCall(flow, {
            kind: "read",
            resource: "problems",
            method: "list",
            body: { app: APP },
          });
          for (
            const row of listedProblems.problems as {
              status: string;
              next_action: string | null;
            }[]
          ) {
            assertEquals(row.status, "open");
          }
        },
      );

      // 앱 공간에서 view가 가려졌거나 보호 창이 떠 있으면 캡처하지 않고 이유만 보이며 글은 보낼 수 있다.
      const reasonOf = () =>
        overlay!.evaluate(
          `document.querySelector('[data-feedback="screenshot-reason"]')?.getAttribute("data-reason") ?? null`,
        );
      const noImage = async () => {
        assertEquals(
          await overlay!.evaluate(
            `document.querySelector('[data-feedback="screenshot-preview"]')`,
          ),
          null,
        );
        assertEquals(
          await overlay!.evaluate(
            `document.querySelector(${JSON.stringify(shotCheckbox)}).disabled`,
          ),
          true,
        );
      };
      const sendTextOnly = async (text: string, before: Counts) => {
        await sendReport(text);
        await untilPage(
          overlay!,
          `document.querySelector('[data-feedback-phase="received"]') !== null`,
          "접수 완료가 보이지 않는다",
        );
        const problem = newProblem(before, await counts(flow));
        const read = await feedbackReport(flow, problem);
        assertEquals(read.report.text, await sha256Hex(text));
        // 이미지가 없으면 저장된 screenshot도 없고 이유가 남는다.
        assertEquals(read.snapshot?.screen?.screenshot, null);
        assert(read.snapshot?.screen?.screenshot_missing_reason !== null);
        return { problem, read };
      };

      await t.step(
        "R5·R10: 앱 view가 가려진 동안에는 캡처하지 않고 이유를 보이며 글만 보낼 수 있다",
        async () => {
          // 좁은 창에서 운영 패널(720px)이 본문을 모두 덮으면 앱 view는 숨는다.
          await main(
            flow,
            `(() => { const w = electron.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("desktop")); w.setMinimumSize(300, 300); w.setSize(640, 600); return true; })()`,
          );
          await flow.until(
            `window.innerWidth <= 700`,
            "창이 좁아지지 않았다",
          );
          await flow.click('[data-app-bar="app-details"]');
          await flow.until(
            `document.querySelector("[data-ops-panel]") !== null`,
            "운영 패널이 열리지 않았다",
          );
          const deadline = Date.now() + 15_000;
          for (;;) {
            const { view } = await viewBounds(flow);
            if (view === null || view.width <= 0) break;
            assert(
              Date.now() < deadline,
              `앱 view가 숨지 않았다 ${view.width}`,
            );
            await delay(200);
          }
          const before = await counts(flow);
          await pressReport();
          await untilShotSettled();
          assertEquals(await reasonOf(), "hidden");
          assertEquals(
            await overlay!.evaluate(
              `document.querySelector('[data-feedback="screenshot-reason"]').textContent`,
            ),
            "No screenshot because this app wasn't showing.",
          );
          await noImage();
          await sendTextOnly(
            "The Orders screen is covered but still wrong",
            before,
          );
          await closeDialog("close");
          // 원래 크기로 돌아오면 앱 view도 다시 보인다.
          await flow.click("[data-ops-panel-close]");
          await main(
            flow,
            `(() => { const w = electron.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("desktop")); w.setSize(960, 600); w.setMinimumSize(960, 600); return true; })()`,
          );
          const back = Date.now() + 15_000;
          for (;;) {
            const { view } = await viewBounds(flow);
            if (view !== null && view.width > 0) break;
            assert(Date.now() < back, "앱 view가 돌아오지 않았다");
            await delay(200);
          }
        },
      );

      await t.step(
        "R5: lophn dialog나 보호 창이 떠 있으면 캡처하지 않고 이유를 보이며 다른 창·없는 view는 열리지 않는다",
        async () => {
          // lophn dialog가 떠 있는 동안.
          const opened = JSON.parse(
            String(
              await flow.evaluate(
                `window.lophnShell.open({ requestId: "flow-dialog", kind: "dialog", anchorRect: { x: 100, y: 80, width: 600, height: 300 }, model: { label: "Flow dialog", choices: [{ id: "ok", label: "OK" }] } }).then((reply) => JSON.stringify(reply))`,
              ),
            ),
          ) as {
            ok: boolean;
            value?: { surfaceId: string; generation: number };
          };
          assert(opened.ok && opened.value, JSON.stringify(opened));
          let before = await counts(flow);
          await pressReport();
          await untilShotSettled();
          assertEquals(await reasonOf(), "protected_window");
          await noImage();
          await sendTextOnly(
            "Sent while another lophn dialog was open",
            before,
          );
          await closeDialog("close");
          await flow.evaluate(
            `window.lophnShell.close(${
              JSON.stringify(opened.value)
            }).then(() => true)`,
          );

          // child modal 보호 창(confirmation window)이 떠 있는 동안.
          const confirmation = JSON.parse(
            String(
              await flow.evaluate(
                `window.lophnShell.openConfirmation({ request: { kind: "secret_input", owner: "flow-provider", purpose: "provider_credential", credential: { key: "key-flow", kind: "api_key", label: "Flow key", account: null, organization: null, plan: null } }, parentWindow: "requesting-window" }).then((reply) => JSON.stringify(reply))`,
              ),
            ),
          ) as { windowId?: string; code?: string };
          assert(
            confirmation.windowId !== undefined,
            `보호 창이 열리지 않았다: ${JSON.stringify(confirmation)}`,
          );
          assertEquals(
            await main(
              flow,
              `electron.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("desktop")).getChildWindows().length`,
            ),
            1,
          );
          before = await counts(flow);
          await pressReport();
          await untilShotSettled();
          assertEquals(await reasonOf(), "protected_window");
          assertEquals(
            await overlay!.evaluate(
              `document.querySelector('[data-feedback="screenshot-reason"]').textContent`,
            ),
            "No screenshot because another lophn window was open over this app.",
          );
          await noImage();
          // 보호 창을 위해 앱 view를 숨기지 않는다.
          assert((await viewBounds(flow)).view !== null);
          await sendTextOnly(
            "Sent while a confirmation window was open",
            before,
          );
          await closeDialog("close");
          await main(
            flow,
            `electron.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("desktop")).getChildWindows().forEach((child) => child.close())`,
          );

          // 다른 창의 view나 없는 view에는 dialog도 캡처도 없다.
          assertEquals(
            await flow.evaluate(
              `window.lophnShell.beginFeedback("view_does_not_exist").then(() => "opened", (error) => error.message)`,
            ),
            "invalid_input",
          );
          assertEquals(
            await overlay!.evaluate(
              `document.querySelector("[data-feedback-phase]") === null`,
            ),
            true,
          );
        },
      );

      await t.step(
        "다른 갈래: 입력 검사로 command가 시작되지 못한 이상도 글로 알리고 없는 invocation은 만들지 않는다",
        async () => {
          const invocations = async () =>
            ((await mustCall(flow, {
              kind: "read",
              resource: "invocations",
              method: "list",
              body: { app: APP },
            })).invocations as unknown[]).length;
          const startedBefore = await invocations();
          // 필수 입력이 없는 호출은 앱에 닿기 전에 막힌다.
          const blocked = await inApp(
            `lophnApp.call("run_broken", {}).then(() => "started", (error) => "blocked:" + String(error && error.message))`,
          );
          assert(String(blocked).startsWith("blocked"), String(blocked));
          assertEquals(await invocations(), startedBefore);
          const before = await counts(flow);
          await pressReport();
          await untilShotSettled();
          await sendReport("The Run button did nothing when I pressed it");
          await untilPage(
            overlay!,
            `document.querySelector('[data-feedback-phase="received"]') !== null`,
            "접수 완료가 보이지 않는다",
          );
          const problem = newProblem(before, await counts(flow));
          const read = await feedbackReport(flow, problem);
          // 실행하지 않은 일을 실행 기록으로 남기지 않는다.
          assertEquals(read.snapshot?.invocation ?? null, null);
          assert(read.snapshot !== null);
          assertEquals(await invocations(), startedBefore);
          await closeDialog("close");
        },
      );

      await t.step(
        "R14: 직접 해 봤지만 안 된다는 글은 새 Report이고 어떤 문제도 닫거나 무시하지 않는다",
        async () => {
          const before = await counts(flow);
          await pressReport();
          await untilShotSettled();
          await sendReport("I tried it myself and it still fails");
          await untilPage(
            overlay!,
            `document.querySelector('[data-feedback-phase="received"]') !== null`,
            "접수 완료가 보이지 않는다",
          );
          const after = await counts(flow);
          const problem = newProblem(before, after);
          assertEquals(after.reports, before.reports + 1);
          const read = await feedbackReport(flow, problem);
          assertEquals(read.report.source, "feedback");
          assertEquals(
            read.report.text,
            await sha256Hex("I tried it myself and it still fails"),
          );
          // 이전 문제들은 그대로 열려 있고 닫힘·무시 기록이 없다.
          for (const id of before.problems.keys()) {
            const got = await mustCall(flow, {
              kind: "read",
              resource: "problems",
              method: "get",
              body: { problem: id },
            });
            const row = got.problem as {
              status: string;
              closure: unknown;
            };
            assertEquals(row.status, "open");
            assertEquals(row.closure, null);
            assertEquals(after.problems.get(id), before.problems.get(id));
          }
          await closeDialog("close");
        },
      );

      await t.step(
        "flow 6: 다른 화면으로 갔다가 같은 앱 공간으로 돌아와 다시 쓸 수 있다",
        async () => {
          await flow.click("[data-launcher-back]");
          await flow.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") !== "app"`,
            "런처로 가지 못했다",
          );
          assertEquals((await viewBounds(flow)).view, null);
          await flow.evaluate(
            `(() => { location.hash = ${
              JSON.stringify(`#app=${APP}`)
            }; location.reload(); return true; })()`,
          );
          await delay(500);
          await flow.until(
            `document.querySelector('[data-space="app"]') !== null`,
            "앱 공간으로 돌아오지 못했다",
          );
          await flow.until(
            `document.querySelector('[data-report-problem]:not([disabled])') !== null`,
            "[Report a problem]이 켜지지 않았다",
          );
          // 새로 읽은 desktop 창에서 intent 구독을 다시 건다.
          await flow.evaluate(`(() => {
            window.__intents = [];
            window.lophnIntents.subscribe((intent) => window.__intents.push(intent));
            return true;
          })()`);
        },
      );

      await t.step(
        "R11: 접수가 막히면 완료 표시 없이 글을 복사할 수 있고 초안 복구를 약속하지 않는다",
        async () => {
          await pressReport();
          await untilShotSettled();
          const lost = "Core went away while I was writing this report";
          await pageType(overlay!, '[data-feedback="text"]', lost);
          // 사람이 쓰는 도중 core가 사라진다(이 실행의 core 프로세스 하나만 끝낸다).
          const pid = await corePid(flow);
          signalPids([pid], "SIGKILL");
          const gone = Date.now() + 15_000;
          while (processAlive(pid)) {
            assert(Date.now() < gone, "core가 끝나지 않았다");
            await delay(100);
          }
          await untilPage(
            overlay!,
            `!document.querySelector('[data-feedback="send"]').disabled`,
            "[Send report]가 꺼져 있다",
          );
          await pageClick(overlay!, '[data-feedback="send"]');
          await untilPage(
            overlay!,
            `document.querySelector('[data-feedback="failed"]') !== null`,
            "접수 실패가 보이지 않는다",
          );
          // 접수 완료로 보이지 않는다.
          assertEquals(
            await overlay!.evaluate(
              `document.querySelector('[data-feedback="received"]') === null && document.querySelector('[data-feedback-phase]').getAttribute("data-feedback-phase")`,
            ),
            "failed",
          );
          assertEquals(
            await overlay!.evaluate(
              `document.querySelector('[data-feedback="failed"] p').textContent`,
            ),
            "Your report wasn't sent because lophn couldn't be reached.",
          );
          // 글은 그대로 남아 있고 복사할 수 있다. 복사 길은 clipboard에 쓰는 글을 받아 적는다.
          assertEquals(
            await overlay!.evaluate(
              `document.querySelector('[data-feedback="text"]').value`,
            ),
            lost,
          );
          await overlay!.evaluate(`(() => {
            window.__copied = null;
            Object.defineProperty(navigator.clipboard, "writeText", {
              configurable: true,
              value: (text) => { window.__copied = text; return Promise.resolve(); },
            });
            return true;
          })()`);
          await overlay!.evaluate(
            `document.querySelector('[data-feedback="failed"] button[aria-label="Copy your text"]').click()`,
          );
          await untilPage(
            overlay!,
            `window.__copied !== null`,
            "글이 복사되지 않았다",
          );
          assertEquals(await overlay!.evaluate(`window.__copied`), lost);
          // 초안은 이 창 메모리에만 있다고 알리고 shell을 닫은 뒤 복구를 약속하지 않는다.
          assertEquals(
            await overlay!.evaluate(
              `document.querySelector('[data-feedback="text"]').closest(".field_field").querySelector(".field_message").textContent`,
            ),
            DRAFT_HINT,
          );
          await closeDialog("cancel");
          assertEquals(await foundOnDisk(home, lost), []);
        },
      );
    } finally {
      await flow.close();
      await removeTree(home);
    }
  },
});
