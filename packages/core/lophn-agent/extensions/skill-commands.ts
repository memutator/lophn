import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { err, errorCode, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  type AgentId,
  type AgentWorkspace,
  skillsCheck,
  skillsList,
  workspaceKindOf,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import { resolveInWorkspace } from "../tools/file/scope.ts";
import type { WorkspaceScope } from "../tools/ports.ts";
import {
  parseProjectExtensions,
  type ProjectLayer,
  workspaceSkillsOf,
} from "./project-settings.ts";
import { checkSkill, type SkillCheckFiles } from "./skill-check.ts";
import {
  discoverSkills,
  joinPath,
  readSharedHeads,
  SHARED_ROOT_DIR,
  SHARED_SKILLS_DIR,
  type SharedFolder,
  sharedFor,
  SKILL_BODY_MAX_BYTES,
  SKILL_MANIFEST,
  type SkillFiles,
  skillReceived,
  type SkillSources,
} from "./skills.ts";

// `lophn skill list`와 `lophn skill check <path>`의 core memory handler다.
// core 프로세스의 module graph에는 동기 file API를 두지 않으므로, 필요한 폴더를 `node:fs/promises`로 비동기
// snapshot으로 읽은 뒤 런타임 발견기(`discoverSkills`)와 순수 검사기(`checkSkill`)에 그대로 넘긴다.

type EntryKind = "file" | "dir" | "symlink";

type ReadEntry = { text: string; complete: boolean };

function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

function normalizeKey(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  return (clean === "" ? path : clean).replaceAll("\\", "/");
}

async function lstatInfo(
  path: string,
): Promise<{ kind: EntryKind; size: number } | null> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return { kind: "symlink", size: info.size };
    if (info.isDirectory()) return { kind: "dir", size: info.size };
    if (info.isFile()) return { kind: "file", size: info.size };
    return null;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function readBoundedText(
  path: string,
  size: number,
  maxBytes: number,
): Promise<ReadEntry | null> {
  if (size > maxBytes) return { text: "", complete: false };
  try {
    return { text: await readFile(path, "utf8"), complete: true };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

// 단일 skill 폴더의 평탄한 1단계 snapshot을 비동기로 만든다(symlink는 따라가지 않는다).
export async function readSkillFolderSnapshot(
  dirPath: string,
): Promise<SkillCheckFiles> {
  const dir = dirPath.replace(/[\\/]+$/, "") || dirPath;
  const dirKey = normalizeKey(dir);
  const kinds = new Map<string, EntryKind>();
  const sizes = new Map<string, number>();
  const lists = new Map<string, string[]>();
  const reads = new Map<string, ReadEntry>();

  const rootInfo = await lstatInfo(dir).catch(() => null);
  if (rootInfo !== null) {
    kinds.set(dirKey, rootInfo.kind);
    sizes.set(dirKey, rootInfo.size);
    if (rootInfo.kind === "dir") {
      const names = await readdir(dir).catch(() => [] as string[]);
      lists.set(dirKey, names);
      for (const name of names) {
        const entryPath = joinPath(dir, name);
        const entryKey = normalizeKey(entryPath);
        const info = await lstatInfo(entryPath).catch(() => null);
        if (info === null) continue;
        kinds.set(entryKey, info.kind);
        sizes.set(entryKey, info.size);
        if (info.kind === "file" && name.endsWith(".md")) {
          const read = await readBoundedText(
            entryPath,
            info.size,
            SKILL_BODY_MAX_BYTES,
          ).catch(() => null);
          if (read !== null) reads.set(entryKey, read);
        }
      }
    }
  }

  return {
    list: (path) => lists.get(normalizeKey(path)) ?? null,
    kind: (path) => kinds.get(normalizeKey(path)) ?? null,
    size: (path) => sizes.get(normalizeKey(path)) ?? null,
    read: (path) => reads.get(normalizeKey(path)) ?? null,
  };
}

// `discoverSkills`와 `readSharedHeads`가 읽을 모든 출처 폴더의 비동기 snapshot을 만든다.
// `excludeDir`를 주면 그 폴더는 존재하지 않는 것으로 숨겨, 이미 저장된 skill이 덮는 하위 층을 찾을 수 있다.
export async function readSkillSourcesSnapshot(
  sources: Omit<SkillSources, "shared">,
  sharedFolders: readonly SharedFolder[] = [],
  excludeDir?: string,
): Promise<SkillFiles> {
  const excluded = excludeDir === undefined ? null : normalizeKey(excludeDir);
  const kinds = new Map<string, EntryKind>();
  const lists = new Map<string, string[]>();
  const reads = new Map<string, ReadEntry>();

  const recordManifest = async (bundle: string): Promise<void> => {
    const manifest = joinPath(bundle, SKILL_MANIFEST);
    const key = normalizeKey(manifest);
    if (kinds.has(key)) return;
    const info = await lstatInfo(manifest).catch(() => null);
    if (info === null) return;
    kinds.set(key, info.kind);
    if (info.kind !== "file") return;
    const read = await readBoundedText(
      manifest,
      info.size,
      SKILL_BODY_MAX_BYTES,
    ).catch(() => null);
    if (read !== null) reads.set(key, read);
  };

  const scanContainer = async (container: string): Promise<void> => {
    const containerKey = normalizeKey(container);
    if (kinds.has(containerKey)) return;
    const info = await lstatInfo(container).catch(() => null);
    if (info === null) return;
    kinds.set(containerKey, info.kind);
    if (info.kind !== "dir") return;
    const names = await readdir(container).catch(() => null);
    if (names === null) return;
    const kept: string[] = [];
    for (const name of names) {
      if (name.startsWith(".")) continue;
      if (name.includes("/") || name.includes("\\")) {
        kept.push(name);
        continue;
      }
      const bundle = joinPath(container, name);
      const bundleKey = normalizeKey(bundle);
      if (excluded !== null && bundleKey === excluded) continue;
      kept.push(name);
      const bundleInfo = await lstatInfo(bundle).catch(() => null);
      if (bundleInfo === null) continue;
      kinds.set(bundleKey, bundleInfo.kind);
      if (bundleInfo.kind === "dir") await recordManifest(bundle);
    }
    lists.set(containerKey, kept);
  };

  if (sources.bundled !== null) await scanContainer(sources.bundled);
  for (const root of sources.registered) {
    const rootKey = normalizeKey(root);
    if (excluded === null || rootKey !== excluded) {
      await recordManifest(root);
    }
    await scanContainer(root);
  }
  if (sources.personal !== null) await scanContainer(sources.personal);
  if (sources.workspace != null) await scanContainer(sources.workspace.folder);
  if (sources.workspaceData != null) await scanContainer(sources.workspaceData);

  for (const folder of sharedFolders) {
    const lophn = joinPath(folder.bundle, SHARED_ROOT_DIR);
    const skills = joinPath(folder.bundle, SHARED_SKILLS_DIR);
    for (const p of [lophn, skills]) {
      const k = normalizeKey(p);
      if (!kinds.has(k)) {
        const info = await lstatInfo(p).catch(() => null);
        if (info !== null) kinds.set(k, info.kind);
      }
    }
    for (const name of folder.names) {
      const dir = joinPath(skills, name);
      const dirKey = normalizeKey(dir);
      if (!kinds.has(dirKey)) {
        const info = await lstatInfo(dir).catch(() => null);
        if (info !== null) kinds.set(dirKey, info.kind);
      }
      if (kinds.get(dirKey) === "dir") await recordManifest(dir);
    }
  }

  return {
    list: (path) => {
      const k = normalizeKey(path);
      if (excluded !== null && k === excluded) return null;
      return lists.get(k) ?? null;
    },
    kind: (path) => {
      const k = normalizeKey(path);
      if (excluded !== null && k === excluded) return null;
      return kinds.get(k) ?? null;
    },
    read: (path) => {
      const k = normalizeKey(path);
      if (excluded !== null && k.startsWith(`${excluded}/`)) return null;
      return reads.get(k) ?? null;
    },
  };
}

function symlinkOnlySnapshot(dirPath: string): SkillCheckFiles {
  const dirKey = normalizeKey(dirPath);
  return {
    list: () => null,
    kind: (path) => (normalizeKey(path) === dirKey ? "symlink" : null),
    size: () => 0,
    read: () => null,
  };
}

export type SkillCommandDeps = {
  dataRoot: string;
  projectLayer: ProjectLayer;
  bundledSkillsRoot: string;
  globalSettings(): { roots: readonly string[]; off: readonly string[] };
  sessionInfo(session: string): Result<{
    agent: AgentId;
    workspace: AgentWorkspace | null;
    readScope: Pick<WorkspaceScope, "read" | "write" | "base" | "results">;
  } | null>;
  resolveProject(ref: string): Result<AgentWorkspace>;
  resolveApp(ref: string): Result<AgentWorkspace>;
  sourceFolder(workspace: AgentWorkspace): Result<string | null>;
  agentOwn(agent: AgentId): Result<{
    skills_off: readonly string[];
    apps: readonly string[];
  }>;
  sharedFolders(apps: readonly string[]): Result<readonly SharedFolder[]>;
};

const routeKey = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

function sameWorkspace(
  a: AgentWorkspace | null,
  b: AgentWorkspace | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.id === b.id;
}

async function readWorkspaceOff(file: string): Promise<readonly string[]> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > SKILL_BODY_MAX_BYTES) return [];
    const parsed = parseProjectExtensions(await readFile(file, "utf8"));
    return parsed.ok ? parsed.value.skills_off : [];
  } catch {
    return [];
  }
}

export function createSkillCommandHandlers(
  deps: SkillCommandDeps,
): readonly [string, MemoryHandler][] {
  const resolveTarget = (
    who: AuthenticatedContext,
    input: { project?: string; app?: string },
  ): Result<{
    workspace: AgentWorkspace | null;
    agent: AgentId | null;
    readScope: Pick<
      WorkspaceScope,
      "read" | "write" | "base" | "results"
    > | null;
  }> => {
    if (input.project !== undefined && input.app !== undefined) {
      return err({
        code: "invalid_input",
        message: "pass either project or app, not both",
      });
    }
    const actor = parseActor(who.actor);
    if (
      actor === undefined ||
      (actor.kind !== "user" && actor.kind !== "agent")
    ) {
      return err({
        code: "forbidden",
        message: "only a person or an agent can inspect skills",
      });
    }
    if (actor.kind === "agent") {
      const sessionId = who.conditions.session;
      if (sessionId === undefined) {
        return err({
          code: "forbidden",
          message: "agent session is required",
        });
      }
      const found = deps.sessionInfo(sessionId);
      if (!found.ok) return found;
      if (found.value === null) {
        return err({ code: "not_found", message: "session not found" });
      }
      if (input.project !== undefined || input.app !== undefined) {
        const requested =
          input.project !== undefined
            ? deps.resolveProject(input.project)
            : deps.resolveApp(input.app!);
        if (!requested.ok) return requested;
        if (!sameWorkspace(requested.value, found.value.workspace)) {
          return err({
            code: "forbidden",
            message: "an agent can only inspect skills in its own workspace",
          });
        }
      }
      return ok({
        workspace: found.value.workspace,
        agent: found.value.agent,
        readScope: found.value.readScope,
      });
    }
    if (input.project !== undefined) {
      const resolved = deps.resolveProject(input.project);
      if (!resolved.ok) return resolved;
      return ok({ workspace: resolved.value, agent: null, readScope: null });
    }
    if (input.app !== undefined) {
      const resolved = deps.resolveApp(input.app);
      if (!resolved.ok) return resolved;
      return ok({ workspace: resolved.value, agent: null, readScope: null });
    }
    return ok({ workspace: null, agent: null, readScope: null });
  };

  const discoverFor = async (
    target: { workspace: AgentWorkspace | null; agent: AgentId | null },
    excludeDir?: string,
  ) => {
    const { workspace, agent } = target;
    const global = deps.globalSettings();
    const own =
      agent === null
        ? { skills_off: [] as readonly string[], apps: [] as readonly string[] }
        : (() => {
            const read = deps.agentOwn(agent);
            return read.ok ? read.value : { skills_off: [], apps: [] };
          })();
    const source =
      workspace === null
        ? null
        : (() => {
            const read = deps.sourceFolder(workspace);
            return read.ok ? read.value : null;
          })();
    const sharedFolders =
      own.apps.length === 0
        ? []
        : (() => {
            const read = deps.sharedFolders(own.apps);
            return read.ok ? read.value : [];
          })();
    const root = deps.dataRoot.replace(/[\\/]+$/, "");
    const baseSources: Omit<SkillSources, "shared"> = {
      bundled: deps.bundledSkillsRoot,
      registered: global.roots,
      personal: `${root}/skills`,
      workspace: workspaceSkillsOf(deps.projectLayer, workspace, source),
      workspaceData: deps.projectLayer.workspaceDataSkillsFolder(
        root,
        workspace,
      ),
    };
    const snapshot = await readSkillSourcesSnapshot(
      baseSources,
      sharedFolders,
      excludeDir,
    );
    const shared = sharedFor(
      readSharedHeads(snapshot, sharedFolders),
      workspace,
    );
    const workspaceOff = await readWorkspaceOff(
      deps.projectLayer.extensionsFile(root, workspace),
    );
    const listing = discoverSkills(
      snapshot,
      { ...baseSources, shared },
      {
        kind: workspaceKindOf(workspace),
        off: [...new Set([...global.off, ...workspaceOff])],
      },
    );
    return {
      listing,
      agentSkillsOff: own.skills_off,
    };
  };

  const listHandler: MemoryHandler = async (who, raw) => {
    const parsed = skillsList.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid input" });
    }
    const target = resolveTarget(who, parsed.data);
    if (!target.ok) return target;
    try {
      const { listing, agentSkillsOff } = await discoverFor(target.value);
      return ok({
        skills: listing.entries.map((entry) => ({
          name: entry.name,
          description: entry.description,
          source: entry.source,
          enabled: entry.enabled && skillReceived(entry, agentSkillsOff),
          can_disable: entry.can_disable,
          path: entry.bundle_path,
        })),
        skipped: [...listing.skipped],
      });
    } catch {
      return err({
        code: "unavailable",
        message: "skills could not be listed",
      });
    }
  };

  const checkHandler: MemoryHandler = async (who, raw) => {
    const parsed = skillsCheck.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid input" });
    }
    const target = resolveTarget(who, parsed.data);
    if (!target.ok) return target;

    const rawPath = parsed.data.path;
    let checkPath: string;
    if (target.value.readScope !== null) {
      const scope = target.value.readScope;
      const base = scope.base ?? scope.read[0];
      if (!isAbsolute(rawPath) && base === undefined) {
        return err({
          code: "forbidden",
          message: "path is outside the workspace",
        });
      }
      const candidate = normalize(
        isAbsolute(rawPath) ? rawPath : join(base!, rawPath),
      );
      const selfStat = await lstat(candidate).catch(() => null);
      if (selfStat?.isSymbolicLink()) {
        // symlink는 따라가지 않고, 놓인 부모 폴더가 읽기 범위 안일 때만 symlink_forbidden 검사 결과를 낸다.
        const parentAllowed = await resolveInWorkspace(
          scope,
          dirname(candidate),
          "read",
        );
        if (!parentAllowed.ok) return parentAllowed;
        return ok(checkSkill(candidate, symlinkOnlySnapshot(candidate)));
      }
      const allowed = await resolveInWorkspace(scope, candidate, "read");
      if (!allowed.ok) return allowed;
      checkPath = allowed.value.path;
    } else {
      if (!isAbsolute(rawPath)) {
        return err({
          code: "invalid_input",
          message: "skill path must be an absolute path",
        });
      }
      checkPath = normalize(rawPath);
    }

    try {
      const folderSnapshot = await readSkillFolderSnapshot(checkPath);
      const { listing } = await discoverFor(target.value, checkPath);
      return ok(
        checkSkill(checkPath, folderSnapshot, { existing: listing.entries }),
      );
    } catch {
      return err({
        code: "unavailable",
        message: "skill could not be checked",
      });
    }
  };

  return [
    [routeKey(skillsList), listHandler],
    [routeKey(skillsCheck), checkHandler],
  ];
}
