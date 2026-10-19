import type { Role } from "../../../protocol/lophn-agent/mod.ts";

export type PlaceFacts = {
  role: Role;
  place: { kind: "project" | "app"; id: string } | null;
  // place가 project일 때 그 project의 등록 폴더(position 순)
  projectFolders: readonly string[];
  // place가 app일 때 그 앱의 source 폴더. 아직 잇지 않았으면 null
  appSource: string | null;
  // 이 agent가 맡은 domain의 폴더. PM과 App Engineer는 그릇의 domain 전부, Operator는 고른 것(고른 것을 모르는 쪽은
  // 그릇의 domain 전부를 넘기면 범위가 넉넉해진다)
  domains: readonly { id: string; folder: string; artifactsFolder: string }[];
  // place의 data 폴더. 폴더가 없는 place의 상대 경로 기준이다
  dataFolder: string | null;
  // active project 전체 폴더. lophn만 쓴다
  allProjectFolders: readonly string[];
};

// base는 상대 경로를 푸는 기준일 뿐 읽기·쓰기 허락이 아니다.
export type FolderScope = { read: string[]; write: string[]; base?: string };

// 어떤 role이 어떤 폴더를 읽고 쓰는가의 규칙 하나. file tool scope(place-data)와 rewind, runtime 권한이 모두 이것을 쓴다.
// 앱·project의 data·release 사본(`<data>/apps/<app>/{data,bundles,staging,preview}`)과 agent 정의 폴더는 어느 role에도 열지 않는다.
export function placeScope(facts: PlaceFacts): FolderScope {
  const { role, place } = facts;
  if (role === "lophn") {
    return { read: [...facts.allProjectFolders], write: [] };
  }
  if (place === null) return { read: [], write: [] };
  // 사람의 폴더(project 폴더, 앱 source)가 domain 폴더보다 앞에 남는다. 상대 path의 기준이 첫 폴더라서다.
  const own = place.kind === "project"
    ? [...facts.projectFolders]
    : facts.appSource === null
    ? []
    : [facts.appSource];
  const withBase = (read: string[], write: string[]): FolderScope => {
    const base = own[0] ?? facts.dataFolder ?? undefined;
    return { read, write, ...(base === undefined ? {} : { base }) };
  };
  const domainFolders = facts.domains.map((d) => d.folder);
  const artifacts = facts.domains.map((d) => d.artifactsFolder);
  // PM은 project place에서, App Engineer는 앱 place에서 그릇의 domain 폴더를 통째로 쓴다.
  if (
    (role === "project_manager" && place.kind === "project") ||
    (role === "app_engineer" && place.kind === "app")
  ) {
    const folders = [...own, ...domainFolders];
    return withBase(folders, [...folders]);
  }
  // Operator는 domain의 `artifacts/`만 쓴다. DOMAIN.md·kinds.yaml·skills/는 열지 않는다. project의 폴더는 쓰고
  // 앱 source는 읽기만 한다.
  if (role === "operator") {
    return place.kind === "project"
      ? withBase([...own, ...artifacts], [...own, ...artifacts])
      : withBase([...own, ...artifacts], [...artifacts]);
  }
  return { read: [], write: [] };
}

// agent runtime child의 Deno 권한용 합: 열린 project 폴더, 열린 앱 source, 모든 domain 폴더.
export function runtimeFolders(input: {
  projectFolders: readonly string[];
  appSources: readonly string[];
  domainFolders: readonly string[];
}): FolderScope {
  const folders = [
    ...new Set([
      ...input.projectFolders,
      ...input.appSources,
      ...input.domainFolders,
    ]),
  ];
  return { read: folders, write: [...folders] };
}
