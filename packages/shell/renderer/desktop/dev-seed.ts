// 개발 확인 전용. LOPHN_DEV_SEED가 있을 때만 프로젝트 작업대를 가짜 통로로 연다.
// 제품 경로에는 없고 core를 부르지 않는다. check는 이 변수를 주지 않는다.
import {
  FAKE_PROJECT_FOLDER,
  fakeWorkspaceSource,
} from "../workspace/fake-source.ts";
import type { WorkspaceSource } from "../workspace/source.ts";
import { DEFAULT_DESK } from "../workspace/model.ts";
import type { EditorDeps } from "../editor/document-view.tsx";
import { fakeEditorFiles } from "../editor/fake-source.ts";
import { readingWidthStore } from "../editor/reading-width.ts";
import { EditorSessions } from "../editor/sessions.ts";

/**
 * 시드 프로젝트 id. 실제 project id 모양이라 같은 id로 core에 프로젝트를
 * 만들면 터미널 열기가 그 등록 폴더를 읽는다.
 */
const DEV_SEED_PROJECT = "prj_01k6devseed000000000000000";

interface DevSeed {
  readonly project: string;
  readonly source: WorkspaceSource;
  /** 파일 탭 통로. */
  readonly editor: EditorDeps;
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
  "npm run check",
  "```",
  "",
  "## Next",
  "",
  "See [plan](lophn/plan) for the order of work.",
].join("\n");

interface SeedInfo {
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  readonly path: string | null;
}

const SEED_DOCUMENTS: Record<string, { info: SeedInfo; text: string }> = {
  doc_notes: {
    info: {
      id: "doc_notes",
      title: "Release notes",
      fileName: "notes.md",
      path: "docs/notes.md",
    },
    text: NOTES,
  },
  doc_plan: {
    info: {
      id: "doc_plan",
      title: "Plan",
      fileName: "plan.md",
      path: "docs/plan.md",
    },
    text: "# Plan\n\nOne step at a time.",
  },
};

/** mock 모드의 [Instructions] 편집기가 여는 문서. 문서 목록에는 오르지 않는다. */
export const SEED_INSTRUCTIONS_DOCUMENT = "doc_instructions";

const INSTRUCTIONS_SEED = {
  info: {
    id: SEED_INSTRUCTIONS_DOCUMENT,
    title: "Instructions",
    fileName: "AGENTS.md",
    path: "AGENTS.md",
  },
  text: "# Instructions\n\nKeep answers short and name the document you changed.",
};

// 시드 파일 통로. 작업대 목록이 아직 문서 id로 열고 경로로도 열 수 있게 둘 다 같은 글로 채운다.
function seededEditor(): EditorDeps {
  const texts: Record<string, string> = {};
  for (const seeded of [...Object.values(SEED_DOCUMENTS), INSTRUCTIONS_SEED]) {
    texts[seeded.info.id] = seeded.text;
    if (seeded.info.path !== null) texts[seeded.info.path] = seeded.text;
  }
  let width: unknown = null;
  return {
    sessions: new EditorSessions(fakeEditorFiles(texts), {
      ask: () => Promise.resolve("keep"),
    }),
    readingWidth: readingWidthStore({
      get: () => Promise.resolve(width),
      set: (next) => {
        width = next;
        return Promise.resolve(true);
      },
    }),
  };
}

// 연결 폴더와 파일 tree는 fake 통로의 것을 그대로 쓰고, 문서 탭과 배치만 이 시드가 얹는다.
const FAKE = fakeWorkspaceSource();

const SEEDED: WorkspaceSource = {
  ...FAKE,
  project: async () => {
    const read = await FAKE.project(DEV_SEED_PROJECT);
    return read.ok
      ? { ok: true, value: { ...read.value, title: "lophn" } }
      : read;
  },
  files: () =>
    Promise.resolve({
      ok: true,
      value: Object.values(SEED_DOCUMENTS).map((seeded) => ({
        folder: FAKE_PROJECT_FOLDER,
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
        active_desk: DEFAULT_DESK,
        desks: {
          [DEFAULT_DESK]: {
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
            floats: [],
            detached: [],
          },
        },
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
