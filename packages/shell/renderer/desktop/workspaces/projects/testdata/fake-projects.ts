// 런처·등록 dialog·project detail 시험과 gallery의 가짜 통로. core를 부르지 않고 부른 것을 기록한다.
import type {
  FolderItem,
  FolderMatch,
  IdentityStatus,
  ProjectItem,
  ProjectsSource,
  SourceResult,
} from "../source.ts";

const PHRONER = "prj_01h455vb4pex5v6nkc6gd5fd01";
const GROCERY = "prj_01h455vb4pex5v6nkc6gd5fd02";
const OLD_NOTES = "prj_01h455vb4pex5v6nkc6gd5fd03";

/** 사라진 폴더를 보이는 gallery page가 쓰는 폴더. */
export const MISSING_FOLDER = "/home/mina/notes/phroner";

export function folderItem(path: string, description: string): FolderItem {
  return { path, description, found: true };
}

/** 이 기계에서 새 id를 만들 때 fake가 주는 값. */
const NEW_IDENTITY = "pri_01h455vb4pex5v6nkc6gd5fe99";

const DEFAULT_PROJECTS: readonly ProjectItem[] = [
  {
    id: PHRONER,
    title: "phroner",
    purpose: "Evaluate and improve the harness loop.",
    revision: "7",
    archived: false,
    identity: null,
    repo: "git",
    folders: [
      folderItem("/home/mina/work/phroner", "Harness code and eval runs"),
      folderItem("/home/mina/notes/phroner", "Reading notes and papers"),
    ],
  },
  {
    id: GROCERY,
    title: "grocery-budget",
    purpose: "Keep the monthly food spending under the plan.",
    revision: "7",
    archived: false,
    identity: null,
    repo: "git",
    folders: [folderItem("/home/mina/budget", "Monthly sheets and receipts")],
  },
  {
    id: OLD_NOTES,
    title: "old-notes",
    purpose: "Notes from the 2025 course.",
    revision: "7",
    archived: true,
    identity: null,
    repo: "none",
    folders: [folderItem("/home/mina/notes/course", "Course notes")],
  },
];

export interface FakeProjectsOptions {
  projects?: readonly ProjectItem[];
  /** 이 경로의 등록 폴더를 디스크에서 사라진 것으로 읽는다. */
  missingFolder?: string;
  listFails?: boolean;
  /** 저장·보관 결과 code. 없으면 성공이다. */
  writeCode?: string;
  /** OS 선택기가 고르는 경로. null이면 사람이 그만둔 것이다. */
  picked?: string | null;
  /** 모든 project의 id file 상태. 없으면 git 저장소에 file이 없다. [Set up]과 [Separate project]가 이 상태를 바꾼다. */
  identity?: {
    file?: IdentityStatus["file"];
    repo?: "git" | "none";
    duplicateOf?: IdentityStatus["duplicateOf"];
  };
  /** 등록 dialog가 고른 폴더를 읽은 값. 없으면 file이 없는 git 폴더다. null이면 읽지 못한다. */
  match?: FolderMatch | null;
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
  let status = {
    file: options.identity?.file ?? "none",
    repo: options.identity?.repo ?? "git",
    duplicateOf: options.identity?.duplicateOf ?? null,
    identity: null as string | null,
  };
  const statusOf = (project: ProjectItem): IdentityStatus => {
    const folder = project.folders[0];
    return {
      project: project.id,
      identity: status.identity,
      file: status.file,
      repo: status.repo,
      folder: folder?.path ?? null,
      found: folder?.found ?? false,
      duplicateOf: status.duplicateOf,
    };
  };

  function replace(project: ProjectItem): ProjectItem {
    const next = { ...project, revision: String(Number(project.revision) + 1) };
    rows = rows.map((row) => (row.id === next.id ? next : row));
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
          folders:
            change.folders?.map((folder) => ({
              ...folder,
              found:
                project.folders.find((item) => item.path === folder.path)
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
            item.path === folder ? { ...item, path, found: true } : item,
          ),
        }),
      });
    },
    pickFolder() {
      calls.push(["pick"]);
      return Promise.resolve({
        ok: true,
        path:
          options.picked === undefined
            ? "/home/mina/Documents/new-project"
            : options.picked,
      });
    },
    register(draft) {
      calls.push(["register", draft]);
      const failed = failure();
      if (failed) return Promise.resolve(failed);
      const project: ProjectItem = {
        // core가 id를 만든다. fake는 행 수로 하나씩 낸다.
        id: `prj_01h455vb4pex5v6nkc6gd5fe${String(rows.length).padStart(2, "0")}`,
        title: draft.title,
        purpose: draft.purpose,
        revision: "1",
        archived: false,
        folders: draft.folders.map((folder) => ({ ...folder, found: true })),
        identity: null,
        repo: null,
      };
      rows = [...rows, project];
      return Promise.resolve({ ok: true, value: project });
    },
    match(path) {
      calls.push(["match", path]);
      if (options.match === null) {
        return Promise.resolve({ ok: false, code: "unavailable" });
      }
      return Promise.resolve({
        ok: true,
        value: options.match ?? {
          repo: "git",
          file: "none",
          same: null,
          suggestions: [],
        },
      });
    },
    relinkFolder(project, folder, path) {
      calls.push(["relinkFolder", project.id, folder, path]);
      const failed = failure();
      if (failed) return Promise.resolve(failed);
      return Promise.resolve({
        ok: true,
        value: replace({
          ...project,
          folders: project.folders.map((item) =>
            item.path === folder ? { ...item, path, found: true } : item,
          ),
        }),
      });
    },
    identity(project) {
      calls.push(["identity", project.id]);
      return Promise.resolve({ ok: true, value: statusOf(project) });
    },
    createIdentity(project) {
      calls.push(["createIdentity", project.id]);
      const failed = failure();
      if (failed) return Promise.resolve(failed);
      status = {
        ...status,
        file: "uncommitted",
        identity: status.identity ?? NEW_IDENTITY,
      };
      return Promise.resolve({ ok: true, value: statusOf(project) });
    },
    renewIdentity(project) {
      calls.push(["renewIdentity", project.id]);
      const failed = failure();
      if (failed) return Promise.resolve(failed);
      status = {
        ...status,
        file: "uncommitted",
        duplicateOf: null,
        identity: NEW_IDENTITY,
      };
      return Promise.resolve({ ok: true, value: statusOf(project) });
    },
    linkIdentity(project, identity) {
      calls.push(["linkIdentity", project.id, identity]);
      const failed = failure();
      if (failed) return Promise.resolve(failed);
      const linked = { ...project, identity };
      rows = rows.map((row) => (row.id === linked.id ? linked : row));
      return Promise.resolve({ ok: true, value: linked });
    },
  };
  return { source, calls };
}
