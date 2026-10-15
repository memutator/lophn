// WorkspaceSource의 메모리 구현. dev seed와 화면 시험이 쓴다. 연결 폴더 둘(하위 폴더 하나 포함)과 폴더별
// 파일 tree를 갖고, `list(path)`가 폴더 한 단계씩 돌려준다. 문서 목록은 비어 있고 layout은 저장만 받는다.
import type {
  FolderEntry,
  ProjectFolderView,
  ReadResult,
  WorkspaceSource,
} from "./source.ts";

/** 파일 tree 한 노드. `children`이 있으면 폴더다. */
type Node = { readonly name: string; readonly children?: readonly Node[] };

const file = (name: string): Node => ({ name });
const folder = (name: string, ...children: Node[]): Node => ({
  name,
  children,
});

export const FAKE_PROJECT_FOLDER = "/home/mina/work/phroner";
export const FAKE_NOTES_FOLDER = "/home/mina/notes/phroner";

const PHRONER: readonly Node[] = [
  folder("assets", file("chest-layout.png")),
  folder("docs", file("notes.md")),
  folder(
    "eval",
    folder(
      "experiments",
      file("exp-008-query-tools.md"),
      file("exp-012-ftb-quests-021-q8.md"),
    ),
    folder("rubrics", file("query-hygiene.json")),
    folder("scenarios", folder("query-leave-still", file("r1.yaml"))),
  ),
  folder(
    "loop",
    folder("findings", file("F-009.md"), file("F-010.md")),
  ),
  folder("reports", file("weekly-12.pdf")),
  file("LOPHN.md"),
];

const NOTES: readonly Node[] = [
  folder("meetings", file("2026-10-12.md"), file("2026-10-05.md")),
  file("ideas.md"),
  file("todo.md"),
];

const FOLDERS: readonly ProjectFolderView[] = [
  {
    path: FAKE_PROJECT_FOLDER,
    found: true,
    subfolders: [{ path: "eval" }],
  },
  { path: FAKE_NOTES_FOLDER, found: true, subfolders: [] },
];

function find(path: string): readonly Node[] | undefined {
  const root = [
    { path: FAKE_PROJECT_FOLDER, nodes: PHRONER },
    { path: FAKE_NOTES_FOLDER, nodes: NOTES },
  ].find((item) => path === item.path || path.startsWith(`${item.path}/`));
  if (root === undefined) return undefined;
  let nodes = root.nodes;
  for (const name of path.slice(root.path.length).split("/")) {
    if (name === "") continue;
    const next = nodes.find((node) => node.name === name)?.children;
    if (next === undefined) return undefined;
    nodes = next;
  }
  return nodes;
}

export interface FakeWorkspaceOptions {
  /** 디스크에서 사라진 것으로 보일 연결 폴더 경로. */
  readonly missing?: readonly string[];
  /** 읽기에 실패하는 폴더 경로. */
  readonly failing?: readonly string[];
}

export function fakeWorkspaceSource(
  options: FakeWorkspaceOptions = {},
): WorkspaceSource {
  const missing = options.missing ?? [];
  const failing = options.failing ?? [];
  return {
    project: (id) =>
      Promise.resolve({
        ok: true,
        value: {
          id,
          title: "phroner",
          folders: FOLDERS.map((item) => ({
            ...item,
            found: !missing.includes(item.path),
          })),
        },
      }),
    list(path): Promise<ReadResult<readonly FolderEntry[]>> {
      const nodes = find(path);
      if (nodes === undefined || failing.includes(path)) {
        return Promise.resolve({ ok: false, message: "not_found" });
      }
      return Promise.resolve({
        ok: true,
        value: nodes.map((node) => ({
          name: node.name,
          kind: node.children === undefined ? "file" : "folder",
        })),
      });
    },
    documents: () => Promise.resolve({ ok: true, value: [] }),
    files: () => Promise.resolve({ ok: true, value: [] }),
    readLayout: () =>
      Promise.resolve({ ok: true, available: false, reason: "no layout" }),
    saveLayout: () => Promise.resolve({ ok: true }),
  };
}
