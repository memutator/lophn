import {
  ARTIFACT_ENTRY,
  artifactNameSchema,
  parseArtifactMeta,
} from "../../../protocol/projects/mod.ts";

export type ArtifactEntry = {
  name: string;
  title: string;
  description: string;
};

export type ArtifactListFs = {
  readdir(path: string): Promise<string[]>;
  lstat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
  /** 앞 `bytes`만 읽어 글로 돌려준다. */
  readHead(path: string, bytes: number): Promise<string>;
};

const HEAD_BYTES = 64 * 1024;

// 관례 자리 `artifacts/*/index.html`. shell main의 목록(shell/main/artifact/list.ts)과 같은 규칙의 사본이다.
// core는 shell을 import하지 못한다.
export async function listArtifactEntries(
  folder: string,
  fs: ArtifactListFs,
): Promise<ArtifactEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(folder);
  } catch {
    return [];
  }
  const items: ArtifactEntry[] = [];
  for (const name of names.sort()) {
    if (!artifactNameSchema.safeParse(name).success) continue;
    try {
      const dir = `${folder}/${name}`;
      // lstat이라 symlink는 폴더로 세지 않는다.
      if (!(await fs.lstat(dir)).isDirectory()) continue;
      const entry = `${dir}/${ARTIFACT_ENTRY}`;
      if (!(await fs.lstat(entry)).isFile()) continue;
      items.push({
        name,
        ...parseArtifactMeta(await fs.readHead(entry, HEAD_BYTES), name),
      });
    } catch {
      continue; // 입구 file이 없거나 읽는 사이에 사라졌다.
    }
  }
  return items;
}
