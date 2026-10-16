// Projects 화면·런처·등록 dialog 시험과 gallery의 가짜 통로. core를 부르지 않고 부른 것을 기록한다.
import type {
  FolderItem,
  ProjectItem,
  ProjectsSource,
  SourceResult,
} from "../source.ts";

export const PHRONER = "prj_01h455vb4pex5v6nkc6gd5fd01";
export const GROCERY = "prj_01h455vb4pex5v6nkc6gd5fd02";
export const OLD_NOTES = "prj_01h455vb4pex5v6nkc6gd5fd03";

/** 사라진 폴더를 보이는 gallery page가 쓰는 폴더. */
export const MISSING_FOLDER = "/home/mina/notes/phroner";

export function folderItem(
  path: string,
  description: string,
  subfolders: FolderItem["subfolders"] = [],
): FolderItem {
  return { path, description, found: true, subfolders };
}

export const DEFAULT_PROJECTS: readonly ProjectItem[] = [
  {
    id: PHRONER,
    title: "phroner",
    purpose: "Evaluate and improve the harness loop.",
    revision: "7",
    archived: false,
    folders: [
      folderItem("/home/mina/work/phroner", "Harness code and eval runs", [
        { path: "eval", description: "Experiment runs and results" },
        { path: "src/harness", description: "The harness loop code" },
        { path: "docs", description: "Design notes for the loop" },
      ]),
      folderItem("/home/mina/notes/phroner", "Reading notes and papers"),
    ],
  },
  {
    id: GROCERY,
    title: "grocery-budget",
    purpose: "Keep the monthly food spending under the plan.",
    revision: "7",
    archived: false,
    folders: [
      folderItem("/home/mina/budget", "Monthly sheets and receipts"),
    ],
  },
  {
    id: OLD_NOTES,
    title: "old-notes",
    purpose: "Notes from the 2025 course.",
    revision: "7",
    archived: true,
    folders: [folderItem("/home/mina/notes/course", "Course notes")],
  },
];

/** 폴더 고르기가 읽는 폴더 이름. 경로 끝 이름 기준으로 한 단계씩 돌려준다. */
const TREE: Readonly<Record<string, readonly string[]>> = {
  "/home/mina/work/phroner": ["docs", "eval", "scripts", "src", "tests"],
  "/home/mina/work/phroner/src": ["harness", "tools"],
};

export interface FakeProjectsOptions {
  projects?: readonly ProjectItem[];
  /** 이 경로의 등록 폴더를 디스크에서 사라진 것으로 읽는다. */
  missingFolder?: string;
  listFails?: boolean;
  /** 저장·보관 결과 code. 없으면 성공이다. */
  writeCode?: string;
  /** OS 선택기가 고르는 경로. null이면 사람이 그만둔 것이다. */
  picked?: string | null;
}

export function fakeProjects(options: FakeProjectsOptions = {}) {
  const seen = options.projects ?? DEFAULT_PROJECTS;
  let rows: ProjectItem[] = seen.map((project) => ({
    ...project,
    folders: project.folders.map((folder) => ({
      ...folder,
      found: folder.path === options.missingFolder ? false : folder.found,
    })),
  }));
  const calls: unknown[][] = [];

  function replace(project: ProjectItem): ProjectItem {
    const next = { ...project, revision: String(Number(project.revision) + 1) };
    rows = rows.map((row) => row.id === next.id ? next : row);
    return next;
  }
  const failure = (): SourceResult<never> | null =>
    options.writeCode ? { ok: false, code: options.writeCode } : null;

  const source: ProjectsSource = {
    list() {
      calls.push(["list"]);
      return Promise.resolve(
        options.listFails
          ? { ok: false, code: "unavailable" }
          : { ok: true, value: rows },
      );
    },
    save(project, change) {
      calls.push(["save", project.id, change, project.revision]);
      const failed = failure();
      if (failed) return Promise.resolve(failed);
      return Promise.resolve({
        ok: true,
        value: replace({
          ...project,
          title: change.title ?? project.title,
          purpose: change.purpose ?? project.purpose,
          folders: change.folders?.map((folder) => ({
            ...folder,
            found: project.folders.find((item) => item.path === folder.path)
              ?.found ?? true,
          })) ?? project.folders,
        }),
      });
    },
    setArchived(project, archived) {
      calls.push(["archive", project.id, archived, project.revision]);
      const failed = failure();
      if (failed) return Promise.resolve(failed);
      return Promise.resolve({
        ok: true,
        value: replace({ ...project, archived }),
      });
    },
    relocate(project, folder) {
      calls.push(["relocate", project.id, folder]);
      if (options.picked === null) {
        return Promise.resolve({ ok: true, value: null });
      }
      const path = options.picked ?? `${folder}-moved`;
      return Promise.resolve({
        ok: true,
        value: replace({
          ...project,
          folders: project.folders.map((item) =>
            item.path === folder ? { ...item, path, found: true } : item
          ),
        }),
      });
    },
    pickFolder() {
      calls.push(["pick"]);
      return Promise.resolve({
        ok: true,
        path: options.picked === undefined
          ? "/home/mina/Documents/new-project"
          : options.picked,
      });
    },
    listFolders(path) {
      calls.push(["folders", path]);
      return Promise.resolve({ ok: true, value: TREE[path] ?? [] });
    },
    register(draft) {
      calls.push(["register", draft]);
      const failed = failure();
      if (failed) return Promise.resolve(failed);
      const project: ProjectItem = {
        id: draft.id,
        title: draft.title,
        purpose: draft.purpose,
        revision: "1",
        archived: false,
        folders: draft.folders.map((folder) => ({
          ...folder,
          found: true,
          subfolders: [],
        })),
      };
      rows = [...rows, project];
      return Promise.resolve({ ok: true, value: project });
    },
  };
  return { source, calls };
}
