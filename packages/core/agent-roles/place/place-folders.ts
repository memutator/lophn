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
  // place가 app이면 그 앱의 source 폴더, project이면 그 project 앱의 source 폴더. 없으면 null
  appSource: string | null;
  // place가 project일 때 그 project 층의 skill 폴더
  skillsFolder: string | null;
  // place가 project일 때 그 project의 data 폴더. 등록 폴더가 없는 project의 상대 경로 기준이다
  dataFolder: string | null;
  // active project 전체 폴더. lophn만 쓴다
  allProjectFolders: readonly string[];
};

// base는 상대 경로를 푸는 기준일 뿐 읽기·쓰기 허락이 아니다.
export type FolderScope = { read: string[]; write: string[]; base?: string };

function present(path: string | null): string[] {
  return path === null ? [] : [path];
}

// 어떤 role이 어떤 폴더를 읽고 쓰는가의 규칙 하나. file tool scope(place-data)와 rewind, runtime 권한이 모두 이것을 쓴다.
export function placeScope(facts: PlaceFacts): FolderScope {
  const { role, place } = facts;
  if (role === "lophn") {
    return { read: [...facts.allProjectFolders], write: [] };
  }
  if (place?.kind === "project") {
    // 상대 path의 기준은 사람의 첫 project 폴더이고, 폴더가 없는 project는 data 폴더다.
    const base = facts.projectFolders[0] ?? facts.dataFolder ?? undefined;
    const withBase = (folders: string[]): FolderScope => ({
      read: folders,
      write: [...folders],
      ...(base === undefined ? {} : { base }),
    });
    // 사람의 project 폴더가 artifacts 폴더보다 앞에 남는다.
    const artifacts = present(facts.artifactsFolder);
    // kinds 파일, 앱 source, skill 폴더는 PM만 연다. 앱의 data·release 사본(`app/`)과 agent 정의는 열지 않는다.
    if (role === "project_manager") {
      return withBase([
        ...facts.projectFolders,
        ...artifacts,
        ...present(facts.kindsFile),
        ...present(facts.appSource),
        ...present(facts.skillsFolder),
      ]);
    }
    if (role === "operator") {
      return withBase([...facts.projectFolders, ...artifacts]);
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
  skillFolders: readonly string[];
  appSources: readonly string[];
}): FolderScope {
  const folders = new Set([
    ...input.projectFolders,
    ...input.artifactFolders,
    ...input.skillFolders,
    ...input.appSources,
  ]);
  return {
    read: [...folders],
    write: [...new Set([...folders, ...input.kindsFiles])],
  };
}
