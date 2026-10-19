import type { Role } from "../../../protocol/lophn-agent/mod.ts";

export type PlaceFacts = {
  role: Role;
  place: { kind: "project" | "app"; id: string } | null;
  // place가 project일 때 그 project의 등록 폴더(position 순)
  projectFolders: readonly string[];
  // place가 project일 때 그 project의 artifacts 폴더
  artifactsFolder: string | null;
  // place가 project일 때 그 project의 kinds 파일(파일이 아직 없어도 경로다). PM만 쓴다
  kindsFile: string | null;
  // place가 app일 때 앱 source 폴더. 없으면 null
  appSource: string | null;
  // active project 전체 폴더. lophn만 쓴다
  allProjectFolders: readonly string[];
};

export type FolderScope = { read: string[]; write: string[] };

// 어떤 role이 어떤 폴더를 읽고 쓰는가의 규칙 하나. file tool scope(place-data)와 rewind, runtime 권한이 모두 이것을 쓴다.
export function placeScope(facts: PlaceFacts): FolderScope {
  const { role, place } = facts;
  if (role === "lophn") {
    return { read: [...facts.allProjectFolders], write: [] };
  }
  if (place?.kind === "project") {
    // 상대 path의 기준이 읽기 목록의 첫 폴더라서 사람의 project 폴더가 artifacts 폴더보다 앞에 남아야 한다.
    const artifacts = facts.artifactsFolder === null
      ? []
      : [facts.artifactsFolder];
    // kinds 파일은 PM만 연다.
    if (role === "project_manager") {
      const folders = [
        ...facts.projectFolders,
        ...artifacts,
        ...(facts.kindsFile === null ? [] : [facts.kindsFile]),
      ];
      return { read: folders, write: [...folders] };
    }
    if (role === "operator") {
      const folders = [...facts.projectFolders, ...artifacts];
      return { read: folders, write: [...folders] };
    }
  } else if (place?.kind === "app" && facts.appSource !== null) {
    if (role === "app_engineer") {
      return { read: [facts.appSource], write: [facts.appSource] };
    }
    if (role === "operator") return { read: [facts.appSource], write: [] };
  }
  return { read: [], write: [] };
}

// agent runtime child의 Deno 권한용 합. kinds 파일은 PM의 쓰기라 write에만 더한다.
export function runtimeFolders(input: {
  kindsFiles: readonly string[];
  projectFolders: readonly string[];
  artifactFolders: readonly string[];
  appSources: readonly string[];
}): FolderScope {
  const base = {
    role: "operator" as const,
    kindsFile: null,
    allProjectFolders: [],
  };
  const folders = new Set([
    ...placeScope({
      ...base,
      place: { kind: "project", id: "" },
      projectFolders: input.projectFolders,
      artifactsFolder: null,
      appSource: null,
    }).write,
    ...input.artifactFolders,
  ]);
  for (const source of input.appSources) {
    const scope = placeScope({
      ...base,
      role: "app_engineer",
      place: { kind: "app", id: "" },
      projectFolders: [],
      artifactsFolder: null,
      appSource: source,
    });
    for (const path of scope.write) folders.add(path);
  }
  return {
    read: [...folders],
    write: [...new Set([...folders, ...input.kindsFiles])],
  };
}
