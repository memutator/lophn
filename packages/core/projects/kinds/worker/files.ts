// kinds worker의 파일 쪽 adapter: 그릇 폴더의 파일 보기. 순수한 일(훑기, 추출, 검사)은 다른 폴더가 하고, 여기는
// 파일을 여는 IO만 한다.
//
// 경로 안전: 순회와 읽기에서 `.git`, 제외한 폴더(lophn 데이터), 폴더 밖을 가리키는 symlink를 뺀다. symlink 폴더는
// 따라가지 않는다(순환을 막는다). 같은 상대 경로가 여러 그릇 폴더에 있으면 앞 폴더의 파일이 이긴다.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import type { KindWatchFolder } from "../../../../protocol/projects/mod.ts";
import type { IndexFiles } from "../index/scan.ts";

// 예산(구현 조절값). 넘으면 일부만 훑지 않고 일을 `unavailable`로 끝낸다.
const FILE_LIMITS: { files: number; fileBytes: number } = {
  // 한 번에 보는 파일 수
  files: 20_000,
  // 한 파일을 읽는 크기. 넘는 파일은 읽을 수 없는 파일이다.
  fileBytes: 4 * 1024 * 1024,
};

export type KindsFileOptions = {
  // 순회하지 않는 절대 경로(lophn 데이터 root)
  exclude?: readonly string[];
  limits?: Partial<typeof FILE_LIMITS>;
};

class FileBudget extends Error {}

function limitsOf(options: KindsFileOptions) {
  return { ...FILE_LIMITS, ...options.limits };
}

// .gitignore는 보지 않는다: kind의 glob이 명시한 파일을 읽는 것이지 키워드 검색처럼 훑는 것이 아니다.
const SKIPPED_NAMES = new Set([".git"]);
const decoder = new TextDecoder("utf-8");

type Source = { absolute: string; root: string };

function inside(real: string, root: string): boolean {
  return real === root || real.startsWith(`${root}/`);
}

function realRootOf(root: string): string | undefined {
  try {
    return realpathSync(root);
  } catch {
    return undefined;
  }
}

type Identity = {
  dev: number | null;
  ino: number | null;
  size: number;
  mtime: number;
};

function identityOf(info: Stats): Identity {
  return {
    dev: info.dev,
    ino: info.ino,
    size: info.size,
    mtime: Math.floor(info.mtime.getTime()),
  };
}

const sameIdentity = (a: Identity, b: Identity): boolean =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtime === b.mtime;

// 폴더 밖을 가리키거나 일반 파일이 아니면 undefined. 읽기 직전의 최종 검사에도 쓴다.
function openable(source: Source): Stats | undefined {
  try {
    const real = realpathSync(source.absolute);
    if (!inside(real, source.root)) return undefined;
    const info = statSync(real);
    return info.isFile() ? info : undefined;
  } catch {
    return undefined;
  }
}

// 읽는 사이 identity·size·mtime이 바뀌었거나 너무 크면 null이다(그 파일은 이번 scan에서 읽지 못한 것).
function readChecked(source: Source, maxBytes: number): Uint8Array | null {
  const before = openable(source);
  if (before === undefined || before.size > maxBytes) return null;
  try {
    const bytes = readFileSync(source.absolute);
    const after = openable(source);
    if (after === undefined) return null;
    return sameIdentity(identityOf(before), identityOf(after)) ? bytes : null;
  } catch {
    return null;
  }
}

// folders가 덮는 그릇의 파일을 roots에서 찾아 순서대로 모은다.
function collect(
  roots: readonly string[],
  folders: readonly KindWatchFolder[],
  options: KindsFileOptions,
): Map<string, Source> {
  const limits = limitsOf(options);
  const excluded = (options.exclude ?? []).map(
    (path) => realRootOf(path) ?? path,
  );
  const found = new Map<string, Source>();

  const walk = (root: string, relative: string, recursive: boolean): void => {
    const directory = relative === "" ? root : `${root}/${relative}`;
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIPPED_NAMES.has(entry.name)) continue;
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const absolute = `${root}/${child}`;
      if (entry.isDirectory()) {
        if (!recursive) continue;
        if (excluded.some((path) => path === absolute)) continue;
        walk(root, child, true);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (found.has(child)) continue;
      const source = { absolute, root };
      if (openable(source) === undefined) continue;
      found.set(child, source);
      if (found.size > limits.files) {
        throw new FileBudget(`more than ${limits.files} files`);
      }
    }
  };

  for (const root of roots) {
    const real = realRootOf(root);
    if (real === undefined) continue;
    for (const folder of folders) {
      if (folder.path.split("/").includes("..")) continue;
      const start = folder.path === "" ? real : `${real}/${folder.path}`;
      let info: Stats;
      try {
        info = statSync(start);
      } catch {
        continue;
      }
      if (!info.isDirectory()) continue;
      // 폴더 자체가 symlink로 밖을 가리키면 그 폴더는 보지 않는다.
      try {
        if (!inside(realpathSync(start), real)) continue;
      } catch {
        continue;
      }
      walk(real, folder.path, folder.recursive);
    }
  }
  return found;
}

// kind glob 폴더 아래 그릇의 파일의 보기. paths는 만들 때 한 번 훑고, stat과 read는 부를 때 파일을 연다.
// 파일이 너무 많으면 만들 때 던진다(일부만 훑고 전체처럼 꾸미지 않는다).
export function openProjectFiles(
  roots: readonly string[],
  folders: readonly KindWatchFolder[],
  options: KindsFileOptions = {},
): IndexFiles {
  const limits = limitsOf(options);
  const sources = collect(roots, folders, options);
  const paths = [...sources.keys()].sort();
  return {
    paths: () => paths,
    stat(path) {
      const source = sources.get(path);
      if (source === undefined) return null;
      const info = openable(source);
      if (info === undefined) return null;
      return { size: info.size, mtime_ms: identityOf(info).mtime };
    },
    read(path) {
      const source = sources.get(path);
      if (source === undefined) return null;
      const bytes = readChecked(source, limits.fileBytes);
      return bytes === null ? null : decoder.decode(bytes);
    },
  };
}
