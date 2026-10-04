import { err, ok, type Result } from "../../base/mod.ts";
import {
  absolutePathSchema,
  type Folder,
} from "../../contracts/documents/mod.ts";

// absolutePathSchema는 모양만 검사한다. OS realpath·alias·symlink의 진실은
// command 밖 trusted host/worker가 canonical root를 준비할 책임이다.
export type CanonicalRoot = string;

export type PathStyle = "posix" | "windows" | "unc";

const DRIVE = /^[A-Za-z]:[\\/]/;
const UNC = /^\\\\[^\\]+\\[^\\]+/;

export function pathStyle(path: CanonicalRoot): Result<PathStyle> {
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

export function rootsOverlap(
  left: CanonicalRoot,
  right: CanonicalRoot,
): Result<boolean> {
  const relation = rootRelation(left, right);
  if (!relation.ok) return relation;
  return ok(relation.value !== "disjoint");
}

export type RegisteredRoot = {
  project: string;
  path: CanonicalRoot;
  enabled: boolean;
};

export function overlappingEnabledRoots(
  roots: readonly RegisteredRoot[],
): Result<readonly [RegisteredRoot, RegisteredRoot] | null> {
  for (let left = 0; left < roots.length; left++) {
    const current = roots[left]!;
    if (!current.enabled) continue;
    const canonical = rootRelation(current.path, current.path);
    if (!canonical.ok) return canonical;
    for (let right = left + 1; right < roots.length; right++) {
      const other = roots[right]!;
      if (!other.enabled) continue;
      const overlap = rootsOverlap(current.path, other.path);
      if (!overlap.ok) return overlap;
      if (overlap.value) return ok([current, other]);
    }
  }
  return ok(null);
}

// 꺼진 tracking의 중첩 root도 후보에 넣는다. 내용으로 재연결하지 않는다.
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

export function validateFolderRoots(folders: readonly Folder[]): Result<void> {
  for (let left = 0; left < folders.length; left++) {
    const current = folders[left]!;
    const canonical = rootRelation(current.path, current.path);
    if (!canonical.ok) return canonical;
    for (let right = left + 1; right < folders.length; right++) {
      const relation = rootRelation(current.path, folders[right]!.path);
      if (!relation.ok) return relation;
      if (relation.value === "equal") {
        return err({ code: "invalid_input", message: "duplicate folder root" });
      }
    }
  }
  return ok(undefined);
}
