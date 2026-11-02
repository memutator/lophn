export type PlaceFacts = {
  place: { kind: "project" | "app"; id: string } | null;
  // place가 project일 때 그 project의 등록 폴더(position 순)
  projectFolders: readonly string[];
  // place가 app일 때 그 앱의 source 폴더. 아직 잇지 않았으면 null
  appSource: string | null;
  // place가 app일 때 사람이 source 밖에 더 이은 폴더(position 순)
  appFolders: readonly string[];
  // 이 session이 맡은 domain의 폴더. turn은 받은 domain만, rewind는 그릇의 domain 전부를 넘긴다.
  domains: readonly { id: string; folder: string }[];
  // place의 data 폴더. 폴더가 없는 place의 상대 경로 기준이다
  dataFolder: string | null;
  // active project 전체 폴더. home만 쓴다
  allProjectFolders: readonly string[];
  // place가 project일 때 그 project의 `workflows/` 절대 경로. 그 project place의 session이 쓴다(아래 placeScope)
  workflowsFolder: string | null;
};

// base는 상대 경로를 푸는 기준일 뿐 읽기·쓰기 허락이 아니다.
export type FolderScope = {
  read: string[];
  write: string[];
  base?: string;
  // 이 session의 tool-results 폴더. 읽기 전용이고 read 목록과 별개다
  results?: string;
};

// 어떤 place 종류가 어떤 폴더를 읽고 쓰는가의 규칙 하나. file tool scope(place-data)와 rewind가 이것을 쓴다.
// 앱·project의 data·release 사본(`<data>/apps/<app>/{data,bundles,staging,preview}`)과 agent 정의 폴더는 어느 place 종류에도 열지 않는다.
export function placeScope(facts: PlaceFacts): FolderScope {
  const { place } = facts;
  if (place === null) {
    return { read: [...facts.allProjectFolders], write: [] };
  }
  // 사람의 폴더(project 폴더, 앱 source와 더한 폴더)가 domain 폴더보다 앞에 남는다. 상대 path의 기준이 첫 폴더라서다.
  const own =
    place.kind === "project"
      ? [...facts.projectFolders]
      : [
          ...(facts.appSource === null ? [] : [facts.appSource]),
          ...facts.appFolders,
        ];
  const withBase = (folders: string[]): FolderScope => {
    const base = own[0] ?? facts.dataFolder ?? undefined;
    return {
      read: [...folders],
      write: [...folders],
      ...(base === undefined ? {} : { base }),
    };
  };
  const domainFolders = facts.domains.map((d) => d.folder);
  const folders = [...own, ...domainFolders];
  // workflows/는 그 project place의 session이 쓴다.
  if (place.kind === "project" && facts.workflowsFolder !== null)
    folders.push(facts.workflowsFolder);
  return withBase(folders);
}
