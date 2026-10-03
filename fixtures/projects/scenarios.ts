// fixture를 임시 폴더로 복사하고, lophn 밖에서 일어나는 변화를 사본에 만든다.
// fixture 원본은 손대지 않는다. 앞으로 일어날 일을 사본에 만들어 둔다.
import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type FixtureName =
  | "notes-basic"
  | "multi-folder"
  | "mixed-formats"
  | "weekly-report"
  | "korean-search";

export const FIXTURE_NAMES: readonly FixtureName[] = [
  "notes-basic",
  "multi-folder",
  "mixed-formats",
  "weekly-report",
  "korean-search",
];

// fixture 원본은 이 파일과 같은 폴더에 있다.
const FIXTURE_DIR = resolve(import.meta.dirname ?? ".");

export function fixturePath(name: FixtureName): string {
  return join(FIXTURE_DIR, name);
}

// env 권한 없이 임시 폴더를 얻는다(node:os의 tmpdir()는 TMPDIR을 읽는다).
async function makeTempDir(prefix: string): Promise<string> {
  return await Deno.makeTempDir({ prefix: `lophn-${prefix}-` });
}

export async function copyFixture(
  name: FixtureName,
  dest?: string,
): Promise<string> {
  const root = dest ?? await makeTempDir(name);
  await copyTree(fixturePath(name), root);
  await restoreGitignoreNames(root);
  return root;
}

// fixture 폴더를 바이트 그대로 복사한다. BOM·CRLF·NFD가 지켜져야 한다.
async function copyTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) await copyTree(source, target);
    else if (entry.isSymbolicLink()) {
      await symlink(await readlink(source), target);
    } else await copyFile(source, target);
  }
}

// 저장소에는 fixture의 `.gitignore`를 둘 수 없다(무시 규칙이 저장소 전체에 걸린다). 사본을 만들 때 이름을 되돌린다.
async function restoreGitignoreNames(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await restoreGitignoreNames(path);
    } else if (entry.name === "_gitignore") {
      await rename(path, join(dir, ".gitignore"));
    }
  }
}

export async function editExternally(
  root: string,
  rel: string,
  content: string | Uint8Array,
): Promise<void> {
  const path = join(root, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export async function deleteAndRecreate(
  root: string,
  rel: string,
  content: string | Uint8Array,
): Promise<void> {
  const path = join(root, rel);
  await rm(path, { force: true, recursive: true });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export async function renameFile(
  root: string,
  from: string,
  to: string,
): Promise<void> {
  const target = join(root, to);
  await mkdir(dirname(target), { recursive: true });
  await rename(join(root, from), target);
}

export async function addOutsideSymlink(
  root: string,
  rel: string,
): Promise<string> {
  const outside = await makeTempDir("outside");
  await writeFile(
    join(outside, "outside.md"),
    "# 루트 밖 문서\n\nroot 밖을 가리킨다.\n",
  );
  await symlink(outside, join(root, rel));
  return outside;
}

export async function addGitDir(root: string, rel = ".git"): Promise<string> {
  const path = join(root, rel);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "HEAD"), "ref: refs/heads/main\n");
  await writeFile(
    join(path, "config"),
    "[core]\n\trepositoryformatversion = 0\n",
  );
  await writeFile(
    join(path, "notes.md"),
    "# git 안쪽 문서\n\n제외 대상이다.\n",
  );
  return path;
}

export async function addLophnDataDir(
  root: string,
  rel = ".lophn",
): Promise<string> {
  const path = join(root, rel);
  await mkdir(join(path, "documents"), { recursive: true });
  await writeFile(
    join(path, "lophn.db"),
    new Uint8Array([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65]),
  );
  await writeFile(
    join(path, "documents", "x.md"),
    "# 데이터 폴더 문서\n\n제외 대상이다.\n",
  );
  return path;
}

export async function removePermission(
  root: string,
  rel: string,
): Promise<() => Promise<void>> {
  const path = join(root, rel);
  const before = (await stat(path)).mode & 0o777;
  await chmod(path, 0o000);
  return async () => {
    await chmod(path, before);
  };
}

export async function modifyKeepingSizeAndMtime(
  root: string,
  rel: string,
): Promise<void> {
  const path = join(root, rel);
  const original = new Uint8Array(await readFile(path));
  const info = await stat(path);

  // size·mtime만 비교하면 놓치는 변화다. 이어지는 추출 테스트가 읽을 수 있게 UTF-8은 지키고 ASCII 글자 하나만 바꾼다.
  const index = original.findIndex((byte) =>
    (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a)
  );
  if (index < 0) throw new Error(`${rel}에 바꿀 ASCII 글자가 없다`);
  const changed = original.slice();
  changed[index] = original[index] ^ 0x20;
  await writeFile(path, changed);
  await utimes(path, info.atime, info.mtime);
}

export async function removeFixtureCopy(root: string): Promise<void> {
  await restorePermissions(root);
  await rm(root, { force: true, recursive: true });
}

// 권한을 뺀 폴더는 지우기 전에 되돌려야 한다.
async function restorePermissions(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await chmod(path, 0o755);
      await restorePermissions(path);
    } else {
      await chmod(path, 0o644);
    }
  }
}
