// 개발 확인 전용. LOPHN_DEV_SEED가 있을 때만 프로젝트 작업대를 가짜 통로로 연다.
// 제품 경로에는 없고 core를 부르지 않는다. e2e·check는 이 변수를 주지 않는다.
import type { WorkspaceSource } from "../workspace/source.ts";

/**
 * 시드 프로젝트 id. 실제 project id 모양이라 e2e가 같은 id로 core에 프로젝트를
 * 만들면 터미널 열기가 그 등록 폴더를 읽는다.
 */
export const DEV_SEED_PROJECT = "prj_01k6devseed000000000000000";

export interface DevSeed {
  readonly project: string;
  readonly source: WorkspaceSource;
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
  contexts: () =>
    Promise.resolve({
      ok: true,
      value: [{ id: "ctx_design", title: "design" }],
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
              { key: "doc_plan", kind: "document_viewer", title: "plan" },
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

/** 주소에 dev-seed가 있으면 시드 작업대를, 없으면 null을 돌려준다. */
export function devSeed(
  search: string = globalThis.location?.search ?? "",
): DevSeed | null {
  if (!new URLSearchParams(search).has("dev-seed")) return null;
  return { project: DEV_SEED_PROJECT, source: SEEDED };
}
