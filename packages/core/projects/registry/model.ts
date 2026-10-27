import { err, ok, type Result } from "../../../base/mod.ts";
import {
  absolutePathSchema,
  type ProjectFolder,
  type ProjectRecord,
  relativePathSchema,
} from "../../../protocol/projects/mod.ts";

// 저장된 project. 읽는 쪽 모양(`ProjectRecord`)에서 폴더의 found만 뺀다.
export type Project = Omit<ProjectRecord, "folders"> & {
  folders: ProjectFolder[];
};
export type ProjectCandidate = Omit<Project, "revision">;

// 바뀔 때마다 1씩 오른다. 처음은 "1"이다.
export function nextRevision(revision: string): string {
  return (BigInt(revision) + 1n).toString();
}

// absolutePathSchema는 모양만 검사한다. OS realpath·alias·symlink의 진실은
// command 밖 trusted host/worker가 canonical root를 준비할 책임이다.
export type CanonicalRoot = string;

type PathStyle = "posix" | "windows" | "unc";

const DRIVE = /^[A-Za-z]:[\\/]/;
const UNC = /^\\\\[^\\]+\\[^\\]+/;

function pathStyle(path: CanonicalRoot): Result<PathStyle> {
  if (!absolutePathSchema.safeParse(path).success) {
    return err({ code: "invalid_input", message: "invalid canonical root" });
  }
  if (path.startsWith("/")) return ok("posix");
  if (DRIVE.test(path)) return ok("windows");
  if (UNC.test(path)) return ok("unc");
  return err({ code: "invalid_input", message: "invalid canonical root" });
}

function invalidRoot(): Result<never> {
  return err({ code: "invalid_input", message: "invalid canonical root" });
}

function split(path: CanonicalRoot, style: PathStyle): Result<string[]> {
  if (style === "posix") {
    if (path === "/") return ok([]);
    const parts = path.slice(1).split("/");
    return parts.some((part) => part === "") ? invalidRoot() : ok(parts);
  }
  if (style === "windows") {
    const drive = path.slice(0, 2).toUpperCase();
    if (path.length === 3) return ok([drive]);
    const parts = path.slice(3).split(/[\\/]/);
    return parts.some((part) => part === "")
      ? invalidRoot()
      : ok([drive, ...parts]);
  }
  const parts = path.slice(2).split("\\");
  return parts.length < 2 ||
    parts.some((part) => part === "" || part.includes("/"))
    ? invalidRoot()
    : ok(parts);
}

function equalPart(left: string, right: string, style: PathStyle): boolean {
  return style === "posix"
    ? left === right
    : left.toLowerCase() === right.toLowerCase();
}

export function rootRelation(
  left: CanonicalRoot,
  right: CanonicalRoot,
): Result<"equal" | "ancestor" | "descendant" | "disjoint"> {
  const leftStyle = pathStyle(left);
  if (!leftStyle.ok) return leftStyle;
  const rightStyle = pathStyle(right);
  if (!rightStyle.ok) return rightStyle;
  const leftParts = split(left, leftStyle.value);
  if (!leftParts.ok) return leftParts;
  const rightParts = split(right, rightStyle.value);
  if (!rightParts.ok) return rightParts;
  if (leftStyle.value !== rightStyle.value) return ok("disjoint");
  const size = Math.min(leftParts.value.length, rightParts.value.length);
  for (let index = 0; index < size; index++) {
    if (
      !equalPart(
        leftParts.value[index]!,
        rightParts.value[index]!,
        leftStyle.value,
      )
    ) {
      return ok("disjoint");
    }
  }
  if (leftParts.value.length === rightParts.value.length) return ok("equal");
  return ok(
    leftParts.value.length < rightParts.value.length
      ? "ancestor"
      : "descendant",
  );
}

function rootsOverlap(
  left: CanonicalRoot,
  right: CanonicalRoot,
): Result<boolean> {
  const relation = rootRelation(left, right);
  if (!relation.ok) return relation;
  return ok(relation.value !== "disjoint");
}

// 보관한 project의 root도 후보에 넣는다. 내용으로 재연결하지 않는다. 깊이가 같은 root가 둘이면 conflict다.
export function deepestRegisteredRoot(
  path: CanonicalRoot,
  roots: readonly { project: string; path: CanonicalRoot }[],
): Result<{ project: string; path: CanonicalRoot } | null> {
  const style = pathStyle(path);
  if (!style.ok) return style;
  const parts = split(path, style.value);
  if (!parts.ok) return parts;
  let chosen: {
    project: string;
    path: CanonicalRoot;
    depth: number;
    ties: boolean;
  } | null = null;
  for (const root of roots) {
    const relation = rootRelation(root.path, path);
    if (!relation.ok) return relation;
    if (relation.value !== "equal" && relation.value !== "ancestor") continue;
    const rootParts = split(root.path, style.value);
    if (!rootParts.ok) return rootParts;
    const depth = rootParts.value.length;
    if (chosen === null || depth > chosen.depth) {
      chosen = { project: root.project, path: root.path, depth, ties: false };
    } else if (depth === chosen.depth) {
      chosen.ties = true;
    }
  }
  if (chosen?.ties) {
    return err({ code: "conflict", message: "registered roots tie" });
  }
  return ok(
    chosen === null ? null : { project: chosen.project, path: chosen.path },
  );
}

// 같은 project 안에서는 폴더가 같거나 겹치면 거절한다. project끼리 겹치는 것은 허용한다.
export function validateFolderRoots(
  folders: readonly Pick<ProjectFolder, "path">[],
): Result<void> {
  for (let left = 0; left < folders.length; left++) {
    const current = folders[left]!;
    const canonical = rootRelation(current.path, current.path);
    if (!canonical.ok) return canonical;
    for (let right = left + 1; right < folders.length; right++) {
      const overlap = rootsOverlap(current.path, folders[right]!.path);
      if (!overlap.ok) return overlap;
      if (overlap.value) {
        return err({
          code: "invalid_input",
          message: "folders of a project cannot repeat or overlap",
        });
      }
    }
  }
  return ok(undefined);
}

// 하위 폴더는 연결 폴더 기준 상대 경로다. `..`, 절대 경로, 같은 폴더 안 중복을 거절한다.
// 연결 폴더 밖으로 나가는 symlink는 FolderResolver가 realpath로 거절한다.
export function validateSubfolderPaths(
  folders: readonly ProjectFolder[],
): Result<void> {
  for (const folder of folders) {
    const seen = new Set<string>();
    for (const subfolder of folder.subfolders) {
      if (
        !relativePathSchema.safeParse(subfolder.path).success ||
        seen.has(subfolder.path)
      ) {
        return err({
          code: "invalid_input",
          message: "subfolder must be a unique path inside its folder",
        });
      }
      seen.add(subfolder.path);
    }
  }
  return ok(undefined);
}

// project.search의 folder를 훑을 시작 폴더로 바꾼다. 없으면 등록 폴더 전부, 있으면 등록 폴더나 그 아래의
// 절대 경로(하위 폴더 포함)이다. 연결 폴더 밖이면 거절한다.
export function searchScopeOf(
  folders: readonly Pick<ProjectFolder, "path">[],
  folder: string | undefined,
): Result<readonly { folder_path: string; start: string }[]> {
  if (folder === undefined) {
    return ok(
      folders.map((item) => ({ folder_path: item.path, start: item.path })),
    );
  }
  for (const item of folders) {
    const relation = rootRelation(item.path, folder);
    if (!relation.ok) return relation;
    if (relation.value === "equal" || relation.value === "ancestor") {
      return ok([{ folder_path: item.path, start: folder }]);
    }
  }
  return err({
    code: "invalid_input",
    message: "folder is outside the connected folders",
  });
}
