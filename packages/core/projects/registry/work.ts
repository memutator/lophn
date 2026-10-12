import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  Folder,
  TrackingPreview,
  TrackingRuleSet,
} from "../../../protocol/projects/mod.ts";
import { relativePathSchema } from "../../../protocol/projects/mod.ts";
import { LOPHN_DATA_DIR } from "./rules.ts";
import { decideTracking, type GitignoreRule } from "./rules.ts";
import { symlinkEscapesRoot } from "./rules.ts";

export const PREVIEW_PAGE = 200;

export type DirectoryEntry = {
  name: string;
  kind: "file" | "directory" | "symlink" | "other";
  // symlink가 가리키는 종류. 디렉터리면 순회하지 않고 통째로 판정한다.
  targetKind?: "file" | "directory";
  // symlink일 때만. host가 푼 실제 경로다. 없으면 탈출로 본다.
  realPath?: string;
};

// documents worker가 채울 자리다. 지금은 주입만 받는다.
export type RootScanner = {
  list(
    root: string,
    directory: string,
  ): Result<readonly DirectoryEntry[]>;
  // 디렉터리의 .gitignore 본문. 없으면 null.
  gitignore(root: string, directory: string): Result<string | null>;
};

export type PreviewRequest = {
  project: string;
  baseRevision: string;
  folders: readonly Folder[];
  tracking: TrackingRuleSet;
  observedAt: string;
  cursor?: string;
};

function decodeCursor(cursor: string | undefined): Result<number> {
  if (cursor === undefined) return ok(0);
  try {
    const parsed = JSON.parse(cursor) as { offset?: unknown };
    if (
      typeof parsed?.offset !== "number" ||
      !Number.isSafeInteger(parsed.offset) || parsed.offset < 0
    ) {
      return err({ code: "invalid_input", message: "invalid preview cursor" });
    }
    return ok(parsed.offset);
  } catch {
    return err({ code: "invalid_input", message: "invalid preview cursor" });
  }
}

function joinRelative(directory: string, name: string): string {
  return directory === "" ? name : `${directory}/${name}`;
}

function byName(left: DirectoryEntry, right: DirectoryEntry): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function entryDecision(
  root: string,
  relative: string,
  entry: DirectoryEntry,
  tracking: TrackingRuleSet,
  gitignore: readonly GitignoreRule[],
): Result<{ included: boolean; reason: string; escapes: boolean }> {
  let escapes = false;
  if (entry.kind === "symlink") {
    const real = entry.realPath;
    const outside = real === undefined
      ? ok(true)
      : symlinkEscapesRoot(root, real);
    if (!outside.ok) return outside;
    escapes = outside.value;
  }
  const decision = decideTracking({
    relativePath: relative,
    patterns: tracking.patterns,
    useGitignore: tracking.use_gitignore,
    gitignore,
    escapesRoot: escapes,
    enabled: tracking.enabled,
  });
  if (!decision.ok) return decision;
  return ok({ ...decision.value, escapes });
}

// .git·lophn data 안은 파일을 결과에 남기되 전부 제외한다. symlink는 따라가지 않는다.
function collectBlocked(
  scanner: RootScanner,
  root: string,
  directory: string,
  reason: string,
): Result<TrackingPreview["entries"]> {
  const entries: TrackingPreview["entries"] = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const listed = scanner.list(root, current);
    if (!listed.ok) return listed;
    for (const entry of [...listed.value].sort(byName)) {
      const relative = joinRelative(current, entry.name);
      if (entry.kind === "directory") {
        pending.push(relative);
        continue;
      }
      if (!relativePathSchema.safeParse(relative).success) {
        return err({ code: "invalid_input", message: "invalid relative path" });
      }
      entries.push({
        folder_path: root,
        path: relative,
        included: false,
        reason,
      });
    }
  }
  return ok(entries);
}

// 한 root를 깊이 우선으로 돈다. symlink 디렉터리는 들어가지 않는다.
function scanRoot(
  scanner: RootScanner,
  root: string,
  tracking: TrackingRuleSet,
  gitignore: GitignoreRule[],
): Result<TrackingPreview["entries"]> {
  const entries: TrackingPreview["entries"] = [];
  const pending = [""];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const listed = scanner.list(root, directory);
    if (!listed.ok) return listed;
    for (const entry of [...listed.value].sort(byName)) {
      const relative = joinRelative(directory, entry.name);
      if (
        entry.kind === "directory" &&
        (entry.name === ".git" || entry.name === LOPHN_DATA_DIR)
      ) {
        const blocked = collectBlocked(
          scanner,
          root,
          relative,
          entry.name === ".git" ? "inside .git" : "inside lophn data",
        );
        if (!blocked.ok) return blocked;
        entries.push(...blocked.value);
        continue;
      }
      const decision = entryDecision(
        root,
        relative,
        entry,
        tracking,
        gitignore,
      );
      if (!decision.ok) return decision;
      const directoryLink = entry.kind === "symlink" &&
        entry.targetKind === "directory";
      if (entry.kind === "directory" && !decision.value.escapes) {
        const text = scanner.gitignore(root, relative);
        if (!text.ok) return text;
        if (text.value !== null) {
          gitignore.push({ directory: relative, text: text.value });
        }
        pending.push(relative);
        continue;
      }
      if (directoryLink || entry.kind === "directory") {
        // 밖을 가리키는 디렉터리 symlink는 들어가지 않고 그 자체만 제외한다.
        if (!relativePathSchema.safeParse(relative).success) {
          return err({
            code: "invalid_input",
            message: "invalid relative path",
          });
        }
        entries.push({
          folder_path: root,
          path: relative,
          included: false,
          reason: decision.value.reason,
        });
        continue;
      }
      if (entry.kind === "other") continue;
      if (!relativePathSchema.safeParse(relative).success) {
        return err({ code: "invalid_input", message: "invalid relative path" });
      }
      entries.push({
        folder_path: root,
        path: relative,
        included: decision.value.included,
        reason: decision.value.reason,
      });
    }
  }
  return ok(entries);
}

export function previewTracking(
  scanner: RootScanner,
  request: PreviewRequest,
): Result<TrackingPreview> {
  const offset = decodeCursor(request.cursor);
  if (!offset.ok) return offset;
  const collected: TrackingPreview["entries"] = [];
  for (const folder of request.folders) {
    const rootIgnore = scanner.gitignore(folder.path, "");
    if (!rootIgnore.ok) return rootIgnore;
    const rules: GitignoreRule[] = rootIgnore.value === null
      ? []
      : [{ directory: "", text: rootIgnore.value }];
    const scanned = scanRoot(scanner, folder.path, request.tracking, rules);
    if (!scanned.ok) return scanned;
    collected.push(...scanned.value);
  }
  const page = collected.slice(offset.value, offset.value + PREVIEW_PAGE);
  const next = offset.value + PREVIEW_PAGE;
  const complete = next >= collected.length;
  return ok({
    project: request.project,
    base_revision: request.baseRevision,
    folders: [...request.folders],
    tracking: request.tracking,
    observed_at: request.observedAt,
    entries: page,
    complete,
    next_cursor: complete ? null : JSON.stringify({ offset: next }),
  });
}
