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
