// flow work-offline 1단계(docs/flows/work-offline.md). 실제 shell(headless)·core를 임시
// LOPHN_HOME으로 띄운다. 설치 안내는 임시 LOPHN_INSTALL_ROOT의 guides/다. 실제 ~/.lophn은
// 열지 않는다.
// 화면으로 하는 것: launcher 프로젝트 카드, sidebar 문서, 편집·저장 키, scroll, documents
// 화면의 고정 판 링크, lophn apps에서 로컬 앱 열기, 다시 연 launcher 카드.
// core 통로(window.lophnCore, 사람 token)로 하는 것: 설치 안내 list·get·outline·read(안내
// 화면이 없다), 프로젝트 등록·추적(등록 dialog는 first-project가 본다), documents/get,
// documents/read, outline/document, search/query. 저장·판 확정·검색은 서로 다른 결과로 본다.
// 이 단계가 하지 않는 것: 2–7단계, update-lophn, install-lophn, 두 칸이 보이는 분할, terminal·
// app panel 탭, 두 번째 앱 command. 로컬 앱은 하나이고 그 시작이 문서·안내 읽기를 막지 않는지만 본다.
import { assert, assertEquals } from "@std/assert";

import { sha256Hex } from "../../packages/base/mod.ts";
import { canonicalJson } from "../../packages/apps/blueprint/mod.ts";
import { appFlags } from "../../packages/apps/permissions/mod.ts";
import {
  bundleCopyPath,
  bundleFlags,
  manifestBytes,
  readBundleCopy,
  sealBundle,
} from "../../packages/apps/releases/mod.ts";
import {
  blueprint,
  command as declared,
} from "../../packages/apps/releases/testing/mod.ts";
import { spawnApp } from "../../apps/app-supervisor/spawn.ts";
import type { AppLaunch } from "../../packages/apps/runtime/processes/mod.ts";
import {
  coreLaunch,
  spawnCore,
  type SpawnedCore,
} from "../../apps/shell/main/desktop/core/supervise.ts";
import { mcpLaunchArgv } from "../../packages/coding-agent/mcp-server/launch.ts";
import { guideInstallFixture } from "../../packages/documents/versions/testing/mod.ts";
import {
  installedHome,
  removeTree,
} from "../../packages/apps/sdk/testing/mod.ts";
import { e2eEnabled, READY_TIMEOUT_MS } from "../harness.ts";
import { prepareBrokenApp, seedLedger } from "../broken-app.ts";
import {
  delay,
  documentTitled,
  type FlowShell,
  listDocuments,
  mustCall,
  openFlowShell,
  PROJECT,
  registerTrackedProject,
  searchOnce,
  typeAtEnd,
  untilDocuments,
  untilSearch,
  versionHistory,
} from "../flow-support.ts";

const MARKER = "zz-offline-marker";
const GUIDE_PATH = "roles/lophn/guides/projects.md";

function laterText(): string {
  const lines = ["# Later", "", "Keep this sentence."];
  for (let index = 0; index < 80; index += 1) {
    lines.push("", `Paragraph ${index} stays in the first version.`);
  }
  lines.push("");
  return lines.join("\n");
}

async function pressSave(flow: FlowShell): Promise<void> {
  await flow.evaluate(
    `(() => { document.querySelector("[data-document-view]").dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true })); return true; })()`,
  );
}

async function saveStatus(flow: FlowShell): Promise<string> {
  return String(
    await flow.evaluate(
      `document.querySelector("[data-save-status]")?.getAttribute("data-save-status") ?? ""`,
    ),
  );
}

async function stageValue(flow: FlowShell, stage: string): Promise<string> {
  return String(
    await flow.evaluate(
      `document.querySelector(${
        JSON.stringify(`[data-save-stage="${stage}"]`)
      })?.getAttribute("data-save-value") ?? ""`,
    ),
  );
}

/** 보이는 줄 끝에 넣은 글이 파일에 남을 때까지. 긴 문서는 끝줄이 화면에 없다. */
async function untilMarked(path: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    last = await Deno.readTextFile(path);
    if (last.includes(MARKER) && last.includes("Keep this sentence.")) return;
    await delay(200);
  }
  throw new Error(`파일에 고친 글이 없다: ${last.slice(0, 180)}`);
}

/** 저장 상세가 닫혀 있으면 연다. 이미 열려 있으면 토글로 닫지 않는다. */
async function ensureDetails(flow: FlowShell): Promise<void> {
  const open = await flow.evaluate(
    `document.querySelector('[data-save-stage="version"]') !== null`,
  );
  if (open === true) return;
  await flow.click("[data-save-details-toggle]");
  await flow.until(
    `document.querySelector('[data-save-stage="version"]') !== null`,
    "저장 상세가 열리지 않았다",
  );
}

/** layout.json에 이 문서 탭의 scroll이 남을 때까지. */
async function untilOffset(home: string, document: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    try {
      last = await Deno.readTextFile(`${home}/shell/layout.json`);
      const parsed = JSON.parse(last) as {
        layout: {
          panes: {
            tabs: {
              document?: string;
              read_position?: { scroll_offset?: number };
            }[];
            selected_tab: string | null;
          }[];
        };
      };
      const kept = parsed.layout.panes.some((pane) =>
        pane.selected_tab === document &&
        pane.tabs.some((tab) =>
          tab.document === document &&
          (tab.read_position?.scroll_offset ?? 0) > 0
        )
      );
      if (kept) return;
    } catch {
      last = "missing";
    }
    await delay(200);
  }
  throw new Error(`layout에 읽던 위치가 없다: ${last}`);
}

type GuideRow = {
  lophn_version: string;
  title: string;
  content_hash: string;
  files: { path: string; media_type?: string }[];
};

Deno.test({
  name:
    "documents/versions#R8 documents/versions#R17 documents/outline-and-search#R15 shell/workspace#R6 shell/editor#R2 apps/runtime#R21 flow work-offline 1: 설치된 문서와 고정 이력과 로컬 앱을 이어 연다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const install = await Deno.makeTempDir({
      prefix: "lophn-e2e-offline-install-",
    });
    const guides = guideInstallFixture("1.4.2", undefined, `${install}/guides`);
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-offline-folder-" }),
    );
    const original = laterText();
    const laterFile = `${folder}/later.md`;
    await Deno.writeTextFile(`${folder}/notes.md`, "# Notes\n\nShort note.\n");
    await Deno.writeTextFile(laterFile, original);
    const env = { LOPHN_INSTALL_ROOT: install };
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-offline-" });
    await Deno.chmod(home, 0o700);
    let opened: FlowShell | undefined;
    try {
      const flow = await openFlowShell({ home, env });
      opened = flow;
      let notesId = "";
      let laterId = "";
      let firstHash = "";
      let firstVersion = "";

      await t.step(
        "documents/versions#R17: launcher에서 설치 안내를 읽고 사용자 문서 목록에는 안 넣는다",
        async () => {
          await flow.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "launcher"`,
            "launcher가 서지 않았다",
          );
          const list = await mustCall(flow, {
            kind: "worker",
            resource: "guides",
            method: "list",
            body: {},
          });
          const rows = list.guides as GuideRow[];
          assertEquals(list.lophn_version, "1.4.2");
          assertEquals(rows.map((row) => row.title), ["Projects", "Revert"]);
          assertEquals(
            rows.map((row) => row.content_hash),
            guides.guides.map((row) => row.content_hash),
          );
          const projects = rows[0];
          assert(projects !== undefined);
          assertEquals(projects.files[0]?.path, GUIDE_PATH);
          const reference = {
            lophn_version: projects.lophn_version,
            title: projects.title,
            content_hash: projects.content_hash,
          };
          const got = await mustCall(flow, {
            kind: "worker",
            resource: "guides",
            method: "get",
            body: { reference },
          });
          assertEquals(
            (got.guide as { content_hash: string }).content_hash,
            projects.content_hash,
          );
          const outline = await mustCall(flow, {
            kind: "worker",
            resource: "guides",
            method: "outline",
            body: { reference, path: GUIDE_PATH },
          });
          assertEquals(outline.section_status, "whole");
          const entries = outline.entries as { key: string; title: string }[];
          const section = entries.find((entry) =>
            entry.title === "Create a project"
          );
          assert(section !== undefined, "Create a project 절이 없다");
          const part = await mustCall(flow, {
            kind: "worker",
            resource: "guides",
            method: "read",
            body: { reference, path: GUIDE_PATH, section: section.key },
          });
          assert(
            String(part.text).includes("choose New project."),
            "절 본문이 없다",
          );
          const whole = await mustCall(flow, {
            kind: "worker",
            resource: "guides",
            method: "read",
            body: { reference, path: GUIDE_PATH },
          });
          assertEquals(whole.section_status, "whole");
          assert(
            String(whole.text).includes("Names must be unique."),
            "안내 본문이 없다",
          );
          await registerTrackedProject(flow, {
            folder,
            name: "alpha",
            title: "Alpha",
          });
          await untilDocuments(
            flow,
            ["notes", "later"],
            "추적한 파일이 문서가 되지 않았다",
          );
          const titles = (await listDocuments(flow)).map((row) => row.title);
          assertEquals(titles.includes("Projects"), false);
          assertEquals(titles.includes("Revert"), false);
          notesId = (await documentTitled(flow, "notes")).id;
          laterId = (await documentTitled(flow, "later")).id;
        },
      );

      await t.step(
        "shell/workspace#R6 shell/editor#R2: 프로젝트 탭에서 문서를 고치고 저장과 판 확정을 구별한다",
        async () => {
          await flow.click("[data-entry=lophn]");
          await flow.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "lophn"`,
            "lophn 공간이 서지 않았다",
          );
          await flow.click("[data-launcher-back]");
          await flow.until(
            `document.querySelector('[data-card="project"][data-project="${PROJECT}"] button:not([data-details-toggle])') !== null`,
            "프로젝트 카드가 없다",
          );
          await flow.click(
            `[data-card="project"][data-project="${PROJECT}"] button:not([data-details-toggle])`,
          );
          await flow.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "project"`,
            "project 작업대가 서지 않았다",
          );
          await flow.until(
            `document.querySelector('[data-document="${notesId}"]') !== null`,
            "sidebar에 문서가 없다",
          );
          await flow.click(`[data-document="${notesId}"]`);
          await flow.until(
            `document.querySelector('[data-tab="${notesId}"]') !== null`,
            "notes 탭이 열리지 않았다",
          );
          await flow.click(`[data-document="${laterId}"]`);
          await flow.until(
            `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") === "read" && document.querySelector("[data-document-body]")?.textContent?.includes("Keep this sentence.")`,
            "later 본문이 열리지 않았다",
          );
          await flow.until(
            `document.querySelector("[data-edit-toggle]")?.disabled === false`,
            "편집 전환이 켜지지 않았다",
          );
          await flow.click("[data-edit-toggle]");
          await flow.until(
            `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") === "edit"`,
            "편집 화면이 열리지 않았다",
          );
          await typeAtEnd(flow, MARKER);
          await untilMarked(laterFile);
          await flow.until(
            `document.querySelector("[data-save-status]")?.getAttribute("data-save-status") === "saved"`,
            "파일 저장됨 상태가 오지 않았다",
          );
          const before = await versionHistory(flow, laterId);
          assertEquals(before.map((row) => row.number), [1]);
          firstHash = before[0]!.content_hash;
          firstVersion = before[0]!.id;
          const missed = await searchOnce(flow, MARKER);
          assertEquals(
            missed.results.some((row) => row.document === laterId),
            false,
          );
          await ensureDetails(flow);
          assertEquals(await stageValue(flow, "file"), "saved");
          assert(await stageValue(flow, "version") !== "confirmed");
          assertEquals(await flow.count("[data-save-stage=search]"), 0);
          assertEquals(await saveStatus(flow), "saved");
        },
      );

      await t.step(
        "documents/outline-and-search#R15: 판 확정 뒤의 고정 판 읽기는 검색 반영과 다른 결과다",
        async () => {
          await pressSave(flow);
          await flow.until(
            `document.querySelector("[data-save-status]")?.getAttribute("data-save-status") === "version-saved"`,
            "판 확정 상태가 오지 않았다",
          );
          const rows = await versionHistory(flow, laterId);
          assertEquals(rows.map((row) => row.number), [2, 1]);
          const confirmed = rows[0]!.id;
          assert(confirmed !== firstVersion);
          const read = await flow.call({
            kind: "worker",
            resource: "documents",
            method: "read",
            body: {
              reference: {
                document: laterId,
                version: confirmed,
                section: null,
              },
            },
          });
          assert(read.ok, `documents/read: ${JSON.stringify(read)}`);
          const outline = await flow.call({
            kind: "worker",
            resource: "outline",
            method: "document",
            body: {
              reference: {
                document: laterId,
                version: confirmed,
                section: null,
              },
            },
          });
          assert(outline.ok, `outline/document: ${JSON.stringify(outline)}`);
          let searched = await searchOnce(flow, MARKER);
          if (
            !searched.coverage.lagging &&
            !searched.results.some((row) => row.document === laterId)
          ) {
            searched = await untilSearch(
              flow,
              MARKER,
              (page) => page.results.some((row) => row.document === laterId),
              "검색이 판과 따로 따라오지 않았다",
            );
          }
          assert(
            searched.coverage.lagging ||
              searched.results.some((row) => row.document === laterId),
          );
          assertEquals((await versionHistory(flow, laterId))[0]?.id, confirmed);
          assertEquals(await saveStatus(flow), "version-saved");
          await ensureDetails(flow);
          assertEquals(await stageValue(flow, "version"), "confirmed");
        },
      );

      await t.step(
        "documents/versions#R8 shell/workspace#R6: 고정한 옛 판과 읽던 위치를 남긴다",
        async () => {
          await flow.click("[data-edit-toggle]");
          await flow.until(
            `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") === "read"`,
            "읽기 화면으로 돌아오지 않았다",
          );
          await flow.until(
            `(() => { const el = document.querySelector("[data-document-view]"); return !!el && el.scrollHeight > el.clientHeight + 40; })()`,
            "본문이 스크롤되지 않는다",
          );
          const placed = await flow.evaluate(`(() => {
            const el = document.querySelector("[data-document-view]");
            el.scrollTop = Math.min(480, el.scrollHeight - el.clientHeight);
            el.dispatchEvent(new Event("scroll"));
            return el.scrollTop;
          })()`);
          assert(Number(placed) > 0, `scrollTop이 0이다: ${placed}`);
          await untilOffset(home, laterId);
          await delay(600);
          await untilOffset(home, laterId);
          await flow.click("[data-entry=lophn]");
          await flow.until(
            `document.querySelector("[data-open-link]") !== null`,
            "문서 링크가 없다",
          );
          await flow.click("[data-open-link]");
          await flow.until(
            `document.querySelector("[data-link-input]") !== null`,
            "링크 입력칸이 열리지 않았다",
          );
          await flow.type("[data-link-input]", "alpha/later@1");
          await flow.click("[data-link-submit]");
          await flow.until(
            `document.querySelector("[data-version-state]")?.getAttribute("data-version-state") === "older"`,
            "지정한 판이 열리지 않았다",
          );
          await flow.until(
            `document.querySelector("[data-body]")?.textContent?.includes("Keep this sentence.")`,
            "옛 판 본문이 없다",
          );
          const body = String(await flow.text("[data-body]"));
          assertEquals(body.includes(MARKER), false);
          const pinned = await mustCall(flow, {
            kind: "read",
            resource: "documents",
            method: "get",
            body: { document: laterId, version: firstVersion },
          });
          const version = pinned.version as {
            content_hash: string;
            files: { media_type: string; primary: boolean }[];
          };
          assertEquals(version.content_hash, firstHash);
          assertEquals(
            version.files.find((file) => file.primary)?.media_type,
            "text/markdown",
          );
          const latest = await mustCall(flow, {
            kind: "read",
            resource: "documents",
            method: "get",
            body: { document: laterId },
          });
          assert(
            (latest.version as { content_hash: string }).content_hash !==
              firstHash,
          );
          const oldRead = await flow.call({
            kind: "worker",
            resource: "documents",
            method: "read",
            body: {
              reference: {
                document: laterId,
                version: firstVersion,
                section: null,
              },
            },
          });
          assert(oldRead.ok, `옛 판 읽기: ${JSON.stringify(oldRead)}`);
          const oldText = (oldRead.value as { text: string | null }).text;
          if (oldText !== null) {
            assert(oldText.includes("Keep this sentence."));
            assertEquals(oldText.includes(MARKER), false);
          }
        },
      );

      await opened.close();
      opened = undefined;
      const bundle = await prepareBrokenApp(home, {
        installedHome,
        removeTree,
      });
      seedLedger(home, bundle);
      const again = await openFlowShell({ home, env });
      opened = again;

      await t.step(
        "shell/workspace#R6 apps/runtime#R21: 탭과 위치를 이어 열고 로컬 앱이 문서·안내 읽기를 막지 않는다",
        async () => {
          await again.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "launcher"`,
            "다시 연 launcher가 서지 않았다",
          );
          assertEquals(await again.count("[data-continue]"), 0);
          await again.click(
            `[data-card="project"][data-project="${PROJECT}"] button:not([data-details-toggle])`,
          );
          await again.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "project"`,
            "이어서 연 작업대가 서지 않았다",
          );
          await again.until(
            `document.querySelector('[data-tab="${laterId}"]')?.getAttribute("aria-selected") === "true"`,
            "선택 탭이 돌아오지 않았다",
          );
          const tabs = JSON.parse(
            String(
              await again.evaluate(
                `JSON.stringify([...document.querySelectorAll("[role=tab]")].map((el) => el.getAttribute("data-tab")))`,
              ),
            ),
          ) as string[];
          assertEquals(tabs, [notesId, laterId]);
          await again.until(
            `(() => { const el = document.querySelector("[data-document-view]"); return !!el && el.scrollTop > 0; })()`,
            "읽던 위치가 돌아오지 않았다",
          );
          await again.click("[data-entry=lophn]");
          await again.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "lophn"`,
            "lophn 공간이 서지 않았다",
          );
          await again.click("[data-screen=apps]");
          await again.until(
            `document.querySelector("[data-app-row] [data-action=open]") !== null`,
            "로컬 앱 행이 없다",
          );
          await again.click("[data-app-row] [data-action=open]");
          await again.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "app"`,
            "앱 공간이 서지 않았다",
          );
          const still = await mustCall(again, {
            kind: "read",
            resource: "documents",
            method: "get",
            body: { document: laterId, version: firstVersion },
          });
          assertEquals(
            (still.version as { content_hash: string }).content_hash,
            firstHash,
          );
          const guide = guides.guides[0];
          assert(guide !== undefined);
          const read = await mustCall(again, {
            kind: "worker",
            resource: "guides",
            method: "read",
            body: {
              reference: {
                lophn_version: "1.4.2",
                title: guide.title,
                content_hash: guide.content_hash,
              },
              path: GUIDE_PATH,
            },
          });
          assert(String(read.text).includes("Names must be unique."));
        },
      );
    } finally {
      await opened?.close();
      await removeTree(home);
      await Deno.remove(install, { recursive: true });
      await Deno.remove(folder, { recursive: true });
    }
  },
});

// flow work-offline 2단계. 사람에게는 보이지 않는다. 플랫폼 시작·앱 시작·패키지 MCP 연결이
// 동봉 runtime, 고정 의존성, 앱의 pinned SDK만으로 되고 다운로드를 요구하지 않는지 본다.
// 화면은 열지 않는다. LOPHN_HOME과 HOME은 temp다. 의존성 캐시는 이미 받아 둔 사본만 읽고,
// 그 사본에 파일이 늘면 다운로드로 본다.
const OFFLINE_REPO = new URL("../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
const OFFLINE_APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const CACHE_STORES = ["npm", "remote", "dl"] as const;
const BLOCKED_PROXY = "http://127.0.0.1:9";

function sourceDenoDir(): string {
  const configured = Deno.env.get("DENO_DIR");
  if (configured !== undefined && configured !== "") return configured;
  const home = Deno.env.get("HOME");
  if (home === undefined || home === "") {
    throw new Error("DENO_DIR도 HOME도 없어 고정 의존성 캐시를 못 찾는다");
  }
  return `${home}/.cache/deno`;
}

async function walkFiles(
  directory: string,
  prefix: string,
  found: string[],
): Promise<void> {
  for await (const entry of Deno.readDir(directory)) {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory && !entry.isSymlink) {
      await walkFiles(`${directory}/${entry.name}`, relative, found);
    } else found.push(relative);
  }
}

async function cacheListing(denoDir: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of CACHE_STORES) {
    const root = `${denoDir}/${name}`;
    try {
      await Deno.stat(root);
    } catch {
      continue;
    }
    await walkFiles(root, name, found);
  }
  found.sort();
  return found;
}

function addedPaths(
  before: readonly string[],
  after: readonly string[],
): string[] {
  const seen = new Set(before);
  return after.filter((path) => !seen.has(path));
}

async function pipeText(
  pipe: { read(buffer: Uint8Array): Promise<number | null> },
): Promise<string> {
  const parts: Uint8Array[] = [];
  const buffer = new Uint8Array(8192);
  for (;;) {
    const count = await pipe.read(buffer);
    if (count === null) break;
    parts.push(buffer.slice(0, count));
  }
  const merged = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(merged);
}

async function runSpawned(
  launch: AppLaunch,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = await spawnApp(launch);
  const stdout = pipeText(child.stdout);
  const stderr = pipeText(child.stderr);
  const code = await child.exited;
  await child.terminate();
  return { code, stdout: await stdout, stderr: await stderr };
}

async function stopCore(core: SpawnedCore): Promise<void> {
  core.stop(5_000);
  const child = core.child;
  for (let i = 0; i < 40 && child.exitCode === null; i += 1) {
    await delay(250);
  }
  if (child.exitCode === null) {
    try {
      child.kill("SIGKILL");
    } catch { /* 이미 끝남 */ }
  }
}

Deno.test({
  name:
    "platform/install-and-update#R4 apps/runtime#R23 apps/sdk#R10 coding-agent/connection#R16 flow work-offline 2: 플랫폼·앱·패키지 MCP는 다운로드 없이 고정 의존성과 pinned SDK로 시작한다",
  ignore: Deno.env.get("LOPHN_E2E") !== "1",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const root = await Deno.makeTempDir({ prefix: "lophn-e2e-offline-step2-" });
    const home = `${root}/lophn-home`;
    const sessionHome = `${root}/session-home`;
    const denoDir = `${root}/deno`;
    const appDeno = `${root}/app-deno`;
    await Deno.mkdir(home);
    await Deno.chmod(home, 0o700);
    await Deno.mkdir(sessionHome);
    await Deno.mkdir(denoDir);
    await Deno.mkdir(appDeno);
    const sourceCache = sourceDenoDir();
    for (const name of CACHE_STORES) {
      const from = `${sourceCache}/${name}`;
      try {
        await Deno.stat(from);
      } catch {
        continue;
      }
      const copied = await new Deno.Command("cp", {
        args: ["-a", from, `${denoDir}/${name}`],
      }).output();
      assert(copied.success, `${name} 캐시 사본을 만들지 못했다`);
    }
    try {
      await Deno.symlink(`${sourceCache}/gen`, `${denoDir}/gen`);
    } catch {
      // transpile cache가 없어도 고정 의존성만으로 시작해야 한다.
    }
    const offlineEnv = {
      HOME: sessionHome,
      DENO_DIR: denoDir,
      PATH: "",
      HTTPS_PROXY: BLOCKED_PROXY,
      HTTP_PROXY: BLOCKED_PROXY,
      ALL_PROXY: BLOCKED_PROXY,
      NO_PROXY: "127.0.0.1,localhost,::1",
      DENO_NO_UPDATE_CHECK: "1",
    };
    const before = await cacheListing(denoDir);
    assert(
      before.some((path) => path.startsWith("npm/")),
      "고정 npm 의존성 사본이 없다",
    );
    let core: SpawnedCore | undefined;
    try {
      await t.step(
        "platform/install-and-update#R4: 플랫폼은 동봉 runtime과 고정 의존성으로 시작하고 다운로드하지 않는다",
        async () => {
          const launch = coreLaunch({
            repoRoot: OFFLINE_REPO,
            dataRoot: home,
            denoBinary: Deno.execPath(),
            packaged: true,
            env: offlineEnv,
          });
          assertEquals(launch.command, Deno.execPath());
          assert(launch.args.includes("--cached-only"));
          assert(launch.args.includes("--frozen"));
          assert(launch.args.includes("--no-prompt"));
          assertEquals(launch.args.includes("--allow-all"), false);
          assertEquals(launch.args.includes("-A"), false);
          core = spawnCore({
            repoRoot: OFFLINE_REPO,
            dataRoot: home,
            denoBinary: Deno.execPath(),
            packaged: true,
            env: offlineEnv,
          });
          const hello = await core.hello;
          assert(hello.api_port > 0);
          assert(hello.user_token.length > 0);
          assert(hello.core_epoch.length > 0);
          const cmdline = await Deno.readTextFile(
            `/proc/${core.child.pid}/cmdline`,
          );
          assert(cmdline.includes("--cached-only"));
          assert(cmdline.includes("--frozen"));
          assertEquals(cmdline.includes("--allow-all"), false);
          await stopCore(core);
          core = undefined;
        },
      );

      await t.step(
        "apps/runtime#R23 apps/sdk#R10: 앱은 pinned SDK byte로 뜨고 원격 import와 설치 사본 변경은 받지 않는다",
        async () => {
          const installCopy = `${root}/install-sdk/probe/1.0.0/mod.ts`;
          await Deno.mkdir(`${root}/install-sdk/probe/1.0.0`, {
            recursive: true,
          });
          await Deno.writeTextFile(
            installCopy,
            `export const hello = () => "mutated-install";\n`,
          );
          const pinned = `export const hello = () => "pinned-sdk";\n`;
          const main = [
            `import { hello } from "@lophn/probe";`,
            `let outside = "read";`,
            `try { await Deno.readTextFile(${JSON.stringify(installCopy)}); }`,
            `catch { outside = "denied"; }`,
            `console.log(JSON.stringify({ hello: hello(), outside }));`,
          ].join("\n");
          const files = new Map<string, string>([
            ["main.ts", main],
            ["sdk/probe/1.0.0/mod.ts", pinned],
            [
              "import-map.json",
              JSON.stringify({
                imports: { "@lophn/probe": "./sdk/probe/1.0.0/mod.ts" },
              }),
            ],
          ]);
          const blueprintJson = canonicalJson(
            blueprint({
              commands: [declared("list")],
              screens: [{
                key: "home",
                label: "Home",
                path: "/home",
                sizes: ["full"],
              }],
              sdk_dependencies: [{ name: "@lophn/probe", version: "1.0.0" }],
            }) as never,
          );
          const manifestFiles: { path: string; hash: string }[] = [];
          for (const [path, text] of files) {
            manifestFiles.push({ path, hash: await sha256Hex(text) });
          }
          manifestFiles.push({
            path: "blueprint.json",
            hash: await sha256Hex(blueprintJson),
          });
          const manifest = {
            entrypoint: "main.ts",
            files: manifestFiles,
            sdk_dependencies: [{ name: "@lophn/probe", version: "1.0.0" }],
          };
          const bundleHash = await sha256Hex(
            new TextDecoder().decode(manifestBytes(manifest)),
          );
          const copy = bundleCopyPath(home, OFFLINE_APP, bundleHash);
          assert(copy.ok, copy.ok ? "" : copy.error.message);
          const sealed = await sealBundle({
            copyPath: copy.value,
            manifest,
            blueprintJson: new TextEncoder().encode(blueprintJson),
            bundleFiles: [...files].map(([path, text]) => ({
              path,
              bytes: new TextEncoder().encode(text),
            })),
          });
          assert(sealed.ok, sealed.ok ? "" : sealed.error.message);
          const read = await readBundleCopy(home, OFFLINE_APP, bundleHash);
          assert(
            read.ok && read.value !== undefined,
            "bundle 사본을 못 읽는다",
          );
          const parts = read.value;
          const dataPath = `${home}/apps/${OFFLINE_APP}/data`;
          await Deno.mkdir(dataPath, { recursive: true });
          const flags = bundleFlags(parts, {
            requirements: [],
            dataPath,
            platform: { ports: [7431] },
            protectedDenies: [],
          });
          assert(flags.ok, flags.ok ? "" : flags.error.message);
          for (
            const flag of [
              "--no-prompt",
              "--no-config",
              "--no-remote",
              "--no-npm",
              "--cached-only",
            ]
          ) {
            assert(flags.value.args.includes(flag), flag);
          }
          assertEquals(flags.value.args.includes("--allow-all"), false);
          const launch: AppLaunch = {
            deno: Deno.execPath(),
            entry: parts.entry,
            flags: flags.value,
            importMap: parts.importMap,
            environment: {
              home: sessionHome,
              denoDir: appDeno,
              xdgCacheHome: `${root}/xdg-cache`,
              path: "/usr/bin:/bin",
            },
            startLine: "{}",
          };
          const ran = await runSpawned(launch);
          assertEquals(
            ran.code,
            0,
            ran.stderr,
          );
          assertEquals(JSON.parse(ran.stdout), {
            hello: "pinned-sdk",
            outside: "denied",
          });
          await Deno.writeTextFile(
            installCopy,
            `export const hello = () => "mutated-again";\n`,
          );
          const again = await runSpawned(launch);
          assertEquals(again.code, 0, again.stderr);
          assertEquals(JSON.parse(again.stdout).hello, "pinned-sdk");

          await Deno.chmod(parts.root, 0o755);
          await Deno.chmod(`${parts.root}/manifest.json`, 0o644);
          await Deno.writeTextFile(
            `${parts.root}/manifest.json`,
            `${await Deno.readTextFile(`${parts.root}/manifest.json`)} `,
          );
          const broken = await readBundleCopy(home, OFFLINE_APP, bundleHash);
          assert(!broken.ok);
          assertEquals(broken.error.code, "unavailable");

          const remoteDir = `${root}/remote-app`;
          const remoteData = `${root}/remote-data`;
          await Deno.mkdir(remoteDir);
          await Deno.mkdir(remoteData);
          await Deno.writeTextFile(
            `${remoteDir}/import-map.json`,
            JSON.stringify({ imports: {} }),
          );
          await Deno.writeTextFile(
            `${remoteDir}/main.ts`,
            `import "https://127.0.0.1:9/not-pinned.ts";\n`,
          );
          const remoteFlags = appFlags(
            [],
            { bundle: remoteDir, data: remoteData },
            { ports: [] },
            [],
          );
          assert(
            remoteFlags.ok,
            remoteFlags.ok ? "" : remoteFlags.error.message,
          );
          assert(remoteFlags.value.args.includes("--no-remote"));
          assert(remoteFlags.value.args.includes("--no-npm"));
          const remote = await runSpawned({
            deno: Deno.execPath(),
            entry: `${remoteDir}/main.ts`,
            flags: remoteFlags.value,
            importMap: `${remoteDir}/import-map.json`,
            environment: {
              home: sessionHome,
              denoDir: appDeno,
              path: "/usr/bin:/bin",
            },
            startLine: "{}",
          });
          assert(remote.code !== 0, remote.stdout);
          const npmDir = `${root}/npm-app`;
          const npmData = `${root}/npm-data`;
          await Deno.mkdir(npmDir);
          await Deno.mkdir(npmData);
          await Deno.writeTextFile(
            `${npmDir}/import-map.json`,
            JSON.stringify({ imports: {} }),
          );
          await Deno.writeTextFile(
            `${npmDir}/main.ts`,
            `import "npm:left-pad@1.3.0";\n`,
          );
          const npmFlags = appFlags(
            [],
            { bundle: npmDir, data: npmData },
            { ports: [] },
            [],
          );
          assert(npmFlags.ok, npmFlags.ok ? "" : npmFlags.error.message);
          const npm = await runSpawned({
            deno: Deno.execPath(),
            entry: `${npmDir}/main.ts`,
            flags: npmFlags.value,
            importMap: `${npmDir}/import-map.json`,
            environment: {
              home: sessionHome,
              denoDir: appDeno,
              path: "/usr/bin:/bin",
            },
            startLine: "{}",
          });
          assert(npm.code !== 0, npm.stdout);
        },
      );

      await t.step(
        "coding-agent/connection#R16: 패키지 MCP는 설치된 코드·설정·캐시만으로 initialize와 tool 발견을 한다",
        async () => {
          const argv = mcpLaunchArgv({
            deno: Deno.execPath(),
            resources: OFFLINE_REPO,
            cache: denoDir,
            connection: "",
            coreEndpoint: "http://127.0.0.1:1",
          });
          assertEquals(argv.command, Deno.execPath());
          assert(argv.args.includes("--cached-only"));
          assert(argv.args.includes("--no-prompt"));
          assertEquals(argv.args.includes("-A"), false);
          assertEquals(argv.args.includes("--allow-all"), false);
          assert(
            argv.args.includes(`--config=${OFFLINE_REPO}/deno.json`),
          );
          const child = new Deno.Command(argv.command, {
            args: argv.args,
            cwd: OFFLINE_REPO,
            clearEnv: true,
            env: { ...argv.env, ...offlineEnv, LOPHN_HOME: home },
            stdin: "piped",
            stdout: "piped",
            stderr: "piped",
          }).spawn();
          const encoder = new TextEncoder();
          const writer = child.stdin.getWriter();
          await writer.write(
            encoder.encode(
              '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"offline"}}}\n',
            ),
          );
          await writer.write(
            encoder.encode('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n'),
          );
          await writer.close();
          const decoder = new TextDecoder();
          let stdout = "";
          let stderrText = "";
          const timer = setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch { /* 이미 끝남 */ }
          }, 60_000);
          const diag = (async () => {
            for await (const chunk of child.stderr) {
              stderrText += decoder.decode(chunk, { stream: true });
            }
          })();
          try {
            for await (const chunk of child.stdout) {
              stdout += decoder.decode(chunk, { stream: true });
              if (stdout.includes("lophn_index")) break;
            }
          } finally {
            clearTimeout(timer);
            try {
              child.kill("SIGTERM");
            } catch { /* 이미 끝남 */ }
          }
          await child.status;
          await diag;
          assert(stdout.includes('"serverInfo"'), stderrText);
          assert(stdout.includes("2025-06-18"));
          assert(stdout.includes("lophn_index"), stderrText);
          assertEquals(stdout.startsWith("{"), true);
          assertEquals(stderrText.includes("Download"), false, stderrText);
        },
      );

      const after = await cacheListing(denoDir);
      const added = addedPaths(before, after);
      assertEquals(
        added,
        [],
        `의존성 캐시에 새 파일이 생겼다: ${added.slice(0, 8).join(", ")}`,
      );
    } finally {
      if (core !== undefined) await stopCore(core);
      await removeTree(root);
    }
  },
});
