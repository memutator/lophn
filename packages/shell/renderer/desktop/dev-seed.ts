// 개발 확인 전용. LOPHN_DEV_SEED가 있을 때만 프로젝트 작업대를 가짜 통로로 연다.
// 제품 경로에는 없고 core를 부르지 않는다. e2e·check는 이 변수를 주지 않는다.
import {
  EXPERIMENT_NAMES,
  experimentPath,
} from "../workspace/contexts/fake-source.ts";
import type { FileRow, WorkspaceSource } from "../workspace/source.ts";
import type { EditorDeps } from "../editor/document-view.tsx";
import type { BodyState, DocumentInfo } from "../editor/source.ts";
import { readingWidthStore } from "../editor/reading-width.ts";

/**
 * 시드 프로젝트 id. 실제 project id 모양이라 e2e가 같은 id로 core에 프로젝트를
 * 만들면 터미널 열기가 그 등록 폴더를 읽는다.
 */
export const DEV_SEED_PROJECT = "prj_01k6devseed000000000000000";

export interface DevSeed {
  readonly project: string;
  readonly source: WorkspaceSource;
  /** 문서 탭 통로. 메뉴는 창의 overlay를 그대로 쓴다. */
  readonly editor: Omit<EditorDeps, "menu">;
}

const NOTES = [
  "# Release notes",
  "",
  "The editor keeps **reading** and *editing* in the same column, so the first block stays put.",
  "",
  "## What changed",
  "",
  "- Reading width follows the document menu",
  "- [x] Find line and link picker",
  "- [ ] Save flow",
  "",
  "> Quotes use the same 2px bar in both modes.",
  "",
  "```",
  "deno task check",
  "```",
  "",
  "## Next",
  "",
  "See [plan](lophn/plan) for the order of work.",
].join("\n");

const SEED_DOCUMENTS: Record<string, { info: DocumentInfo; text: string }> = {
  doc_notes: {
    info: {
      id: "doc_notes",
      title: "Release notes",
      fileName: "notes.md",
      path: "docs/notes.md",
      version: "ver_notes",
      versionNumber: 3,
      savedAt: Date.now() - 2 * 60 * 60 * 1000,
    },
    text: NOTES,
  },
  doc_plan: {
    info: {
      id: "doc_plan",
      title: "Plan",
      fileName: "plan.md",
      path: "docs/plan.md",
      version: "ver_plan",
      versionNumber: 1,
      savedAt: Date.now() - 26 * 60 * 60 * 1000,
    },
    text: "# Plan\n\nOne step at a time.",
  },
};

// mock 모드의 context 화면 예시(검색 결과·Overview 예시·위반)가 가리키는 문서. 문서 목록에는 오르지
// 않고 경로로만 찾아 열린다(shell/workspace#R26).
const CONTEXT_FOLDER = "/work/lophn";
const CONTEXT_DOCUMENTS: Record<string, { info: DocumentInfo; text: string }> =
  Object.fromEntries([
    ...Object.entries(EXPERIMENT_NAMES).map(([id, name]) => ({
      id,
      path: experimentPath(id),
      title: `${id} ${name}`,
    })),
    ...Array.from({ length: 14 }, (_, index) => {
      const id = `F-${String(index + 1).padStart(3, "0")}`;
      return { id, path: `loop/findings/${id}.md`, title: `${id} finding` };
    }),
    {
      id: "shared-overview",
      path: "docs/shared-overview.md",
      title: "Shared overview",
    },
  ].map((item) => {
    const id = `doc_ctx_${item.id}`;
    return [id, {
      info: {
        id,
        title: item.title,
        fileName: item.path.split("/").at(-1)!,
        path: item.path,
        version: `ver_${id}`,
        versionNumber: 1,
        savedAt: Date.now() - 5 * 60 * 60 * 1000,
      },
      text:
        `# ${item.title}\n\nAn example document the context screens link to.`,
    }];
  }));

/** mock 모드 작업대의 파일 목록에 더하는, context 화면 예시 문서의 파일 행. */
export function contextExampleFiles(): readonly FileRow[] {
  return Object.values(CONTEXT_DOCUMENTS).map((seeded) => ({
    folder: CONTEXT_FOLDER,
    path: seeded.info.path!,
    document: seeded.info.id,
    title: seeded.info.title,
  }));
}

/** mock 모드의 [Instructions] 편집기가 여는 문서. 문서 목록에는 오르지 않는다. */
export const SEED_INSTRUCTIONS_DOCUMENT = "doc_instructions";

const INSTRUCTIONS_SEED = {
  info: {
    id: SEED_INSTRUCTIONS_DOCUMENT,
    title: "Instructions",
    fileName: "AGENTS.md",
    path: "AGENTS.md",
    version: "ver_instructions",
    versionNumber: 1,
    savedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
  },
  text:
    "# Instructions\n\nKeep answers short and name the document you changed.",
};

function seededDocument(id: string) {
  return SEED_DOCUMENTS[id] ?? CONTEXT_DOCUMENTS[id] ??
    (id === SEED_INSTRUCTIONS_DOCUMENT ? INSTRUCTIONS_SEED : undefined);
}

function seededEditor(): Omit<EditorDeps, "menu"> {
  let width: unknown = null;
  let revision = 0;
  return {
    source: {
      document: (id) => {
        const seeded = seededDocument(id);
        return Promise.resolve(
          seeded
            ? { ok: true, value: seeded.info }
            : { ok: false, code: "not_found" },
        );
      },
      body: (id, _version, onPage) => {
        const seeded = seededDocument(id);
        const state: BodyState = seeded
          ? { kind: "text", text: seeded.text, complete: true }
          : { kind: "failed" };
        onPage(state);
        return Promise.resolve(state);
      },
      outline: (id) => {
        const seeded = seededDocument(id);
        if (!seeded) return Promise.resolve({ ok: false, code: "not_found" });
        const sections = seeded.text.split("\n").flatMap((line, index) => {
          const match = /^(#{1,6}) (.+)$/.exec(line);
          return match
            ? [{
              key: match[2]!,
              title: match[2]!,
              level: match[1]!.length,
              line: index + 1,
            }]
            : [];
        });
        return Promise.resolve({ ok: true, value: sections });
      },
      linkTargets: () =>
        Promise.resolve({
          ok: true,
          value: Object.values(SEED_DOCUMENTS).map((seeded) => ({
            folder: "/work/lophn",
            address: `lophn/${seeded.info.fileName.replace(/\.md$/, "")}`,
            title: seeded.info.title,
            name: seeded.info.fileName.replace(/\.md$/, ""),
          })),
        }),
      resolveLink: (href) =>
        Promise.resolve({
          ok: true,
          value: Object.values(SEED_DOCUMENTS).find((seeded) =>
            `lophn/${seeded.info.fileName.replace(/\.md$/, "")}` === href
          )?.info.id ?? null,
        }),
    },
    readingWidth: readingWidthStore({
      get: () => Promise.resolve({ value: width, revision }),
      apply: (next) => {
        width = next;
        revision += 1;
        return Promise.resolve({ ok: true, revision });
      },
    }),
  };
}

const SEEDED: WorkspaceSource = {
  project: () =>
    Promise.resolve({
      ok: true,
      value: {
        id: DEV_SEED_PROJECT,
        title: "lophn",
        folders: [{ path: "/work/lophn" }],
      },
    }),
  documents: () =>
    Promise.resolve({
      ok: true,
      value: [
        { id: "doc_notes", title: "notes" },
        { id: "doc_plan", title: "plan" },
      ],
    }),
  files: () =>
    Promise.resolve({
      ok: true,
      value: Object.values(SEED_DOCUMENTS).map((seeded) => ({
        folder: "/work/lophn",
        path: seeded.info.path ?? seeded.info.fileName,
        document: seeded.info.id,
        title: seeded.info.fileName.replace(/\.md$/, ""),
      })),
    }),
  readLayout: () =>
    Promise.resolve({
      ok: true,
      available: true,
      layout: {
        panes: [
          {
            tabs: [
              { key: "doc_notes", kind: "document_editor", title: "notes" },
              { key: "doc_plan", kind: "document_editor", title: "plan" },
            ],
            selected_tab: "doc_notes",
          },
          {
            tabs: [{ key: "term_1", kind: "terminal", title: "shell" }],
            selected_tab: "term_1",
          },
        ],
        split_ratio: 0.5,
        focused_pane: 0,
        information_panel: { open: false, tab: "info" },
      },
    }),
  saveLayout: () => Promise.resolve({ ok: true }),
};

/** 시드 작업대와 문서 탭 통로. mock 모드도 같은 작업대를 쓴다. */
export function seedWorkbench(): DevSeed {
  return {
    project: DEV_SEED_PROJECT,
    source: SEEDED,
    editor: seededEditor(),
  };
}

/** 주소에 dev-seed가 있으면 시드 작업대를, 없으면 null을 돌려준다. */
export function devSeed(
  search: string = globalThis.location?.search ?? "",
): DevSeed | null {
  if (!new URLSearchParams(search).has("dev-seed")) return null;
  return seedWorkbench();
}
