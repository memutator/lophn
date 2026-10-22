// WorkspaceSource의 메모리 구현. dev seed와 화면 시험이 쓴다. 연결 폴더 둘(하위 폴더 하나 포함)과 폴더별
// 파일 tree를 갖고, `list(path)`가 폴더 한 단계씩 돌려준다. 문서 목록은 비어 있고 layout은 저장만 받는다.
import { fakeDomainStore } from "./domains/fake-domains.ts";
import { fakeFileSearchSource } from "./search/fake-source.ts";
import type { RunRecordView } from "./sidebar/run-list.tsx";
import type {
  DomainView,
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

// gallery용 domain 둘. id는 shell IPC의 domain id 모양이다.
export const FAKE_DOMAINS: readonly DomainView[] = [
  {
    id: "dom_01j9z3k5q8x2r4m6n7p8t9v0wa",
    name: "finances",
    title: "Finances",
    purpose: "Track spending and tax deadlines.",
    status: "active",
  },
  {
    id: "dom_01j9z3k5q8x2r4m6n7p8t9v0wb",
    name: "research",
    title: "Research",
    purpose: "Keep reading notes and reports.",
    status: "active",
  },
];

const FOLDERS: readonly ProjectFolderView[] = [
  {
    path: FAKE_PROJECT_FOLDER,
    found: true,
    subfolders: [{ path: "eval" }],
  },
  { path: FAKE_NOTES_FOLDER, found: true, subfolders: [] },
];

// source 하나가 자기 tree를 갖는다. 만들기·이름 바꾸기·지우기가 이 메모리 tree를 바꾼다.
type Tree = { name: string; children?: Tree[] };
type Mount = { readonly path: string; readonly nodes: Tree[] };

const clone = (nodes: readonly Node[]): Tree[] =>
  nodes.map((node) => ({
    name: node.name,
    ...(node.children === undefined ? {} : { children: clone(node.children) }),
  }));

const parts = (path: string) => path.split("/").filter((part) => part !== "");

function mountOf(mounts: readonly Mount[], path: string): Mount | undefined {
  return mounts.find((item) =>
    path === item.path || path.startsWith(`${item.path}/`)
  );
}

/** 폴더의 항목들. 폴더가 아니거나 없으면 undefined. */
function find(mounts: readonly Mount[], path: string): Tree[] | undefined {
  const mount = mountOf(mounts, path);
  if (mount === undefined) return undefined;
  let nodes = mount.nodes;
  for (const name of parts(path.slice(mount.path.length))) {
    const next = nodes.find((node) => node.name === name)?.children;
    if (next === undefined) return undefined;
    nodes = next;
  }
  return nodes;
}

interface FakeWorkspaceOptions {
  /** 디스크에서 사라진 것으로 보일 연결 폴더 경로. */
  readonly missing?: readonly string[];
  /** 읽기에 실패하는 폴더 경로. */
  readonly failing?: readonly string[];
  /** project의 domain. 기본은 FAKE_DOMAINS다. */
  readonly domains?: readonly DomainView[];
  /** run 기록. 거르지 않고 그대로 돌려준다. 기본은 빈 목록이다. */
  readonly runs?: readonly RunRecordView[];
}

export function fakeWorkspaceSource(
  options: FakeWorkspaceOptions = {},
): WorkspaceSource {
  const missing = options.missing ?? [];
  const failing = options.failing ?? [];
  const domainStore = fakeDomainStore(options.domains ?? FAKE_DOMAINS);
  const mounts: Mount[] = [
    { path: FAKE_PROJECT_FOLDER, nodes: clone(PHRONER) },
    { path: FAKE_NOTES_FOLDER, nodes: clone(NOTES) },
  ];
  const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
  const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const fail = (code: "conflict" | "not_found" | "invalid_input") =>
    Promise.resolve({ ok: false, code } as const);
  const done = Promise.resolve({ ok: true } as const);
  return {
    searchSource: fakeFileSearchSource(),
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
      const nodes = find(mounts, path);
      if (nodes === undefined || failing.includes(path)) {
        return Promise.resolve({ ok: false, message: "not_found" });
      }
      return Promise.resolve({
        ok: true,
        value: nodes.map((node) => ({
          name: node.name,
          kind: node.children === undefined
            ? "file" as const
            : "folder" as const,
        })).sort((a, b) =>
          a.kind !== b.kind
            ? a.kind === "folder" ? -1 : 1
            : a.name.localeCompare(b.name)
        ),
      });
    },
    create(path, kind) {
      const mount = mountOf(mounts, path);
      if (mount === undefined) return fail("not_found");
      let nodes = mount.nodes;
      const names = parts(path.slice(mount.path.length));
      for (const [at, name] of names.entries()) {
        const last = at === names.length - 1;
        const hit = nodes.find((node) => node.name === name);
        if (last) {
          if (hit !== undefined) return fail("conflict");
          nodes.push(kind === "folder" ? { name, children: [] } : { name });
        } else if (hit === undefined) {
          const made: Tree = { name, children: [] };
          nodes.push(made);
          nodes = made.children!;
        } else if (hit.children === undefined) return fail("conflict");
        else nodes = hit.children;
      }
      return done;
    },
    rename(from, to) {
      if (to === from || to.startsWith(`${from}/`)) {
        return to === from ? done : fail("invalid_input");
      }
      const source = find(mounts, dirOf(from));
      const target = find(mounts, dirOf(to));
      const node = source?.find((item) => item.name === nameOf(from));
      if (source === undefined || target === undefined || node === undefined) {
        return fail("not_found");
      }
      if (target.some((item) => item.name === nameOf(to))) {
        return fail("conflict");
      }
      source.splice(source.indexOf(node), 1);
      target.push({ ...node, name: nameOf(to) });
      return done;
    },
    trash(path) {
      const siblings = find(mounts, dirOf(path));
      const at = siblings?.findIndex((item) => item.name === nameOf(path));
      if (siblings === undefined || at === undefined || at < 0) {
        return fail("not_found");
      }
      siblings.splice(at, 1);
      return done;
    },
    reveal: () => done,
    ...domainStore.actions,
    domains: () => Promise.resolve({ ok: true, value: domainStore.active() }),
    runs: () => Promise.resolve({ ok: true, value: options.runs ?? [] }),
    files: () => Promise.resolve({ ok: true, value: [] }),
    readLayout: () =>
      Promise.resolve({ ok: true, available: false, reason: "no layout" }),
    saveLayout: () => Promise.resolve({ ok: true }),
  };
}
