// 화면 테스트의 OrganizeSource. 부른 순서와 입력을 남기고 미리 정한 값을 돌려준다.
// core를 흉내 내지 않고 화면이 무엇을 언제 부르는지만 본다.
import type { SourceResult } from "../../source.ts";
import type {
  DocumentDetail,
  ExportResult,
  OrganizeSource,
  PlacedDocument,
  PlaceOutcome,
  ProjectRow,
  RemoveReply,
  VersionRow,
} from "../source.ts";

export interface OrganizeCall {
  readonly method: keyof OrganizeSource;
  readonly args: readonly unknown[];
}

export const PROJECT: ProjectRow = {
  id: "prj_1",
  name: "lophn",
  title: "lophn",
  purpose: "Build lophn.",
  revision: "4",
  archived: false,
  documentCount: 2,
  tracking: true,
  folders: ["/work/lophn"],
};

export const OLD_PROJECT: ProjectRow = {
  id: "prj_2",
  name: "old-site",
  title: "Old site",
  purpose: "",
  revision: "9",
  archived: true,
  documentCount: 1,
  tracking: false,
  folders: [],
};

export const DOCUMENTS: readonly PlacedDocument[] = [
  {
    id: "doc_1",
    title: "Release notes",
    name: "release-notes",
    latestVersion: "ver_2",
    archived: false,
  },
  {
    id: "doc_2",
    title: "Plan",
    name: "plan",
    latestVersion: "ver_5",
    archived: false,
  },
];

export const DETAIL: DocumentDetail = {
  id: "doc_1",
  title: "Release notes",
  name: "release-notes",
  place: { kind: "project", id: "prj_1" },
  revision: "3",
  latestVersion: "ver_2",
  archived: false,
  file: null,
  singleFile: "notes.md",
};

export interface OrganizeData {
  projects?: readonly ProjectRow[];
  /** 프로젝트 등록 바꾸기 결과. 없으면 바꾼 값과 다음 revision이다. */
  updated?: SourceResult<ProjectRow>;
  documents?: readonly PlacedDocument[];
  /** 문서 읽기. 부른 횟수(0부터)를 받는다. */
  detail?: (count: number) => DocumentDetail;
  renamed?: SourceResult<DocumentDetail>;
  moved?: SourceResult<DocumentDetail>;
  versions?: readonly VersionRow[];
  exported?: SourceResult<ExportResult>;
  placed?: SourceResult<PlaceOutcome>;
  removed?: SourceResult<RemoveReply>;
}

function ok<T>(value: T): SourceResult<T> {
  return { ok: true, value };
}

export function fakeOrganize(data: OrganizeData = {}): {
  source: OrganizeSource;
  calls: OrganizeCall[];
  of: (method: keyof OrganizeSource) => OrganizeCall[];
} {
  const calls: OrganizeCall[] = [];
  let reads = 0;
  const log = <T>(method: keyof OrganizeSource, args: unknown[], value: T) => {
    calls.push({ method, args });
    return Promise.resolve(value);
  };
  const source: OrganizeSource = {
    projects: () =>
      log("projects", [], ok(data.projects ?? [PROJECT, OLD_PROJECT])),
    updateProject: (project, change) =>
      log(
        "updateProject",
        [project, change],
        data.updated ?? ok({ ...project, ...change, revision: "5" }),
      ),
    setProjectArchived: (project, archived) =>
      log(
        "setProjectArchived",
        [project, archived],
        ok({ ...project, archived, revision: "6" }),
      ),
    placeDocuments: (place) =>
      log("placeDocuments", [place], ok(data.documents ?? DOCUMENTS)),
    document: (id) =>
      log("document", [id], ok(data.detail?.(reads++) ?? DETAIL)),
    renameDocument: (document, name) =>
      log(
        "renameDocument",
        [document, name],
        data.renamed ?? ok({ ...document, name, revision: "4" }),
      ),
    moveDocument: (document, place, name) =>
      log(
        "moveDocument",
        [document, place, name],
        data.moved ?? ok({ ...document, place, name, revision: "4" }),
      ),
    versions: (document) =>
      log(
        "versions",
        [document],
        ok(
          data.versions ?? [{ id: "ver_2", number: 2 }, {
            id: "ver_1",
            number: 1,
          }],
        ),
      ),
    exportDocuments: (place, picks, format) =>
      log(
        "exportDocuments",
        [place, picks, format],
        data.exported ?? ok({ format, documents: [] }),
      ),
    placeFile: (document, project, path) =>
      log(
        "placeFile",
        [document, project, path],
        data.placed ?? ok({ file: "written", path, steps: null }),
      ),
    removeFile: (document) =>
      log("removeFile", [document], data.removed ?? ok({ kind: "review" })),
  };
  return {
    source,
    calls,
    of: (method) => calls.filter((call) => call.method === method),
  };
}
