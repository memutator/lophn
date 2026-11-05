// project나 앱의 artifact 목록. artifacts/ 바로 아래 slug 폴더 중 index.html이 일반 file인 것만 센다.
import { join } from "node:path";

import {
  type ArtifactWorkspace,
  ARTIFACT_ENTRY,
  artifactsFolder,
  parseArtifactMeta,
} from "../../../protocol/projects/artifact.ts";
import { artifactNameSchema } from "../../ipc/artifact.ts";
import type { ArtifactFs } from "./source.ts";

export type ArtifactListItem = {
  name: string;
  title: string;
  description: string;
  /** 입구 file mtime의 ISO 문자열. */
  modified: string;
};

const HEAD_BYTES = 64 * 1024;

export async function listArtifacts(
  dataRoot: string,
  workspace: ArtifactWorkspace,
  fs: ArtifactFs,
): Promise<ArtifactListItem[]> {
  const folder = artifactsFolder(dataRoot, workspace);
  let names: string[];
  try {
    names = await fs.readdir(folder);
  } catch {
    return [];
  }
  const items: ArtifactListItem[] = [];
  for (const name of names.sort()) {
    if (!artifactNameSchema.safeParse(name).success) continue;
    try {
      const dir = join(folder, name);
      // lstat이라 symlink는 폴더로 세지 않는다.
      if (!(await fs.lstat(dir)).isDirectory()) continue;
      const entry = join(dir, ARTIFACT_ENTRY);
      const info = await fs.lstat(entry);
      if (!info.isFile()) continue;
      const meta = parseArtifactMeta(
        await fs.readHead(entry, HEAD_BYTES),
        name,
      );
      items.push({ name, ...meta, modified: info.mtime.toISOString() });
    } catch {
      continue; // 입구 file이 없거나 읽는 사이에 사라졌다.
    }
  }
  return items;
}
