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
import { DatabaseSync } from "node:sqlite";

import { fingerprint, sha256Hex } from "../../packages/base/mod.ts";
import { canonicalJson } from "../../packages/apps/blueprint/mod.ts";
import { appFlags } from "../../packages/apps/permissions/mod.ts";
import { prepareFromSource } from "../../packages/apps/releases/prepare/from-source.ts";
import {
  bundleCopyPath,
  bundleFlags,
  declarationsOfBlueprint,
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
  devImportMap,
  readTemplateDirectory,
} from "../../packages/apps/sdk/mod.ts";
import {
  installedHome,
  removeTree,
} from "../../packages/apps/sdk/testing/mod.ts";
import { startFakeProvider } from "../../tools/fake-provider/mod.ts";
import {
  descendantPids,
  e2eEnabled,
  processAlive,
  READY_TIMEOUT_MS,
  signalPids,
} from "../harness.ts";
import {
  APP,
  DATA_SCHEMA,
  FIXTURE,
  prepareBrokenApp,
  seedLedger,
} from "../broken-app.ts";
import {
  commandBody,
  delay,
  documentTitled,
  type FlowShell,
  listDocuments,
  mustCall,
  openFlowShell,
  PROJECT,
  registerTrackedProject,
  removeHome,
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

// flow work-offline 3단계. 프로젝트·문서·앱 화면에서 외부 연결이 필요한 동작만
// 연결 실패·기다림·결과 모름으로 안내한다. 로컬 문서와 다른 앱은 그 안내를 받지 않고
// 멈추지 않는다. 4–7단계, update-lophn, install-lophn은 보지 않는다.
const CLOSED_PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fb1";
const FIXTURE_PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fb2";
const HANG_APP = "app_01h455vb4pex5v6nkc6gd5fdw2";
const HANG_RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw2";
const HANG_VERIFICATION = "vrf_01h455vb4pex5v6nkc6gd5fdw2";
const MODEL = "claude-sonnet-4-5";
const NOTE = "Keep the local note.";
const HOLD_GATE = "hold-answer";
const INPUT = "[data-composer-input]";
const SEND = "[data-send]";
const WORKER_NEEDLES = [
  "apps/worker/problems/report-collector.ts",
  "apps/worker/problems/test-runner.ts",
  "apps/worker/coding-agent/checker.ts",
  "apps/worker/platform/",
];

const MARK_KIND_BEFORE = [
  "export function markKindHandler(deps: Deps = defaults) {",
  "  return (input: unknown) => {",
  "    const body = input as { kind?: unknown; label?: unknown };",
  '    const kind = typeof body?.kind === "string" ? body.kind : "";',
  "    deps.log(`mark_kind ${kind}`);",
  "    return { marked: kind };",
  "  };",
  "}",
].join("\n");

const MARK_KIND_AFTER = [
  "export function markKindHandler(deps: Deps = defaults) {",
  "  return async (input: unknown) => {",
  "    const body = input as { kind?: unknown; label?: unknown };",
  '    const kind = typeof body?.kind === "string" ? body.kind : "";',
  "    deps.log(`mark_kind ${kind}`);",
  "    const host = (globalThis as unknown as Record<",
  "      symbol,",
  "      { dataPath?: string } | undefined",
  '    >)[Symbol.for("lophn.cap-host")];',
  "    const dataPath = host?.dataPath;",
  '    if (typeof dataPath !== "string" || dataPath.length === 0) {',
  '      throw new Error("app data path is missing");',
  "    }",
  "    const marker = `${dataPath}/hang-once`;",
  "    try {",
  "      await Deno.stat(marker);",
  "    } catch {",
  "      await Deno.writeTextFile(marker, `${kind}\\n`);",
  "    }",
  "    await new Promise<never>(() => {});",
  "    return { marked: kind };",
  "  };",
  "}",
].join("\n");

type PreparedBundle = {
  bundleHash: string;
  blueprintHash: string;
  blueprint: string;
};

type ModelCallRow = {
  state: string;
  started_at: string;
  attempt_order: number;
  outcome:
    | { kind: string; code?: string | null; retry_at?: string | null }
    | null;
};

type InvocationRow = {
  status: string;
  operation: { kind: string; command?: string };
  summary: { reason?: string; observation?: string; effects?: string };
};

type RunRow = {
  id: string;
  session: string | null;
  state: string;
  accepted_seq: string;
  start_after: string | null;
  outcome: { kind: string } | null;
};

function heldAnswer(id: string, gate: string, text: string) {
  const frames = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
    `event: content_block_delta\ndata: ${
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      })
    }\n\n`,
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
  return {
    id,
    protocol: "messages" as const,
    response: {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      chunks: [
        { bytes: frames[0]! },
        { bytes: frames.slice(1).join(""), gate },
      ],
    },
  };
}

function endTurn(id: string, text: string) {
  return {
    id,
    protocol: "messages" as const,
    reply: { text, usage: { input: 40, output: 9 }, stop: "end" as const },
  };
}

function askQuestion(id: string) {
  return {
    id,
    protocol: "messages" as const,
    reply: {
      text: "One decision is yours.",
      toolCalls: [{
        id: "toolu_ask",
        name: "question.submit",
        arguments: JSON.stringify({
          prompt: "Which note?",
          reason: "the note has two possible meanings",
          options: [{
            key: "keep",
            label: "Keep the local note",
            description: "Leave the note as it is.",
            evidence: [],
            adoption: null,
            action: null,
          }],
          recommendation: null,
          expires_at: null,
        }),
      }],
      usage: { input: 20, output: 8 },
      stop: "tool_calls" as const,
    },
  };
}

function newerCall(left: ModelCallRow, right: ModelCallRow): ModelCallRow {
  if (left.attempt_order !== right.attempt_order) {
    return left.attempt_order > right.attempt_order ? left : right;
  }
  return left.started_at >= right.started_at ? left : right;
}

function newest(runs: readonly RunRow[]): RunRow | null {
  let found: RunRow | null = null;
  for (const run of runs) {
    if (
      found === null || BigInt(run.accepted_seq) > BigInt(found.accepted_seq)
    ) found = run;
  }
  return found;
}

// failed 선행의 후속은 start_confirmed_seq 없이 시작하지 않는다. 기다림은 그 후속이 아니다.
function apartFromFailure(
  run: RunRow,
  runs: readonly RunRow[],
  failed: { id: string; session: string | null },
): boolean {
  if (run.id === failed.id || run.start_after === failed.id) return false;
  if (run.start_after === null) return run.session !== failed.session;
  const predecessor = runs.find((row) => row.id === run.start_after);
  return predecessor?.state === "finished" &&
    predecessor.outcome?.kind === "completed";
}

function within<T>(ms: number, work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what}: ${ms}ms 안에 돌아오지 않았다`)),
      ms,
    );
  });
  work.catch(() => undefined);
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function readCmdline(pid: number): Promise<string> {
  const raw = await Deno.readFile(`/proc/${pid}/cmdline`);
  return new TextDecoder().decode(raw).replaceAll("\0", " ");
}

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

async function materialize(
  parent: string,
  name: string,
  sdkRoot: string,
  patch: string | null,
): Promise<string> {
  const dir = `${parent}/${name}`;
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
    const bytes = file.path === "src/commands.ts" && patch !== null
      ? new TextEncoder().encode(patch)
      : file.bytes;
    await Deno.writeFile(target, bytes);
  }
  await Deno.mkdir(`${dir}/.lophn`);
  await Deno.writeTextFile(
    `${dir}/.lophn/import-map.json`,
    JSON.stringify(devImportMap(config.imports, sdkRoot, dir)),
  );
  return dir;
}

async function commitSource(dir: string): Promise<string> {
  await git(dir, ["init", "-q"]);
  await git(dir, ["config", "user.email", "dev@lophn.local"]);
  await git(dir, ["config", "user.name", "dev"]);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "init"]);
  return await git(dir, ["rev-parse", "HEAD"]);
}

async function preparedBundle(
  home: string,
  app: string,
  sourceRoot: string,
  commit: string,
  sdkRoot: string,
): Promise<PreparedBundle> {
  const prepared = await prepareFromSource({
    dataRoot: home,
    app,
    sourceRoot,
    commit,
    sdkRoot,
  });
  assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
  return {
    bundleHash: prepared.value.bundleHash,
    blueprintHash: prepared.value.blueprintHash,
    blueprint: await Deno.readTextFile(
      `${prepared.value.copyPath}/blueprint.json`,
    ),
  };
}

function seedHang(home: string, bundle: PreparedBundle): void {
  const blueprint = JSON.parse(bundle.blueprint);
  const declarations = declarationsOfBlueprint(HANG_RELEASE, blueprint);
  assert(declarations !== undefined, "Hang 선언 사실을 만들지 못했다");
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, planning_version, source_path, active_release, run_enabled, revision, status)
       VALUES (?, 'hang', 'Hang', 'A write that does not return', NULL, NULL, ?, 1, '1', 'active')`,
    ).run(HANG_APP, HANG_RELEASE);
    db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash, data_schema, data_changes, ticket_source, created_by, created_at, status, activation, failure, blueprint, declarations)
       VALUES (?, ?, 1, ?, ?, ?, ?, '[]', NULL, 'machine', ?, 'active', NULL, NULL, ?, ?)`,
    ).run(
      HANG_RELEASE,
      HANG_APP,
      "b".repeat(40),
      bundle.bundleHash,
      bundle.blueprintHash,
      DATA_SCHEMA,
      "2026-10-01T00:00:00.000Z",
      bundle.blueprint,
      JSON.stringify(declarations),
    );
    db.prepare(
      "INSERT INTO release_tests (release, verification) VALUES (?, ?)",
    ).run(HANG_RELEASE, HANG_VERIFICATION);
  } finally {
    db.close();
  }
}

function providerBody(id: string, name: string, endpoint: string) {
  return commandBody({
    id,
    name,
    definition: {
      key: "anthropic",
      display_name: "Anthropic",
      protocols: ["anthropic-messages"],
      auth_kinds: ["none"],
      models_endpoint: null,
      oauth: null,
      revision: "2026-01-01",
    },
    endpoint,
    protocol: "anthropic-messages",
  });
}

Deno.test({
  name:
    "apps/runtime#R12 shell/desktop#R7 lophn-agent/harness/waiting-and-recovery#R6 platform/responsiveness#R1 platform/responsiveness#R5 shell/wording#R10 flow work-offline 3: 외부 연결이 필요한 동작만 연결 실패·기다림·결과 모름으로 안내하고 로컬 문서·앱은 멈추지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-offline3-folder-" }),
    );
    await Deno.writeTextFile(`${folder}/note.md`, `# note\n\n${NOTE}\n`);
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-offline3-" });
    await Deno.chmod(home, 0o700);
    let flow: FlowShell | undefined;
    let fixture: ReturnType<typeof startFakeProvider> | undefined;
    let stopped: number | undefined;
    const shell = (): FlowShell => {
      if (flow === undefined) throw new Error("shell이 없다");
      return flow;
    };
    const closeFlow = async () => {
      const current = flow;
      flow = undefined;
      await current?.close();
    };
    try {
      flow = await openFlowShell({ home });
      await registerTrackedProject(flow, {
        folder,
        name: "alpha",
        title: "Alpha",
      });
      await untilDocuments(flow, ["note"], "노트가 문서가 되지 않았다");
      const noteId = (await documentTitled(flow, "note")).id;
      await closeFlow();

      const installed = await installedHome();
      const parent = await Deno.makeTempDir({
        prefix: "lophn-e2e-offline3-src-",
      });
      try {
        const source = await Deno.readTextFile(
          `${FIXTURE}/src/commands.ts.tmpl`,
        );
        assertEquals(source.split(MARK_KIND_BEFORE).length - 1, 1);
        const patched = source.replace(MARK_KIND_BEFORE, MARK_KIND_AFTER);
        assertEquals(patched.includes("hang-once"), true);
        assertEquals(patched.split(MARK_KIND_BEFORE).length - 1, 0);
        const localDir = await materialize(
          parent,
          "local",
          installed.sdkRoot,
          null,
        );
        const hangDir = await materialize(
          parent,
          "hang",
          installed.sdkRoot,
          patched,
        );
        const local = await preparedBundle(
          home,
          APP,
          localDir,
          await commitSource(localDir),
          installed.sdkRoot,
        );
        const hang = await preparedBundle(
          home,
          HANG_APP,
          hangDir,
          await commitSource(hangDir),
          installed.sdkRoot,
        );
        seedLedger(home, local);
        seedHang(home, hang);
      } finally {
        await removeTree(parent);
        await installed.dispose();
      }

      fixture = startFakeProvider({
        script: {
          steps: [
            heldAnswer("hold", HOLD_GATE, "Holding the answer."),
            askQuestion("ask"),
            endTurn("spare", "The question is waiting."),
          ],
        },
        nowMs: () => Date.now(),
        instant: true,
      });
      const server = fixture;
      flow = await openFlowShell({ home, start: `project:${PROJECT}` });

      const spaceOf = async (): Promise<string> =>
        String(
          await shell().evaluate(
            `document.querySelector("[data-space]")?.getAttribute("data-space") ?? ""`,
          ),
        );
      const goLauncher = async () => {
        if (await spaceOf() === "launcher") return;
        await shell().click("[data-launcher-back]");
        await shell().until(
          `document.querySelector("[data-space]")?.getAttribute("data-space") === "launcher"`,
          "launcher로 돌아오지 않았다",
        );
      };
      const goLophn = async () => {
        if (await spaceOf() === "app") await goLauncher();
        if (await spaceOf() === "lophn") return;
        await shell().click("[data-entry=lophn]");
        await shell().until(
          `document.querySelector("[data-space]")?.getAttribute("data-space") === "lophn"`,
          "lophn 공간이 서지 않았다",
        );
      };
      const goApps = async () => {
        await goLophn();
        await shell().click("[data-screen=apps]");
        await shell().until(
          `document.querySelector("[data-app-row] [data-action=open]") !== null`,
          "앱 목록이 서지 않았다",
        );
      };
      const openNamedApp = async (name: string) => {
        await goApps();
        const clicked = await shell().evaluate(`(() => {
          const row = [...document.querySelectorAll("[data-app-row]")].find((item) => item.querySelector("span")?.textContent === ${
          JSON.stringify(name)
        });
          const button = row?.querySelector("[data-action=open]");
          if (!button) return false;
          button.click();
          return true;
        })()`);
        assertEquals(clicked, true, `${name} 앱 행이 없다`);
        await shell().until(
          `document.querySelector("[data-space]")?.getAttribute("data-space") === "app"`,
          `${name} 앱 공간이 서지 않았다`,
        );
      };
      const goProject = async (timeoutMs?: number) => {
        if (await spaceOf() === "project") return;
        if (await spaceOf() !== "launcher") await goLauncher();
        // 런처 카드는 space가 launcher가 된 뒤 projects.list가 돌아와야 생긴다.
        const card =
          `[data-card="project"][data-project="${PROJECT}"] button:not([data-details-toggle])`;
        await shell().until(
          `document.querySelector(${JSON.stringify(card)}) !== null`,
          "프로젝트 카드가 없다",
          timeoutMs,
        );
        await shell().click(card);
        await shell().until(
          `document.querySelector("[data-space]")?.getAttribute("data-space") === "project"`,
          "프로젝트 작업대가 서지 않았다",
          timeoutMs,
        );
      };
      const openNote = async (bodyTimeout?: number) => {
        await goProject(bodyTimeout);
        await shell().until(
          `document.querySelector('[data-document="${noteId}"]') !== null`,
          "sidebar에 노트가 없다",
        );
        await shell().click(`[data-document="${noteId}"]`);
        const expression =
          `document.querySelector("[data-document-body]")?.textContent?.includes(${
            JSON.stringify(NOTE)
          })`;
        if (bodyTimeout === undefined) {
          await shell().until(expression, "노트 본문이 열리지 않았다");
        } else {
          await shell().until(
            expression,
            "노트 본문이 열리지 않았다",
            bodyTimeout,
          );
        }
      };
      const runsOf = async (): Promise<RunRow[]> => {
        const listed = await mustCall(shell(), {
          kind: "read",
          resource: "assignments",
          method: "list",
          body: {},
        });
        const agent = (listed.assignments as { id: string; role: string }[])
          .find((entry) => entry.role === "lophn");
        assert(agent !== undefined, "lophn assignment가 없다");
        const runs = await mustCall(shell(), {
          kind: "read",
          resource: "runs",
          method: "list",
          body: { assignment: agent.id },
        });
        return runs.runs as RunRow[];
      };
      const latestRun = async (): Promise<RunRow | null> => {
        let found: RunRow | null = null;
        for (const run of await runsOf()) {
          if (
            found === null ||
            BigInt(run.accepted_seq) > BigInt(found.accepted_seq)
          ) found = run;
        }
        return found;
      };
      const modelCalls = async (run: string): Promise<ModelCallRow[]> => {
        const rows: ModelCallRow[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 8; page += 1) {
          const listed = await mustCall(shell(), {
            kind: "read",
            resource: "model-calls",
            method: "list",
            body: cursor === undefined ? { run } : { run, cursor },
          });
          rows.push(...listed.calls as ModelCallRow[]);
          const next = listed.next_cursor;
          if (typeof next !== "string" || next.length === 0) return rows;
          cursor = next;
        }
        return rows;
      };
      const invocationsOf = async (app: string): Promise<InvocationRow[]> => {
        const listed = await mustCall(shell(), {
          kind: "read",
          resource: "invocations",
          method: "list",
          body: { app, limit: 50 },
        });
        return listed.invocations as InvocationRow[];
      };
      const markKinds = async (): Promise<InvocationRow[]> =>
        (await invocationsOf(HANG_APP)).filter((row) =>
          row.operation.kind === "command" &&
          row.operation.command === "mark_kind"
        );
      const untilReady = async (app: string) => {
        const deadline = Date.now() + 120_000;
        let last = "";
        while (Date.now() < deadline) {
          const got = await mustCall(shell(), {
            kind: "read",
            resource: "apps",
            method: "runtime",
            body: { app },
          });
          const observation = got.observation as {
            ready?: boolean;
            mode?: string;
            reason?: string;
          } | null;
          if (observation?.ready === true && observation.mode === "live") {
            return;
          }
          last = JSON.stringify(observation);
          await delay(400);
        }
        throw new Error(`${app} runtime이 준비되지 않았다: ${last}`);
      };
      const pointAt = async (provider: string) => {
        let last = "";
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const defaults = await mustCall(shell(), {
            kind: "read",
            resource: "agent-model-defaults",
            method: "read",
            body: {},
          });
          const seq =
            (defaults.defaults as { settings_seq: string }).settings_seq;
          const reply = await shell().call({
            kind: "command",
            resource: "agent-model-defaults",
            method: "change",
            body: commandBody(
              {
                judgment: {
                  provider,
                  credentials: [],
                  model_name: MODEL,
                  reasoning_level: "provider_default",
                  options: {},
                },
                organizing: null,
                settings_seq: seq,
              },
              { settings_seq: seq },
            ),
          });
          if (reply.ok) return;
          last = JSON.stringify(reply);
          if (reply.error?.code !== "conflict") break;
        }
        throw new Error(`model 기본값을 바꾸지 못했다: ${last}`);
      };
      const openDock = async () => {
        if (
          await shell().evaluate(
            `document.querySelector("[data-dock]") === null`,
          ) ===
            true
        ) {
          await shell().until(
            `document.querySelector("[data-dock-toggle]") !== null`,
            "도크 토글이 없다",
          );
          await shell().click("[data-dock-toggle]");
          await shell().until(
            `document.querySelector("[data-dock]") !== null`,
            "대화 도크가 열리지 않았다",
          );
        }
        await shell().until(
          `document.querySelector("[data-new-session]") !== null || document.querySelector(${
            JSON.stringify(INPUT)
          }) !== null`,
          "도크가 서지 않았다",
        );
        if (
          await shell().evaluate(
            `document.querySelector(${JSON.stringify(INPUT)}) === null`,
          ) === true
        ) {
          await shell().click("[data-new-session]");
        }
        await shell().until(
          `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
          "입력칸이 서지 않았다",
        );
      };
      const sendText = async (text: string) => {
        await openDock();
        await shell().type(INPUT, text);
        await shell().until(
          `document.querySelector(${JSON.stringify(SEND)})?.disabled === false`,
          "보내기가 켜지지 않았다",
        );
        await shell().click(SEND);
      };
      // 같은 세션의 다음 말은 마지막 run을 start_after로 잇는다. 기다림은 그 세션에 보내지 않는다.
      const openOtherSession = async () => {
        await openDock();
        await shell().until(
          `document.querySelector("[data-dock] [data-session-menu]") !== null`,
          "세션 메뉴가 없다",
        );
        const before = String(
          await shell().evaluate(
            `document.querySelector("[data-dock] [data-session-menu]")?.textContent ?? ""`,
          ),
        );
        const opened = await shell().evaluate(`(() => {
          const dock = document.querySelector("[data-composer-input]")?.closest("[data-dock]")
            ?? document.querySelector("[data-dock]");
          const button = dock?.querySelector("[data-new-session]");
          if (!button) return false;
          button.click();
          return true;
        })()`);
        assertEquals(opened, true, "다른 세션을 열 버튼이 없다");
        await shell().until(
          `(() => {
            const label = document.querySelector("[data-dock] [data-session-menu]")?.textContent ?? "";
            return label.length > 0 && label !== ${JSON.stringify(before)};
          })()`,
          "다른 세션이 열리지 않았다",
          20_000,
        );
        await shell().until(
          `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
          "새 세션 입력칸이 서지 않았다",
        );
      };
      const appPage = (app: string) =>
        shell().shell.connect(`lophn-app://app-${app.slice(4)}`);
      const untilBridge = async (
        page: Awaited<ReturnType<FlowShell["shell"]["connect"]>>,
      ) => {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          try {
            if (
              await page.evaluate(
                `typeof window.lophnApp?.call === "function"`,
              ) === true
            ) return;
          } catch { /* 화면이 아직 없다 */ }
          await delay(200);
        }
        throw new Error("앱 bridge가 서지 않았다");
      };
      const readLocalSettings = async (
        page: Awaited<ReturnType<FlowShell["shell"]["connect"]>>,
        ms: number,
      ): Promise<string> => {
        const deadline = Date.now() + ms;
        let last = "";
        while (Date.now() < deadline) {
          try {
            const value = await within(
              Math.max(1, deadline - Date.now()),
              page.evaluate(
                `window.lophnApp.call("read_settings", null).then((body) => "ok:" + JSON.stringify(body), (error) => "failed:" + String(error && error.message || error))`,
              ),
              "read_settings",
            );
            last = typeof value === "string" ? value : JSON.stringify(value);
            if (last.startsWith("ok:") && last.includes("{")) return last;
          } catch (error) {
            last = String(error);
          }
          await delay(200);
        }
        return last;
      };
      const pidsOf = async (needle: string): Promise<number[]> => {
        const found: number[] = [];
        for (const pid of await descendantPids(shell().shell.pid)) {
          try {
            const cmdline = await readCmdline(pid);
            if (cmdline.includes(needle)) found.push(pid);
          } catch { /* 이미 끝남 */ }
        }
        return found;
      };

      await openNote();
      assertEquals(
        await shell().evaluate(
          `document.querySelector("[data-document-view] [data-external]") === null`,
        ),
        true,
      );
      assertEquals(
        String(await shell().text("[data-document-view]")).includes(
          "Result unknown",
        ),
        false,
      );
      assertEquals(
        await shell().count("[data-document-view] [data-expires]"),
        0,
      );

      await mustCall(shell(), {
        kind: "command",
        resource: "providers",
        method: "register",
        body: providerBody(CLOSED_PROVIDER, "Closed", "http://127.0.0.1:1"),
      });
      await mustCall(shell(), {
        kind: "command",
        resource: "providers",
        method: "register",
        body: providerBody(FIXTURE_PROVIDER, "Fixture", server.url),
      });
      await pointAt(CLOSED_PROVIDER);
      await sendText("Check the closed connection.");
      const failedDeadline = Date.now() + 90_000;
      let failedRun = "";
      let failedSession: string | null = null;
      while (Date.now() < failedDeadline) {
        const run = await latestRun();
        if (run !== null && run.state === "finished") {
          const calls = await modelCalls(run.id);
          const open = calls.some((call) =>
            call.state === "started" || call.outcome === null
          );
          const latest = calls.length === 0 ? null : calls.reduce(newerCall);
          if (
            !open && latest?.outcome?.kind === "failed" &&
            latest.outcome.code === "temporary"
          ) {
            failedRun = run.id;
            failedSession = run.session;
            break;
          }
        }
        await delay(400);
      }
      assert(failedRun !== "", "연결 실패 호출이 끝나지 않았다");
      await shell().until(
        `document.querySelector("[data-external='connection-failed']")?.getAttribute("data-external-connection") === "Closed"`,
        "연결 실패 안내가 없다",
        20_000,
      );
      const failedText = await shell().text(
        "[data-external='connection-failed']",
      );
      assert(failedText?.includes("didn't respond"), failedText ?? "");
      assertEquals(
        await shell().count("[data-external='connection-failed'] button"),
        1,
      );
      assertEquals(await shell().count("[data-confirmed-retry]"), 0);
      assertEquals(await shell().count("[data-dock] [data-expires]"), 0);
      assertEquals(await shell().count("[data-provider='unusable']"), 0);
      assert(
        String(await shell().text("[data-document-body]")).includes(NOTE),
      );
      assertEquals(
        await shell().evaluate(
          `document.querySelector("[data-document-view] [data-external]") === null`,
        ),
        true,
      );
      const saveStatus = String(
        await shell().evaluate(
          `document.querySelector("[data-save-status]")?.getAttribute("data-save-status") ?? ""`,
        ),
      );
      assert(saveStatus !== "stale", saveStatus);
      assertEquals(
        String(await shell().text("[data-save-status]") ?? "").includes(
          "Not connected",
        ),
        false,
      );
      await shell().click("[data-external='connection-failed'] button");
      assertEquals(await shell().evaluate(`location.hash`), "#settings");

      // 연결 실패를 본 뒤 셸을 다시 연다. 같은 세션에서 실패 run 뒤에 말을 보내
      // 그 model 호출이 시작되기를 기다리지 않는다. 기다림은 다른 세션이다.
      await closeFlow();
      flow = await openFlowShell({ home, start: `project:${PROJECT}` });
      await openNote();
      await pointAt(FIXTURE_PROVIDER);
      await openOtherSession();
      await sendText("Hold this answer.");
      let heldRun = "";
      const failed = { id: failedRun, session: failedSession };
      const holdSeen = Date.now() + 90_000;
      while (Date.now() < holdSeen) {
        const runs = await runsOf();
        const run = newest(runs);
        if (run !== null && apartFromFailure(run, runs, failed)) {
          const calls = await modelCalls(run.id);
          if (
            calls.some((call) =>
              call.state === "started" && call.outcome === null
            )
          ) {
            heldRun = run.id;
            break;
          }
        }
        await delay(300);
      }
      if (heldRun === "") {
        const runs = await runsOf();
        const last = newest(runs);
        const lastCalls = last === null ? [] : await modelCalls(last.id);
        assert(
          false,
          `붙든 model 호출이 시작되지 않았다 run=${
            JSON.stringify(last)
          } calls=${
            JSON.stringify(lastCalls)
          } fixture=${server.requests().length}`,
        );
      }
      const heldRows = await runsOf();
      const held = heldRows.find((row) => row.id === heldRun);
      assert(held !== undefined, "기다림 run이 없다");
      assert(
        apartFromFailure(held, heldRows, failed),
        JSON.stringify(held),
      );
      const t0 = Date.now();
      await shell().until(
        `document.querySelector("[data-external='waiting']")?.getAttribute("data-external-connection") === "Fixture" && !document.querySelector("[data-external='waiting']")?.hasAttribute("data-external-action")`,
        "기다림 안내가 없다",
        20_000,
      );
      const waitingText = await shell().text("[data-external='waiting']");
      assert(waitingText?.includes("has not answered"), waitingText ?? "");
      assertEquals(await shell().count("[data-external='waiting'] button"), 0);
      assertEquals(await shell().count("[data-dock] [data-expires]"), 0);
      assertEquals(await shell().count("[data-confirmed-retry]"), 0);

      await openNamedApp("Hang");
      await untilReady(HANG_APP);
      const hangPage = await appPage(HANG_APP);
      await untilBridge(hangPage);
      const sent = await hangPage.evaluate(`(() => {
        const call = window.lophnApp.call("mark_kind", { kind: "once", view_session: "view-1" });
        const pending = new Promise((resolve) => setTimeout(() => resolve("pending"), 5000));
        return Promise.race([
          Promise.resolve(call).then(
            (value) => "ok:" + JSON.stringify(value),
            (error) => "failed:" + String(error && error.message),
          ),
          pending,
        ]);
      })()`);
      assert(
        sent === "pending" || String(sent).startsWith("ok:"),
        `mark_kind가 시작되지 않았다: ${String(sent)}`,
      );
      const marker = `${home}/apps/${HANG_APP}/data/hang-once`;
      const marked = Date.now() + 30_000;
      let marks: InvocationRow[] = [];
      while (Date.now() < marked) {
        marks = await markKinds();
        let file = "";
        try {
          file = await Deno.readTextFile(marker);
        } catch { /* 아직 없다 */ }
        if (
          marks.length === 1 && marks[0]?.status === "running" &&
          file === "once\n"
        ) break;
        await delay(200);
      }
      assertEquals(
        marks.length,
        1,
        `${JSON.stringify(marks)} call=${String(sent)}`,
      );
      assertEquals(marks[0]?.status, "running");
      assertEquals(await Deno.readTextFile(marker), "once\n");
      try {
        await hangPage.command("Page.crash");
      } catch { /* crash가 세션을 닫는다 */ }
      await delay(500);
      const afterCrash = await markKinds();
      assertEquals(afterCrash.length, 1);
      assertEquals(afterCrash[0]?.status, "running");

      await openNamedApp("Broken");
      await untilReady(APP);
      const tree = await descendantPids(shell().shell.pid);
      const lines: string[] = [];
      for (const pid of tree) {
        try {
          lines.push(`${pid} ${await readCmdline(pid)}`);
        } catch { /* 이미 끝남 */ }
      }
      for (const needle of WORKER_NEEDLES) {
        const pid = lines.map((line) => {
          const id = Number(line.slice(0, line.indexOf(" ")));
          return line.includes(needle) ? id : 0;
        }).find((id) => id > 0);
        if (pid === undefined) continue;
        signalPids([pid], "SIGSTOP");
        stopped = pid;
        try {
          await within(
            5_000,
            mustCall(shell(), {
              kind: "read",
              resource: "documents",
              method: "get",
              body: { document: noteId },
            }),
            "documents/get",
          );
          break;
        } catch {
          signalPids([pid], "SIGCONT");
          stopped = undefined;
        }
      }
      assert(
        stopped !== undefined,
        `무관한 worker를 멈추지 못했다: ${lines.join(" | ")}`,
      );
      const brokenPage = await appPage(APP);
      await untilBridge(brokenPage);
      const settings = await readLocalSettings(brokenPage, 5_000);
      assert(
        settings.startsWith("ok:") && settings.includes("{"),
        settings,
      );
      const toggled = await within(
        5_000,
        shell().evaluate(`(() => {
          const el = document.querySelector("[data-dock-toggle]");
          if (!el) return false;
          el.click();
          return true;
        })()`),
        "dock toggle",
      );
      assertEquals(toggled, true);
      await within(
        5_000,
        shell().evaluate(`(() => {
          const el = document.querySelector("[data-dock-toggle]");
          if (!el) return false;
          el.click();
          return true;
        })()`),
        "dock toggle back",
      );
      await openNote(8_000);
      const still = await modelCalls(heldRun);
      assert(
        still.some((call) => call.state === "started" && call.outcome === null),
        `model 호출이 끝나 버렸다: ${JSON.stringify(still)}`,
      );
      while (Date.now() - t0 < 30_000) {
        const calls = await modelCalls(heldRun);
        assert(
          calls.some((call) =>
            call.state === "started" && call.outcome === null
          ),
          `30초 전에 기다림이 끝났다: ${JSON.stringify(calls)}`,
        );
        await delay(1_000);
      }
      assert(Date.now() - t0 >= 30_000);
      if (stopped !== undefined) {
        signalPids([stopped], "SIGCONT");
        stopped = undefined;
      }

      server.release(HOLD_GATE);
      const released = Date.now() + 90_000;
      while (Date.now() < released) {
        const run = (await runsOf()).find((row) => row.id === heldRun);
        const calls = await modelCalls(heldRun);
        const open = calls.some((call) =>
          call.state === "started" || call.outcome === null
        );
        if (
          run?.state === "finished" && !open &&
          run.outcome?.kind === "completed"
        ) {
          break;
        }
        if (run?.state === "finished" && !open) {
          throw new Error(
            `붙든 run이 완료가 아니다: ${JSON.stringify(run)} calls=${
              JSON.stringify(calls)
            } requests=${server.requests().length}`,
          );
        }
        await delay(400);
      }
      const finishedHeld = (await runsOf()).find((row) => row.id === heldRun);
      assertEquals(finishedHeld?.outcome?.kind, "completed");
      await openDock();
      const questionShown = async () =>
        await shell().evaluate(
          `document.querySelector("[data-question-text='ready']") !== null`,
        ) === true;
      const early = Date.now() + 4_000;
      let asked = false;
      while (Date.now() < early) {
        if (await questionShown()) {
          asked = true;
          break;
        }
        await delay(200);
      }
      if (!asked) {
        await sendText("Ask one question.");
        await shell().until(
          `document.querySelector("[data-question-text='ready']") !== null`,
          "기다리는 질문이 서지 않았다",
          90_000,
        );
      }
      assertEquals(
        await shell().evaluate(
          `document.querySelector("[data-question-text='ready']") !== null && document.querySelector("[data-question-reason]") !== null && document.querySelector("[data-send-answer]") !== null && document.querySelector("[data-expires]") === null`,
        ),
        true,
      );

      const hangTargets: number[] = [];
      for (const pid of await descendantPids(shell().shell.pid)) {
        try {
          const cmdline = await readCmdline(pid);
          if (
            cmdline.includes(`/apps/${HANG_APP}/`) &&
            !cmdline.includes("app-supervisor")
          ) hangTargets.push(pid);
        } catch { /* 이미 끝남 */ }
      }
      assert(hangTargets.length > 0, "Hang 앱 프로세스가 없다");
      signalPids(hangTargets, "SIGKILL");
      const gone = Date.now() + 15_000;
      while (hangTargets.some((pid) => processAlive(pid))) {
        assert(Date.now() < gone, "Hang 앱이 끝나지 않았다");
        await delay(200);
      }
      assertEquals(await Deno.readTextFile(marker), "once\n");
      // 시작이 기록된 호출은 프로세스 종료를 supervisor가 unknown/process_exited로 남긴다.
      // 그 기록이 core보다 늦으면 재시작 점검이 running을 core_restarted로 닫는다.
      const exitSeen = Date.now() + 15_000;
      let beforeKill = await markKinds();
      while (Date.now() < exitSeen && beforeKill[0]?.status === "running") {
        await delay(200);
        beforeKill = await markKinds();
      }
      assertEquals(beforeKill.length, 1, JSON.stringify(beforeKill));
      const exitReason = beforeKill[0]?.summary.reason;
      if (beforeKill[0]?.status === "running") {
        assertEquals(beforeKill[0]?.summary.effects, undefined);
      } else {
        assertEquals(beforeKill[0]?.status, "unknown");
        assertEquals(exitReason, "process_exited");
        assert(beforeKill[0]?.summary.effects !== "none");
      }

      await openNote();
      const chipsBefore = Number(
        await shell().evaluate(
          `document.querySelectorAll("[data-notification-chip]").length`,
        ),
      );
      const corePid = (await pidsOf("apps/core/main.ts"))[0];
      assert(corePid !== undefined, "core pid를 찾지 못했다");
      // core가 죽으면 worker는 init으로 옮겨 지고 ledger를 잡은 채 남는다. 다시 열기 전에 끝낸다.
      const coreChildren = (await descendantPids(corePid)).filter((pid) =>
        pid !== corePid
      );
      signalPids([corePid], "SIGKILL");
      const coreGone = Date.now() + 30_000;
      while (processAlive(corePid)) {
        assert(Date.now() < coreGone, "core가 끝나지 않았다");
        await delay(200);
      }
      await shell().until(
        `(() => { const el = document.querySelector("[data-save-status]"); const text = el?.textContent ?? ""; return el?.getAttribute("data-save-status") === "stale" && text.includes("Not connected. Your changes are kept here.") && /\\d/.test(text); })()`,
        "core가 죽었는데 문서 단절 안내가 없다",
        20_000,
      );
      assert(
        String(await shell().text("[data-document-body]")).includes(NOTE),
      );
      await shell().until(
        `document.querySelector("[data-dock] [data-stale]") !== null`,
        "도크 단절 줄이 없다",
      );
      assertEquals(
        await shell().evaluate(
          `document.querySelector("[data-external='connection-failed']") === null`,
        ),
        true,
      );
      const chipsAfter = Number(
        await shell().evaluate(
          `document.querySelectorAll("[data-notification-chip]").length`,
        ),
      );
      assert(
        chipsAfter <= chipsBefore,
        `알림이 늘었다: ${chipsBefore} -> ${chipsAfter}`,
      );
      signalPids(coreChildren.filter((pid) => processAlive(pid)), "SIGKILL");
      const childrenGone = Date.now() + 5_000;
      while (coreChildren.some((pid) => processAlive(pid))) {
        assert(Date.now() < childrenGone, "core 자손이 끝나지 않았다");
        await delay(100);
      }

      await closeFlow();
      flow = await openFlowShell({ home, start: `project:${PROJECT}` });
      const unknownDeadline = Date.now() + 60_000;
      let unknown: InvocationRow | undefined;
      while (Date.now() < unknownDeadline) {
        unknown = (await markKinds())[0];
        if (unknown?.status === "unknown") break;
        await delay(400);
      }
      assertEquals(unknown?.status, "unknown", JSON.stringify(unknown));
      if (exitReason === "process_exited") {
        assertEquals(unknown?.summary.reason, "process_exited");
      } else {
        assertEquals(unknown?.summary.reason, "core_restarted");
        assertEquals(unknown?.summary.observation, "result_not_observed");
      }
      assert(unknown?.summary.effects !== "none");
      assertEquals(await Deno.readTextFile(marker), "once\n");
      await openNote();
      assertEquals(
        await shell().evaluate(
          `document.querySelector("[data-save-status]")?.getAttribute("data-save-status") ?? ""`,
        ) === "stale",
        false,
      );
      assertEquals(
        await Deno.readTextFile(`${folder}/note.md`),
        `# note\n\n${NOTE}\n`,
      );

      await openNamedApp("Hang");
      await shell().click('[data-app-bar="app-details"]');
      await shell().until(
        `document.querySelector("[data-ops-panel]") !== null`,
        "앱 상세가 열리지 않았다",
      );
      // Radix 탭은 mousedown으로 고른다. element.click()만으로는 패널이 안 바뀐다.
      await shell().until(
        `document.querySelector('[role=tab][id$="trigger-activity"]') !== null`,
        "활동 탭이 없다",
      );
      const picked = await shell().evaluate(`(() => {
        const tab = document.querySelector('[role=tab][id$="trigger-activity"]');
        if (!tab) return false;
        tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1 }));
        tab.click();
        return true;
      })()`);
      assertEquals(picked, true, "활동 탭이 없다");
      await shell().until(
        `document.querySelector("[data-activity-toggle]") !== null`,
        "활동 탭이 서지 않았다",
      );
      await shell().click("[data-activity-toggle]");
      await shell().until(
        `document.querySelector("[data-activity='unknown'] [data-activity-action='check']") !== null`,
        "결과 모름 확인이 없다",
      );
      const unknownText = await shell().text("[data-activity='unknown']");
      assert(unknownText?.includes("Result unknown"), unknownText ?? "");
      assert(unknownText?.includes("Check the result"), unknownText ?? "");
      assertEquals(unknownText?.includes("Done"), false);
      assertEquals(
        await shell().count(
          "[data-activity='unknown'] [data-activity-action='check']",
        ),
        1,
      );
      await shell().click(
        "[data-activity='unknown'] [data-activity-action='check']",
      );
      await delay(500);
      const checked = await markKinds();
      assertEquals(checked.length, 1);
      assertEquals(checked[0]?.status, "unknown");
      assertEquals(checked[0]?.summary.reason, unknown?.summary.reason);
      if (unknown?.summary.reason === "core_restarted") {
        assertEquals(checked[0]?.summary.observation, "result_not_observed");
      }
      assertEquals(
        await shell().evaluate(
          `document.querySelector("[data-activity='unknown']")?.textContent?.includes("Result unknown") === true && document.querySelector("[data-activity='unknown']")?.textContent?.includes("Done") !== true`,
        ),
        true,
      );
      assertEquals(await Deno.readTextFile(marker), "once\n");

      await openNamedApp("Broken");
      await untilReady(APP);
      const again = await appPage(APP);
      await untilBridge(again);
      const local = await readLocalSettings(again, 30_000);
      assert(
        local.startsWith("ok:") && local.includes("{"),
        local,
      );
    } finally {
      if (stopped !== undefined) signalPids([stopped], "SIGCONT");
      await closeFlow();
      await fixture?.close();
      await removeTree(home);
      await Deno.remove(folder, { recursive: true }).catch(() => undefined);
    }
  },
});

// flow work-offline 4단계. 사람에게는 보이지 않는다. 일시적인 provider 통신 실패만
// 정해진 횟수·대기 안에서 같은 입력으로 retry하고, 불완전한 응답의 tool call은
// 시작하지 않는다. 다른 provider·model로 바꾸지 않는다. 5–7단계, update-lophn,
// install-lophn은 보지 않는다.
const PRIMARY = "pvd_01arz3ndektsv4rrffq69g5fd1";
const OTHER = "pvd_01arz3ndektsv4rrffq69g5fd2";
const ASK = "Keep working offline.";
const AGAIN = "Send one bad request.";
const PARTIAL = "zz-cut-marker";
const GHOST = "zz-ghost-title";
const FINAL = "The local note stays.";
const REQUEST = '[data-mode="request"]';

function httpStep(
  id: string,
  status: number,
  headers: Record<string, string>,
  body: string,
) {
  return {
    id,
    protocol: "messages" as const,
    response: {
      status,
      headers: { "content-type": "application/json", ...headers },
      body,
    },
  };
}

/** max_tokens로 잘린 tool_use. 인자가 완전해도 이 응답의 tool은 시작하면 안 된다. */
function cutTool(id: string) {
  const frames = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    `event: content_block_delta\ndata: ${
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: PARTIAL },
      })
    }\n\n`,
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    `event: content_block_start\ndata: ${
      JSON.stringify({
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_cut",
          name: "document.create",
        },
      })
    }\n\n`,
    `event: content_block_delta\ndata: ${
      JSON.stringify({
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify({
            title: GHOST,
            place: null,
            name: null,
            text: "# Ghost\n",
            media_type: "text/markdown",
          }),
        },
      })
    }\n\n`,
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":8}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
  return {
    id,
    protocol: "messages" as const,
    response: {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      chunks: [{ bytes: frames.join("") }],
    },
  };
}

// provider host가 allow-net에 들어간 새 runtime이 뜰 때까지 기다린다.
async function untilRuntimeAllows(
  rootPid: number,
  ports: readonly string[],
): Promise<void> {
  const needles = ports.map((port) => `127.0.0.1:${port}`);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    for (const pid of await descendantPids(rootPid)) {
      let cmdline = "";
      try {
        cmdline = await readCmdline(pid);
      } catch {
        continue;
      }
      if (needles.every((needle) => cmdline.includes(needle))) return;
    }
    await delay(200);
  }
  throw new Error("runtime이 provider 포트를 아직 열지 않았다");
}

type RetryCall = {
  id: string;
  attempt_kind: string;
  attempt_order: number;
  retry_of: string | null;
  credential_change_of: string | null;
  input: string;
  started_at: string;
  model: { provider: string; name: string };
  outcome: {
    kind: string;
    code?: string | null;
    retry_at?: string | null;
    finish_reason?: string | null;
    http_status?: number | null;
  } | null;
};

Deno.test({
  name:
    "lophn-agent/harness/provider#R10 lophn-agent/harness/provider#R20 lophn-agent/harness/run-loop#R11 lophn-agent/harness/run-loop#R23 flow work-offline 4: 일시적인 provider 통신 실패만 정해진 횟수와 대기 안에서 retry하고 불완전한 응답의 tool call은 시작하지 않으며 다른 provider나 model로 바꾸지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const primary = startFakeProvider({
      script: {
        steps: [
          httpStep(
            "limited",
            429,
            { "retry-after": "3" },
            '{"type":"error","error":{"type":"overloaded_error","message":"busy"}}',
          ),
          httpStep(
            "unavailable",
            503,
            {},
            '{"type":"error","error":{"type":"api_error","message":"unavailable"}}',
          ),
          cutTool("cut"),
          endTurn("done", FINAL),
          httpStep(
            "bad",
            400,
            {},
            '{"type":"error","error":{"type":"invalid_request_error","message":"bad request"}}',
          ),
        ],
      },
      nowMs: () => Date.now(),
      instant: true,
    });
    const other = startFakeProvider({
      script: { steps: [] },
      nowMs: () => Date.now(),
      instant: true,
    });
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await mustCall(flow, {
        kind: "command",
        resource: "providers",
        method: "register",
        body: providerBody(PRIMARY, "Primary", primary.url),
      });
      await mustCall(flow, {
        kind: "command",
        resource: "providers",
        method: "register",
        body: providerBody(OTHER, "Other", other.url),
      });
      let pointed = "";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const defaults = await mustCall(flow, {
          kind: "read",
          resource: "agent-model-defaults",
          method: "read",
          body: {},
        });
        const seq =
          (defaults.defaults as { settings_seq: string }).settings_seq;
        const reply = await flow.call({
          kind: "command",
          resource: "agent-model-defaults",
          method: "change",
          body: commandBody(
            {
              judgment: {
                provider: PRIMARY,
                credentials: [],
                model_name: MODEL,
                reasoning_level: "provider_default",
                options: {},
              },
              organizing: null,
              settings_seq: seq,
            },
            { settings_seq: seq },
          ),
        });
        if (reply.ok) {
          pointed = PRIMARY;
          break;
        }
        pointed = JSON.stringify(reply);
        if (reply.error?.code !== "conflict") break;
      }
      assertEquals(pointed, PRIMARY, pointed);
      // provider 등록은 runtime의 allow-net을 바꾼 뒤 프로세스를 다시 띄운다.
      // 그 전에 보내면 첫 호출이 권한 거부로 끊기고 retry 횟수를 쓴다.
      await untilRuntimeAllows(flow.shell.pid, [
        new URL(primary.url).port,
        new URL(other.url).port,
      ]);

      await flow.until(
        `document.querySelector("[data-dock-toggle]") !== null`,
        "도크 토글이 없다",
      );
      await flow.click("[data-dock-toggle]");
      await flow.until(
        `document.querySelector("[data-dock]") !== null`,
        "대화 도크가 열리지 않았다",
      );
      await flow.until(
        `document.querySelector("[data-new-session]") !== null`,
        "새 세션 단추가 서지 않았다",
      );
      await flow.click("[data-new-session]");
      await flow.until(
        `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
        "입력칸이 서지 않았다",
      );
      await flow.type(INPUT, ASK);
      await flow.until(
        `document.querySelector(${JSON.stringify(SEND)})?.disabled === false`,
        "보내기가 켜지지 않았다",
      );
      await flow.click(SEND);

      const shown = Date.now() + 120_000;
      let answered = false;
      while (Date.now() < shown) {
        const dock = String(
          await flow.evaluate(
            `document.querySelector("[data-dock]")?.innerText ?? ""`,
          ),
        );
        assertEquals(
          await flow.evaluate(
            `document.querySelector("[data-external='connection-failed']") !== null`,
          ),
          false,
          "retry 중 연결 실패가 보인다",
        );
        assertEquals(await flow.count("[data-confirmed-retry]"), 0);
        assertEquals(await flow.count("[data-expires]"), 0);
        assertEquals(dock.includes("didn't respond"), false, dock);
        assertEquals(dock.includes("The next try is confirmed"), false, dock);
        assertEquals(dock.includes(PARTIAL), false, dock);
        assertEquals(dock.includes(GHOST), false, dock);
        assertEquals(dock.includes("cut off"), false, dock);
        if (dock.includes(FINAL)) {
          answered = true;
          break;
        }
        await delay(250);
      }
      assert(answered, "retry 뒤 답이 보이지 않는다");
      assertEquals(other.requests().length, 0, "다른 provider를 불렀다");

      const listed = await mustCall(flow, {
        kind: "read",
        resource: "assignments",
        method: "list",
        body: { role: "lophn" },
      });
      const agent = (listed.assignments as { id: string }[])[0];
      assert(agent !== undefined, "lophn assignment가 없다");
      const runs = await mustCall(flow, {
        kind: "read",
        resource: "runs",
        method: "list",
        body: { assignment: agent.id },
      });
      const ordered = (runs.runs as RunRow[]).slice().sort((left, right) =>
        left.accepted_seq < right.accepted_seq
          ? -1
          : left.accepted_seq > right.accepted_seq
          ? 1
          : 0
      );
      assertEquals(ordered.length, 1, JSON.stringify(ordered));
      const run = ordered[0]!;
      assertEquals(run.outcome?.kind, "completed");
      const calls = await mustCall(flow, {
        kind: "read",
        resource: "model-calls",
        method: "list",
        body: { run: run.id },
      });
      const modelCalls = (calls.calls as RetryCall[]).slice().sort((
        left,
        right,
      ) => left.attempt_order - right.attempt_order);
      assertEquals(modelCalls.length, 4, JSON.stringify(modelCalls));
      assertEquals(
        modelCalls.map((call) => call.attempt_kind),
        ["initial", "retry", "retry", "initial"],
      );
      assertEquals(modelCalls[1]?.retry_of, modelCalls[0]?.id);
      assertEquals(modelCalls[2]?.retry_of, modelCalls[1]?.id);
      assertEquals(modelCalls[3]?.retry_of, null);
      assertEquals(
        new Set(modelCalls.map((call) => call.credential_change_of)),
        new Set([null]),
      );
      assertEquals(modelCalls[0]?.input, modelCalls[1]?.input);
      assertEquals(modelCalls[1]?.input, modelCalls[2]?.input);
      assert(modelCalls[3]?.input !== modelCalls[0]?.input);
      assertEquals(modelCalls[0]?.outcome?.kind, "failed");
      assertEquals(modelCalls[0]?.outcome?.code, "temporary");
      assertEquals(modelCalls[0]?.outcome?.http_status, 429);
      assert(typeof modelCalls[0]?.outcome?.retry_at === "string");
      assertEquals(modelCalls[1]?.outcome?.kind, "failed");
      assertEquals(modelCalls[1]?.outcome?.code, "temporary");
      assertEquals(modelCalls[1]?.outcome?.http_status, 503);
      assertEquals(modelCalls[1]?.outcome?.retry_at ?? null, null);
      assertEquals(modelCalls[2]?.outcome?.kind, "partial");
      assertEquals(modelCalls[2]?.outcome?.finish_reason, "max_tokens");
      assertEquals(modelCalls[3]?.outcome?.kind, "complete");
      for (const call of modelCalls) {
        assertEquals(call.model.provider, PRIMARY);
        assertEquals(call.model.name, MODEL);
      }
      const firstAt = Date.parse(modelCalls[0]!.started_at);
      const secondAt = Date.parse(modelCalls[1]!.started_at);
      const thirdAt = Date.parse(modelCalls[2]!.started_at);
      const retryAt = Date.parse(modelCalls[0]!.outcome!.retry_at!);
      // 타이머가 몇 ms 일찍 깨도 서버 최소 시각과 2초·4초 기본 대기는 구별된다.
      assert(
        secondAt + 100 >= retryAt,
        `서버 시각보다 일찍 retry: ${secondAt - retryAt}`,
      );
      assert(
        secondAt - firstAt >= 2_900,
        `첫째 retry 대기가 3초보다 짧다: ${secondAt - firstAt}`,
      );
      assert(
        thirdAt - secondAt >= 3_900,
        `둘째 retry 대기가 4초보다 짧다: ${thirdAt - secondAt}`,
      );

      const messages = primary.requests().filter((entry) =>
        entry.path === "/messages"
      );
      assertEquals(
        messages.map((entry) => entry.matchedStep),
        ["limited", "unavailable", "cut", "done"],
      );
      const sent = messages.map((entry) => JSON.stringify(entry.body));
      assertEquals(sent[0], sent[1]);
      assertEquals(sent[1], sent[2]);
      assertEquals(sent[0]?.includes(PARTIAL), false);
      assertEquals(sent[2]?.includes("cut off"), false);
      assert(sent[3]?.includes("cut off (max_tokens)"), sent[3]);
      assertEquals(sent[3]?.includes(PARTIAL), false);
      assertEquals(sent[3]?.includes(GHOST), false);
      assertEquals(sent[3]?.includes(`"model":"${MODEL}"`), true);
      for (const body of sent) {
        assertEquals(body?.includes(`"model":"${MODEL}"`), true, body);
        assertEquals(body?.includes(OTHER), false, body);
      }

      const tools = await mustCall(flow, {
        kind: "read",
        resource: "tool-calls",
        method: "list",
        body: { run: run.id },
      });
      const toolCalls = tools.tool_calls as unknown[];
      assertEquals(toolCalls.length, 0, JSON.stringify(toolCalls));
      const documents = await listDocuments(flow);
      assertEquals(
        documents.some((document) => document.title === GHOST),
        false,
        JSON.stringify(documents.map((document) => document.title)),
      );

      // 일시 실패가 아닌 응답은 retry하지 않고, 다른 provider·model로도 가지 않는다.
      await flow.click(REQUEST);
      await flow.type(INPUT, AGAIN);
      await flow.click(SEND);
      const refused = Date.now() + 90_000;
      let failed: RunRow | undefined;
      while (Date.now() < refused) {
        const again = await mustCall(flow, {
          kind: "read",
          resource: "runs",
          method: "list",
          body: { assignment: agent.id },
        });
        failed = (again.runs as RunRow[]).find((row) => row.id !== run.id);
        if (failed?.state === "finished") break;
        await delay(300);
      }
      assertEquals(failed?.state, "finished", JSON.stringify(failed));
      assertEquals(failed?.outcome?.kind, "failed");
      const once = await mustCall(flow, {
        kind: "read",
        resource: "model-calls",
        method: "list",
        body: { run: failed!.id },
      });
      const only = once.calls as RetryCall[];
      assertEquals(only.length, 1, JSON.stringify(only));
      assertEquals(only[0]?.attempt_kind, "initial");
      assertEquals(only[0]?.retry_of, null);
      assertEquals(only[0]?.credential_change_of, null);
      assertEquals(only[0]?.outcome?.kind, "failed");
      assertEquals(only[0]?.outcome?.code, "invalid_request");
      assertEquals(only[0]?.outcome?.http_status, 400);
      assertEquals(only[0]?.model.provider, PRIMARY);
      assertEquals(only[0]?.model.name, MODEL);
      const after = primary.requests().filter((entry) =>
        entry.path === "/messages"
      );
      assertEquals(
        after.map((entry) => entry.matchedStep),
        ["limited", "unavailable", "cut", "done", "bad"],
      );
      assertEquals(other.requests().length, 0);
      primary.assertDone(5);
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await primary.close();
      await other.close();
    }
  },
});

// flow work-offline 5단계. 사람이 지금 필요한 준비나 다시 시도할 행동을 확인한다. 확인된
// 예정 시각이 있는 기다림(서버가 준 retry 시각)과 사람 행동이 필요한 연결 준비(쓸 수 있는
// 연결이 없음)를 구별하고, 모르는 시각은 만들어 보이지 않는다. 6–7단계, update-lophn,
// install-lophn은 보지 않는다.
const READY_PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fe1";
const SOON = "Try the connection.";
const CONFIRMED_AFTER_S = 20;
const SETTINGS_NOTICE = "[data-provider='unusable']";
const FAILED_NOTICE = "[data-external='connection-failed']";
const RATE_LIMITED =
  '{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}';

Deno.test({
  name:
    "lophn-agent/harness/waiting-and-recovery#R6 shell/wording#R10 flow work-offline 5: 확인된 예정 시각이 있는 기다림과 사람 행동이 필요한 연결 준비를 구별하고 모르는 시각은 만들어 보이지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-offline5-folder-" }),
    );
    await Deno.writeTextFile(`${folder}/note.md`, `# note\n\n${NOTE}\n`);
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-offline5-" });
    await Deno.chmod(home, 0o700);
    let flow: FlowShell | undefined;
    const primary = startFakeProvider({
      script: {
        steps: [
          httpStep("first", 429, { "retry-after": "1" }, RATE_LIMITED),
          httpStep("second", 429, { "retry-after": "1" }, RATE_LIMITED),
          httpStep(
            "third",
            429,
            { "retry-after": String(CONFIRMED_AFTER_S) },
            RATE_LIMITED,
          ),
        ],
      },
      nowMs: () => Date.now(),
      instant: true,
    });
    const shell = (): FlowShell => {
      if (flow === undefined) throw new Error("shell이 없다");
      return flow;
    };
    try {
      flow = await openFlowShell({ home });
      await registerTrackedProject(flow, {
        folder,
        name: "alpha",
        title: "Alpha",
      });
      await untilDocuments(flow, ["note"], "노트가 문서가 되지 않았다");
      const noteId = (await documentTitled(flow, "note")).id;
      await flow.close();
      flow = undefined;
      const bundle = await prepareBrokenApp(home, {
        installedHome,
        removeTree,
      });
      seedLedger(home, bundle);
      flow = await openFlowShell({ home, start: `project:${PROJECT}` });

      const untilSpace = (space: string, what: string) =>
        shell().until(
          `document.querySelector("[data-space]")?.getAttribute("data-space") === ${
            JSON.stringify(space)
          }`,
          what,
        );
      const openNote = async () => {
        await shell().until(
          `document.querySelector('[data-document="${noteId}"]') !== null`,
          "sidebar에 노트가 없다",
        );
        await shell().click(`[data-document="${noteId}"]`);
        await shell().until(
          `document.querySelector("[data-document-body]")?.textContent?.includes(${
            JSON.stringify(NOTE)
          })`,
          "노트 본문이 열리지 않았다",
        );
      };
      const openDock = async () => {
        await shell().until(
          `document.querySelector("[data-dock-toggle]") !== null`,
          "도크 토글이 없다",
        );
        if (await shell().count("[data-dock]") === 0) {
          await shell().click("[data-dock-toggle]");
        }
        await shell().until(
          `document.querySelector("[data-dock]") !== null`,
          "대화 도크가 열리지 않았다",
        );
      };
      // 준비가 필요한 안내: 행동은 설정으로 가는 단추 하나, 시각·세는 숫자·기다림 표시는 없다.
      const assertPreparation = async (where: string) => {
        await shell().until(
          `document.querySelector(${JSON.stringify(SETTINGS_NOTICE)}) !== null`,
          `${where}: 연결 준비 안내가 없다`,
          30_000,
        );
        const text = String(await shell().text(SETTINGS_NOTICE));
        assert(text.includes("can't reach its account"), text);
        assertEquals(await shell().count(`${SETTINGS_NOTICE} button`), 1);
        assertEquals(/\d/.test(text), false, text);
        assertEquals(text.includes("next try"), false, text);
        assertEquals(await shell().count("[data-confirmed-retry]"), 0);
        assertEquals(await shell().count("[data-expires]"), 0);
        assertEquals(await shell().count("[data-external]"), 0);
      };

      // 쓸 수 있는 연결이 없다. 사람 행동(설정)이 필요하고 기다리면 풀리는 일이 아니다.
      await untilSpace("project", "프로젝트 작업대가 서지 않았다");
      await openNote();
      await openDock();
      await assertPreparation("project-workspace");
      assert(
        String(await shell().text("[data-document-body]")).includes(NOTE),
        "연결 준비 안내가 로컬 문서를 가렸다",
      );

      await shell().click("[data-launcher-back]");
      await untilSpace("launcher", "launcher로 돌아오지 않았다");
      await shell().click("[data-entry=lophn]");
      await untilSpace("lophn", "lophn 공간이 서지 않았다");
      await shell().click("[data-screen=apps]");
      await shell().until(
        `document.querySelector("[data-app-row] [data-action=open]") !== null`,
        "앱 목록이 서지 않았다",
      );
      await shell().click("[data-app-row] [data-action=open]");
      await untilSpace("app", "앱 공간이 서지 않았다");
      await openDock();
      await assertPreparation("app-space");

      // 연결을 준비한다. 서버가 준 시각이 있는 429만 그 시각을 확인된 다음 시도로 보인다.
      await mustCall(shell(), {
        kind: "command",
        resource: "providers",
        method: "register",
        body: providerBody(READY_PROVIDER, "Ready", primary.url),
      });
      let pointed = "";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const defaults = await mustCall(shell(), {
          kind: "read",
          resource: "agent-model-defaults",
          method: "read",
          body: {},
        });
        const seq =
          (defaults.defaults as { settings_seq: string }).settings_seq;
        const reply = await shell().call({
          kind: "command",
          resource: "agent-model-defaults",
          method: "change",
          body: commandBody(
            {
              judgment: {
                provider: READY_PROVIDER,
                credentials: [],
                model_name: MODEL,
                reasoning_level: "provider_default",
                options: {},
              },
              organizing: null,
              settings_seq: seq,
            },
            { settings_seq: seq },
          ),
        });
        if (reply.ok) {
          pointed = READY_PROVIDER;
          break;
        }
        pointed = JSON.stringify(reply);
        if (reply.error?.code !== "conflict") break;
      }
      assertEquals(pointed, READY_PROVIDER, pointed);
      await untilRuntimeAllows(shell().shell.pid, [
        new URL(primary.url).port,
      ]);

      await shell().click("[data-launcher-back]");
      await untilSpace("launcher", "launcher로 돌아오지 않았다");
      const card =
        `[data-card="project"][data-project="${PROJECT}"] button:not([data-details-toggle])`;
      await shell().until(
        `document.querySelector(${JSON.stringify(card)}) !== null`,
        "프로젝트 카드가 없다",
      );
      await shell().click(card);
      await untilSpace("project", "프로젝트 작업대로 돌아오지 않았다");
      await openNote();
      await openDock();
      await shell().until(
        `document.querySelector("[data-new-session]") !== null || document.querySelector(${
          JSON.stringify(INPUT)
        }) !== null`,
        "도크가 서지 않았다",
      );
      if (await shell().count(INPUT) === 0) {
        await shell().click("[data-new-session]");
      }
      await shell().until(
        `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
        "입력칸이 서지 않았다",
      );
      await shell().type(INPUT, SOON);
      await shell().until(
        `document.querySelector(${JSON.stringify(SEND)})?.disabled === false`,
        "보내기가 켜지지 않았다",
      );
      await shell().click(SEND);

      // retry 대기 중에는 확인된 시각이 안 보이고, 정해진 횟수를 다 쓴 뒤에야 연결 실패와
      // 그 시각이 함께 선다.
      const shown = Date.now() + 120_000;
      let failed = false;
      while (Date.now() < shown) {
        const notice = await shell().count(FAILED_NOTICE);
        const confirmed = await shell().count("[data-confirmed-retry]");
        assertEquals(confirmed, notice, "시각이 실패 안내보다 먼저 보인다");
        if (notice === 1) {
          failed = true;
          break;
        }
        await delay(250);
      }
      assert(failed, "연결 실패 안내가 서지 않았다");
      assertEquals(await shell().count(SETTINGS_NOTICE), 0);

      const listed = await mustCall(shell(), {
        kind: "read",
        resource: "assignments",
        method: "list",
        body: { role: "lophn" },
      });
      const agent = (listed.assignments as { id: string }[])[0];
      assert(agent !== undefined, "lophn assignment가 없다");
      const runs = await mustCall(shell(), {
        kind: "read",
        resource: "runs",
        method: "list",
        body: { assignment: agent.id },
      });
      const run = newest(runs.runs as RunRow[]);
      assert(run !== null, "run이 없다");
      assertEquals(run.state, "finished");
      const calls = await mustCall(shell(), {
        kind: "read",
        resource: "model-calls",
        method: "list",
        body: { run: run.id },
      });
      const ordered = (calls.calls as RetryCall[]).slice().sort((
        left,
        right,
      ) => left.attempt_order - right.attempt_order);
      assertEquals(ordered.length, 3, JSON.stringify(ordered));
      const last = ordered[2]!;
      assertEquals(last.outcome?.kind, "failed");
      assertEquals(last.outcome?.code, "temporary");
      assertEquals(last.outcome?.http_status, 429);
      const retryAt = last.outcome?.retry_at;
      assert(typeof retryAt === "string", JSON.stringify(last.outcome));
      // 시각은 서버가 준 retry-after에서 왔다. 화면이 따로 정하지 않는다.
      const span = Date.parse(retryAt) - Date.parse(last.started_at);
      assert(
        span >= CONFIRMED_AFTER_S * 1000 - 1_000 &&
          span <= (CONFIRMED_AFTER_S + 10) * 1000,
        `retry 시각이 서버 지시에서 벗어났다: ${span}`,
      );

      const confirmed = await shell().evaluate(
        `document.querySelector("[data-confirmed-retry]")?.getAttribute("data-confirmed-retry") ?? ""`,
      );
      assertEquals(confirmed, retryAt);
      const when = String(
        await shell().evaluate(
          `new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(${
            JSON.stringify(retryAt)
          }))`,
        ),
      );
      const failedText = String(await shell().text(FAILED_NOTICE));
      assert(failedText.includes("didn't respond"), failedText);
      assert(
        failedText.includes(`The next try is confirmed for ${when}.`),
        failedText,
      );
      assertEquals(
        /\b(seconds?|minutes?|left|remaining|countdown)\b/i.test(failedText),
        false,
        failedText,
      );
      // 사람 행동은 연결을 다시 확인하는 단추 하나다. 예정 시각은 세지 않고 그대로 있다.
      assertEquals(await shell().count(`${FAILED_NOTICE} button`), 1);
      assertEquals(await shell().count("[data-expires]"), 0);
      await delay(2_000);
      assertEquals(String(await shell().text(FAILED_NOTICE)), failedText);
      assert(
        String(await shell().text("[data-document-body]")).includes(NOTE),
        "연결 실패 안내가 로컬 문서를 가렸다",
      );
      assertEquals(
        primary.requests().filter((entry) => entry.path === "/messages").length,
        3,
        "확인된 시각이 오기 전후에 lophn이 더 보냈다",
      );
      await shell().click(`${FAILED_NOTICE} button`);
      assertEquals(await shell().evaluate(`location.hash`), "#settings");
      primary.assertDone(3);
    } finally {
      await flow?.close();
      await primary.close();
      await removeTree(home);
      await Deno.remove(folder, { recursive: true }).catch(() => undefined);
    }
  },
});

// flow work-offline 6단계. 사람에게는 보이지 않는다. 연결이 돌아오면(core를 다시 띄우고 provider가
// 다시 답한다) lophn이 ledger의 확정 결과와 미완료 상태를 먼저 조회한다. 이미 확인된 call은 반복하지
// 않고, 결과를 모르는 쓰기는 결과 조회나 중복 효과 없음이 확인되기 전 다시 부르지 않는다.
// 7단계, update-lophn, install-lophn은 보지 않는다.
// - 확정된 읽기 뒤 다음 판단이 붙들린 채 core가 죽으면 같은 run이 그 판단 하나만 다시 부르고 끝난다.
// - 앱 쓰기가 시작만 되고 결과가 없으면 다시 보내지 않고, 뒤 call과 뒤 판단도 시작하지 않으며
//   불명확 효과와 남은 일을 구별해 끝낸다.
const RECOVER_PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fe2";
const RECOVER_GRANT = "grt_01h455vb4pex5v6nkc6gd5fdw2";
const RECOVER_APPROVAL = "apr_01h455vb4pex5v6nkc6gd5fdw2";
const RECOVER_GATE = "hold-recover";
const RECOVER_ASK = "Check what is stored.";
const RECOVER_WRITE = "Mark the kind once.";
const RECOVER_DONE = "The stored facts were kept.";

type ToolCallRow = {
  response_key: string;
  response_order: number;
  tool: string;
  state: string;
  attempt: number;
  outcome: { kind: string } | null;
};

type FinishedRun = RunRow & {
  outcome: { kind: string; reason?: string } | null;
};

/** harness의 appToolName과 같다. harness가 이름을 export하지 않아 테스트가 같은 지문을 만든다. */
async function recoverToolName(app: string, command: string): Promise<string> {
  const appHash = (await fingerprint(app)).slice(0, 8);
  const commandHash = (await fingerprint(command)).slice(0, 6);
  const readable = command.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
  return `app_${appHash}_${readable}_${commandHash}`;
}

function listProjects(id: string) {
  return {
    id,
    protocol: "messages" as const,
    reply: {
      text: "I will look at what is stored.",
      toolCalls: [{ id: `${id}-list`, name: "project.list", arguments: "{}" }],
      usage: { input: 20, output: 8 },
      stop: "tool_calls" as const,
    },
  };
}

/** 읽기, 앱 쓰기(돌아오지 않는다), 또 읽기를 한 응답에 낸다. */
function writeThenRead(id: string, writeTool: string) {
  return {
    id,
    protocol: "messages" as const,
    reply: {
      text: "I will read, mark the kind, and read again.",
      toolCalls: [
        { id: "toolu_before", name: "project.list", arguments: "{}" },
        {
          id: "toolu_write",
          name: writeTool,
          arguments: JSON.stringify({ kind: "once", view_session: "view-1" }),
        },
        { id: "toolu_after", name: "project.list", arguments: "{}" },
      ],
      usage: { input: 20, output: 8 },
      stop: "tool_calls" as const,
    },
  };
}

/** 앱 쓰기가 돌아오지 않는 Hang 앱과 lophn의 command grant를 core를 멈춘 동안 심는다. */
async function seedRecoverApp(home: string): Promise<void> {
  const installed = await installedHome();
  const parent = await Deno.makeTempDir({ prefix: "lophn-e2e-offline6-src-" });
  try {
    const source = await Deno.readTextFile(`${FIXTURE}/src/commands.ts.tmpl`);
    assertEquals(source.split(MARK_KIND_BEFORE).length - 1, 1);
    const patched = source.replace(MARK_KIND_BEFORE, MARK_KIND_AFTER);
    const dir = await materialize(parent, "hang", installed.sdkRoot, patched);
    const hang = await preparedBundle(
      home,
      HANG_APP,
      dir,
      await commitSource(dir),
      installed.sdkRoot,
    );
    seedHang(home, hang);
  } finally {
    await removeTree(parent);
    await installed.dispose();
  }
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    db.prepare(
      `INSERT INTO grants (id, app, kind, scope, approval, status, created_by, created_at, revoked_by, revoked_at)
       VALUES (?, ?, 'agent.commands', ?, ?, 'active', 'user', ?, NULL, NULL)`,
    ).run(
      RECOVER_GRANT,
      HANG_APP,
      JSON.stringify({ kind: "agent.commands", commands: ["mark_kind"] }),
      RECOVER_APPROVAL,
      "2026-10-02T00:00:00.000Z",
    );
  } finally {
    db.close();
  }
}

Deno.test({
  name:
    "lophn-agent/harness/waiting-and-recovery#R8 lophn-agent/harness/waiting-and-recovery#R9 lophn-agent/harness/waiting-and-recovery#R10 apps/invocations#R12 flow work-offline 6: 연결이 돌아오면 확정 결과를 먼저 조회해 이어 가고 결과를 모르는 쓰기는 다시 보내지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-offline6-" });
    await Deno.chmod(home, 0o700);
    let flow: FlowShell | undefined;
    const writeTool = await recoverToolName(HANG_APP, "mark_kind");
    const provider = startFakeProvider({
      script: {
        steps: [
          listProjects("read"),
          heldAnswer("held", RECOVER_GATE, "Holding the answer."),
          endTurn("done", RECOVER_DONE),
          writeThenRead("write", writeTool),
          endTurn("never", "This judgment must not start."),
        ],
      },
      nowMs: () => Date.now(),
      instant: true,
    });
    const shell = (): FlowShell => {
      if (flow === undefined) throw new Error("shell이 없다");
      return flow;
    };
    try {
      flow = await openFlowShell({ home });
      await flow.close();
      flow = undefined;
      await seedRecoverApp(home);
      flow = await openFlowShell({ home, start: "lophn" });

      await mustCall(shell(), {
        kind: "command",
        resource: "providers",
        method: "register",
        body: providerBody(RECOVER_PROVIDER, "Recover", provider.url),
      });
      let pointed = "";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const defaults = await mustCall(shell(), {
          kind: "read",
          resource: "agent-model-defaults",
          method: "read",
          body: {},
        });
        const seq =
          (defaults.defaults as { settings_seq: string }).settings_seq;
        const reply = await shell().call({
          kind: "command",
          resource: "agent-model-defaults",
          method: "change",
          body: commandBody(
            {
              judgment: {
                provider: RECOVER_PROVIDER,
                credentials: [],
                model_name: MODEL,
                reasoning_level: "provider_default",
                options: {},
              },
              organizing: null,
              settings_seq: seq,
            },
            { settings_seq: seq },
          ),
        });
        if (reply.ok) {
          pointed = RECOVER_PROVIDER;
          break;
        }
        pointed = JSON.stringify(reply);
        if (reply.error?.code !== "conflict") break;
      }
      assertEquals(pointed, RECOVER_PROVIDER, pointed);
      await untilRuntimeAllows(shell().shell.pid, [
        new URL(provider.url).port,
      ]);

      const listed = await mustCall(shell(), {
        kind: "read",
        resource: "assignments",
        method: "list",
        body: { role: "lophn" },
      });
      const agent = (listed.assignments as { id: string }[])[0];
      assert(agent !== undefined, "lophn assignment가 없다");
      const runsOf = async (): Promise<FinishedRun[]> =>
        (await mustCall(shell(), {
          kind: "read",
          resource: "runs",
          method: "list",
          body: { assignment: agent.id },
        })).runs as FinishedRun[];
      const toolCallsOf = async (run: string): Promise<ToolCallRow[]> =>
        ((await mustCall(shell(), {
          kind: "read",
          resource: "tool-calls",
          method: "list",
          body: { run },
        })).tool_calls as ToolCallRow[]).slice().sort((left, right) =>
          left.response_order - right.response_order
        );
      const markKinds = async (): Promise<InvocationRow[]> =>
        ((await mustCall(shell(), {
          kind: "read",
          resource: "invocations",
          method: "list",
          body: { app: HANG_APP, limit: 50 },
        })).invocations as InvocationRow[]).filter((row) =>
          row.operation.kind === "command" &&
          row.operation.command === "mark_kind"
        );
      const untilTrue = async (
        what: string,
        check: () => Promise<boolean>,
        timeoutMs = 120_000,
      ) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (await check()) return;
          await delay(300);
        }
        throw new Error(
          `${what} runs=${
            JSON.stringify(await runsOf())
          } requests=${provider.requests().length}`,
        );
      };
      const untilFinished = async (id: string): Promise<FinishedRun> => {
        let found: FinishedRun | undefined;
        await untilTrue("run이 끝나지 않았다", async () => {
          found = (await runsOf()).find((row) => row.id === id);
          return found?.state === "finished";
        });
        return found!;
      };
      const untilReady = async () => {
        await untilTrue("Hang 앱이 쓰기 준비가 되지 않았다", async () => {
          const got = await mustCall(shell(), {
            kind: "read",
            resource: "apps",
            method: "runtime",
            body: { app: HANG_APP },
          });
          const observation = got.observation as {
            ready?: boolean;
            mode?: string;
            accepting?: boolean;
          } | null;
          return observation?.ready === true && observation.mode === "live" &&
            observation.accepting === true;
        });
      };
      const openDock = async () => {
        await shell().until(
          `document.querySelector("[data-dock-toggle]") !== null`,
          "도크 토글이 없다",
        );
        if (await shell().count("[data-dock]") === 0) {
          await shell().click("[data-dock-toggle]");
        }
        await shell().until(
          `document.querySelector("[data-dock]") !== null`,
          "대화 도크가 열리지 않았다",
        );
        await shell().until(
          `document.querySelector("[data-new-session]") !== null || document.querySelector(${
            JSON.stringify(INPUT)
          }) !== null`,
          "도크가 서지 않았다",
        );
        if (await shell().count(INPUT) === 0) {
          await shell().click("[data-new-session]");
        }
        await shell().until(
          `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
          "입력칸이 서지 않았다",
        );
      };
      const sendText = async (text: string) => {
        await openDock();
        await shell().type(INPUT, text);
        await shell().until(
          `document.querySelector(${JSON.stringify(SEND)})?.disabled === false`,
          "보내기가 켜지지 않았다",
        );
        await shell().click(SEND);
      };
      // core를 죽인다(연결이 끊긴다). 그 자손도 정리해 다시 열 때 ledger를 잡고 있지 않게 한다.
      const killCore = async () => {
        let corePid: number | undefined;
        for (const pid of await descendantPids(shell().shell.pid)) {
          try {
            if ((await readCmdline(pid)).includes("apps/core/main.ts")) {
              corePid = pid;
              break;
            }
          } catch { /* 이미 끝남 */ }
        }
        assert(corePid !== undefined, "core pid를 찾지 못했다");
        const children = (await descendantPids(corePid)).filter((pid) =>
          pid !== corePid
        );
        signalPids([corePid], "SIGKILL");
        const gone = Date.now() + 30_000;
        while (processAlive(corePid)) {
          assert(Date.now() < gone, "core가 끝나지 않았다");
          await delay(200);
        }
        signalPids(children.filter((pid) => processAlive(pid)), "SIGKILL");
        const childrenGone = Date.now() + 5_000;
        while (children.some((pid) => processAlive(pid))) {
          assert(Date.now() < childrenGone, "core 자손이 끝나지 않았다");
          await delay(100);
        }
      };
      // 연결이 돌아온다: 같은 데이터 root로 core를 다시 띄운다.
      const reconnect = async () => {
        const current = flow;
        flow = undefined;
        await current?.close();
        flow = await openFlowShell({ home, start: "lophn" });
        await untilRuntimeAllows(shell().shell.pid, [
          new URL(provider.url).port,
        ]);
      };

      // 확인 창은 단추가 있는 창을 매번 다시 찾아 누른다. 미리보기만으로는 결정이 아니다.
      const inDecisionWindow = (decision: string, expression: string) =>
        shell().shell.mainEvaluate(`(async () => {
          const contents = electron.webContents.getAllWebContents().filter((c) =>
            !c.isDestroyed() && c.getURL().startsWith("lophn-shell://confirmation/")
          );
          for (const contentsItem of contents) {
            const open = await contentsItem.executeJavaScript(${
          JSON.stringify(
            `document.querySelector("[data-decision='${decision}']") !== null`,
          )
        });
            if (open) {
              return await contentsItem.executeJavaScript(${
          JSON.stringify(expression)
        });
            }
          }
          return null;
        })()`);
      const grantPending = async () => {
        await shell().click('[data-screen="things-to-confirm"]');
        await shell().until(
          `document.querySelector("[data-next='approval']:not([disabled])") !== null`,
          "기다리는 결정이 없다",
          60_000,
        );
        await shell().click("[data-next='approval']");
        await shell().until(
          `document.querySelector("[data-detail] [data-review]") !== null`,
          "결정 상세에 확인 단추가 없다",
        );
        await shell().click("[data-detail] [data-review]");
        await untilTrue("확인 창에 결정 단추가 없다", async () => {
          try {
            return await inDecisionWindow(
              "grant_approval_request",
              `document.querySelector("[data-decision='grant_approval_request']") !== null`,
            ) === true;
          } catch {
            return false;
          }
        }, 30_000);
        const shown = String(
          await inDecisionWindow(
            "grant_approval_request",
            `document.querySelector("[data-layout='confirmation']")?.innerText ?? ""`,
          ),
        );
        assert(
          shown.includes("mark_kind") && shown.includes(HANG_APP),
          `확인 창에 앱·command가 없다: ${shown.slice(0, 400)}`,
        );
        await inDecisionWindow(
          "grant_approval_request",
          `document.querySelector("[data-decision='grant_approval_request']").click()`,
        );
      };

      await untilReady();
      const hangMarker = `${home}/apps/${HANG_APP}/data/hang-once`;

      await t.step(
        "lophn-agent/harness/waiting-and-recovery#R8 lophn-agent/harness/waiting-and-recovery#R9: 확정된 읽기 뒤 다음 판단이 붙들린 채 연결이 끊겼다 돌아오면 같은 run이 그 판단 하나만 다시 부르고 끝난다",
        async () => {
          await sendText(RECOVER_ASK);
          let run = "";
          await untilTrue(
            "읽기가 확정되고 다음 판단이 붙들리지 않았다",
            async () => {
              const runs = await runsOf();
              const current = newest(runs);
              if (current === null || provider.requests().length < 2) {
                return false;
              }
              const calls = await toolCallsOf(current.id);
              if (calls.length === 1 && calls[0]!.outcome?.kind === "success") {
                run = current.id;
                return true;
              }
              return false;
            },
          );
          assertEquals(
            (await runsOf()).find((row) => row.id === run)?.state,
            "running",
          );
          await killCore();
          await reconnect();

          const finished = await untilFinished(run);
          assertEquals(
            finished.outcome?.kind,
            "completed",
            JSON.stringify(finished),
          );
          // 같은 run이다. 이어 가기가 run을 새로 만들지 않았다.
          assertEquals((await runsOf()).length, 1);
          // 확정된 읽기는 다시 실행하지 않았다: tool call은 key마다 한 번이다.
          const calls = await toolCallsOf(run);
          assertEquals(
            calls.map((
              row,
            ) => [row.response_key, row.attempt, row.outcome?.kind]),
            [["read-list", 0, "success"]],
          );
          // 붙들려 있던 판단 하나만 다시 불렀다: 읽기 판단 1, 붙든 판단 1, 다시 부른 판단 1.
          assertEquals(provider.requests().length, 3);
          // 다시 부른 판단은 저장된 읽기 결과를 이력으로 받았다.
          const resumed = JSON.stringify(provider.requests()[2]!.body);
          assert(
            resumed.includes("read-list"),
            "다시 부른 판단에 읽기 이력이 없다",
          );
          assertEquals(
            await Deno.stat(hangMarker).then(() => true, () => false),
            false,
          );
        },
      );

      await t.step(
        "lophn-agent/harness/waiting-and-recovery#R10 apps/invocations#R12: 앱 쓰기가 시작만 되고 결과가 없으면 연결이 돌아와도 다시 보내지 않고 뒤 call과 뒤 판단 없이 불명확 효과와 남은 일을 구별해 끝낸다",
        async () => {
          const before = provider.requests().length;
          await sendText(RECOVER_WRITE);
          // 되돌리기를 선언하지 않은 쓰기는 사람이 허락해야 시작한다.
          await untilTrue(
            "허락을 기다리는 run이 없다",
            async () => newest(await runsOf())?.state === "waiting_user",
          );
          await grantPending();
          let run = "";
          await untilTrue("앱 쓰기가 시작되지 않았다", async () => {
            const current = newest(await runsOf());
            if (current === null || current.state !== "running") return false;
            const calls = await toolCallsOf(current.id);
            const write = calls.find((row) =>
              row.response_key === "toolu_write"
            );
            const marks = await markKinds();
            const marked = await Deno.readTextFile(hangMarker).then(
              (text) => text,
              () => "",
            );
            if (
              write?.state === "started" && marks.length === 1 &&
              marks[0]?.status === "running" && marked === "once\n"
            ) {
              run = current.id;
              return true;
            }
            return false;
          });
          assertEquals(provider.requests().length, before + 1);
          await killCore();
          await reconnect();

          const finished = await untilFinished(run);
          assertEquals(
            finished.outcome?.kind,
            "failed",
            JSON.stringify(finished),
          );
          assertEquals(finished.outcome?.reason, "effect_unknown");
          // 앞 읽기는 확정, 쓰기는 불명확, 뒤 call은 미실행으로 따로 남는다.
          const calls = await toolCallsOf(run);
          assertEquals(
            calls.map((
              row,
            ) => [row.response_key, row.attempt, row.outcome?.kind]),
            [
              ["toolu_before", 0, "success"],
              ["toolu_write", 0, "uncertain"],
              ["toolu_after", 0, "not_executed"],
            ],
          );
          // 쓰기는 다시 보내지 않았다: invocation은 하나이고 성공이나 실패로 추측하지 않는다.
          const marks = await markKinds();
          assertEquals(marks.length, 1, JSON.stringify(marks));
          assertEquals(marks[0]?.status, "unknown", JSON.stringify(marks));
          assertEquals(await Deno.readTextFile(hangMarker), "once\n");
          // 뒤 판단은 시작하지 않았다. 새 run도 없다.
          assertEquals(provider.requests().length, before + 1);
          assertEquals((await runsOf()).length, 2);
        },
      );
    } finally {
      await flow?.close();
      await provider.close();
      await removeTree(home);
    }
  },
});
