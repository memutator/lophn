import type { ProjectRecord } from "../../../protocol/projects/mod.ts";
import type { FolderResolver } from "../ports.ts";
import type { Project } from "./model.ts";

// 읽는 쪽 모양. 등록 폴더가 디스크에 없으면 found가 false다(찾을 수 없음). 짐작해서 잇지 않는다.
export function recordOf(
  project: Project,
  folders: Pick<FolderResolver, "exists">,
): ProjectRecord {
  return {
    ...project,
    folders: project.folders.map((folder) => ({
      ...folder,
      found: folders.exists(folder.path),
    })),
  };
}
