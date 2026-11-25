import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import {
  FLOW_SDK_VERSION,
  WORKFLOW_ARTIFACT_ENTRY,
  WORKFLOW_DECLARATION_FILE,
  WORKFLOW_EXPORT_MAX_FILES,
  WORKFLOW_EXPORT_MAX_TOTAL_BYTES,
  WORKFLOW_FLOW_FILE,
  type WorkflowExportFile,
  workflowArtifactFolder,
  workflowFolder,
  workflowNameSchema,
  workflowsFolder,
} from "../../../../protocol/workflows/mod.ts";
import { compareVersion } from "../../../workflows/declaration.ts";
import type {
  DefinitionFile,
  FlowSdkInfo,
  WorkflowFiles,
} from "../../../workflows/ports.ts";

const BUNDLED_FLOW_PACKAGE = new URL(
  "../../../../sdk/flow/package.json",
  import.meta.url,
);

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function readDeclaration(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function readFlowSdkManifest(
  path: string | URL,
  fallbackVersion?: string,
): Promise<FlowSdkInfo | null> {
  try {
    const manifest = JSON.parse(await readFile(path, "utf8")) as {
      version?: unknown;
      lophn?: { supported_from?: unknown };
    };
    const current =
      typeof manifest.version === "string" &&
      /^\d+\.\d+\.\d+$/.test(manifest.version)
        ? manifest.version
        : fallbackVersion;
    if (current === undefined) return null;
    const supported = manifest.lophn?.supported_from;
    const supported_from =
      typeof supported === "string" && /^\d+\.\d+\.\d+$/.test(supported)
        ? supported
        : current;
    return { current, supported_from };
  } catch {
    return null;
  }
}

// `<dataRoot>/sdk/flow/<newest>/package.json`에서 최신 판과 지원 하한을 읽는다.
// 설치 사본이 없으면 동봉 `packages/sdk/flow/package.json`, 그마저 없으면 상수로 물러난다.
export async function readInstalledFlowSdkInfo(
  dataRoot: string,
): Promise<FlowSdkInfo> {
  try {
    const entries = await readdir(`${dataRoot}/sdk/flow`, {
      withFileTypes: true,
    });
    const newest = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareVersion)
      .at(-1);
    if (newest !== undefined) {
      const fromDataRoot = await readFlowSdkManifest(
        `${dataRoot}/sdk/flow/${newest}/package.json`,
        newest,
      );
      if (fromDataRoot !== null) return fromDataRoot;
    }
  } catch {
    // fallback below
  }
  const bundled = await readFlowSdkManifest(BUNDLED_FLOW_PACKAGE);
  if (bundled !== null) return bundled;
  return { current: FLOW_SDK_VERSION, supported_from: FLOW_SDK_VERSION };
}

// ---------- workspace layout (`<dataRoot>/shell/workspaces/<prj>.json`) 갱신 ----------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function remapNodeKeys(
  node: unknown,
  keyMap: ReadonlyMap<string, string>,
): unknown {
  if (!isRecord(node)) return node;
  if (typeof node["tab"] === "string") {
    const nextTab = keyMap.get(node["tab"]) ?? node["tab"];
    const stack = Array.isArray(node["stack"])
      ? node["stack"].map((item) =>
          typeof item === "string" ? (keyMap.get(item) ?? item) : item,
        )
      : undefined;
    return stack === undefined
      ? { ...node, tab: nextTab }
      : { ...node, tab: nextTab, stack };
  }
  return {
    ...node,
    a: remapNodeKeys(node["a"], keyMap),
    b: remapNodeKeys(node["b"], keyMap),
  };
}

function leavesIn(node: unknown): string[] {
  if (!isRecord(node)) return [];
  if (typeof node["tab"] === "string") return [node["tab"]];
  return [...leavesIn(node["a"]), ...leavesIn(node["b"])];
}

function hiddenIn(node: unknown): string[] {
  if (!isRecord(node)) return [];
  if (typeof node["tab"] === "string") {
    return Array.isArray(node["stack"])
      ? node["stack"].filter(
          (key): key is string =>
            typeof key === "string" && key !== node["tab"],
        )
      : [];
  }
  return [...hiddenIn(node["a"]), ...hiddenIn(node["b"])];
}

function pruneLeaf(
  leaf: Record<string, unknown>,
  keptKeys: ReadonlySet<string>,
): unknown {
  const tab = typeof leaf["tab"] === "string" ? leaf["tab"] : null;
  if (tab === null) return null;
  if (!Array.isArray(leaf["stack"])) {
    return keptKeys.has(tab) ? leaf : null;
  }
  const all = leaf["stack"].filter((k): k is string => typeof k === "string");
  const stack = all.filter((k) => keptKeys.has(k));
  if (stack.length === all.length) return leaf;
  if (stack.length === 0) return null;
  const at = all.indexOf(tab);
  const nextTab = keptKeys.has(tab)
    ? tab
    : (all.slice(at + 1).find((k) => keptKeys.has(k)) ??
      all.slice(0, at).findLast((k) => keptKeys.has(k)));
  const { stack: _old, ...rest } = leaf;
  return stack.length < 2
    ? { ...rest, tab: nextTab }
    : { ...rest, tab: nextTab, stack };
}

function pruneGroups(
  groups: unknown[],
  keptKeys: ReadonlySet<string>,
): unknown[] {
  const prune = (node: unknown): unknown => {
    if (!isRecord(node)) return node;
    if ("tab" in node) return pruneLeaf(node, keptKeys);
    const a = prune(node["a"]);
    const b = prune(node["b"]);
    if (a === null) return b;
    if (b === null) return a;
    return a === node["a"] && b === node["b"] ? node : { ...node, a, b };
  };
  return groups.flatMap((group) => {
    if (!isRecord(group)) return [group];
    const layout = prune(group["layout"]);
    if (layout === null) return [];
    const leaves = leavesIn(layout);
    if (leaves.length === 0) return [];
    if (leaves.length < 2 && hiddenIn(layout).length === 0) return [];
    const focus =
      typeof group["focus"] === "string" && leaves.includes(group["focus"])
        ? group["focus"]
        : leaves[0];
    return [{ ...group, layout, focus }];
  });
}

function glueGroupTabs(tabs: unknown[], groups: unknown[]): unknown[] {
  const keyOf = (tab: unknown) =>
    isRecord(tab) && typeof tab["key"] === "string" ? tab["key"] : null;
  const owner = new Map<string, string[]>();
  for (const group of groups) {
    if (!isRecord(group)) continue;
    const members = [
      ...leavesIn(group["layout"]),
      ...hiddenIn(group["layout"]),
    ];
    for (const key of members) owner.set(key, members);
  }
  const byKey = new Map<string, unknown>();
  for (const tab of tabs) {
    const k = keyOf(tab);
    if (k !== null) byKey.set(k, tab);
  }
  const done = new Set<string[]>();
  return tabs.flatMap((tab) => {
    const k = keyOf(tab);
    const members = k === null ? undefined : owner.get(k);
    if (members === undefined) return [tab];
    if (done.has(members)) return [];
    done.add(members);
    return members.flatMap((key) => (byKey.has(key) ? [byKey.get(key)] : []));
  });
}

/** workflow 이름 변경 시 `<prj>.json`의 desk key·label·workflow 칸과 `workflow:<from>` 탭 참조를 새 이름으로 바꾼다. */
export function renameWorkflowInLayoutText(
  text: string,
  from: string,
  to: string,
): string | null {
  let layout: unknown;
  try {
    layout = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(layout) || !isRecord(layout["desks"])) return null;
  const oldDesks = layout["desks"];
  const nextDesks: Record<string, unknown> = {};
  let changed = false;

  for (const [deskKey, rawDesk] of Object.entries(oldDesks)) {
    let nextKey = deskKey;
    const desk = isRecord(rawDesk) ? { ...rawDesk } : rawDesk;
    if (isRecord(desk) && (deskKey === from || desk["workflow"] === from)) {
      if (deskKey === from && !Object.hasOwn(oldDesks, to)) {
        nextKey = to;
        changed = true;
      }
      if (desk["workflow"] === from) {
        desk["workflow"] = to;
        changed = true;
      }
      if (desk["label"] === from) {
        desk["label"] = to;
        changed = true;
      }
      if (layout["active_desk"] === deskKey && nextKey !== deskKey) {
        layout["active_desk"] = nextKey;
        changed = true;
      }
    }
    nextDesks[nextKey] = desk;
  }

  for (const desk of Object.values(nextDesks)) {
    if (!isRecord(desk)) continue;
    const existingKeys = new Set<string>();
    const collectKey = (tab: unknown) => {
      if (isRecord(tab) && typeof tab["key"] === "string") {
        existingKeys.add(tab["key"]);
      }
    };
    if (Array.isArray(desk["tabs"])) desk["tabs"].forEach(collectKey);
    if (Array.isArray(desk["floats"])) {
      for (const item of desk["floats"]) {
        if (isRecord(item)) collectKey(item["tab"]);
      }
    }
    if (Array.isArray(desk["detached"])) {
      for (const item of desk["detached"]) {
        if (isRecord(item)) collectKey(item["tab"]);
      }
    }

    const keyMap = new Map<string, string>();
    const rewriteTab = (tab: unknown): unknown => {
      if (!isRecord(tab)) return tab;
      if (tab["kind"] === "workflow" && tab["workflow"] === from) {
        const next: Record<string, unknown> = { ...tab, workflow: to };
        const oldKey = typeof tab["key"] === "string" ? tab["key"] : null;
        const targetKey =
          oldKey === `workflow:${from}` ? `workflow:${to}` : oldKey;
        if (
          oldKey !== null &&
          targetKey !== null &&
          targetKey !== oldKey &&
          !existingKeys.has(targetKey)
        ) {
          next["key"] = targetKey;
          keyMap.set(oldKey, targetKey);
          existingKeys.add(targetKey);
        }
        changed = true;
        return next;
      }
      if (tab["kind"] === "artifact" && tab["workflow"] === from) {
        const next: Record<string, unknown> = { ...tab, workflow: to };
        const oldKey = typeof tab["key"] === "string" ? tab["key"] : null;
        const targetKey =
          oldKey !== null ? oldKey.replace(`:${from}:`, `:${to}:`) : null;
        if (
          oldKey !== null &&
          targetKey !== null &&
          targetKey !== oldKey &&
          !existingKeys.has(targetKey)
        ) {
          next["key"] = targetKey;
          keyMap.set(oldKey, targetKey);
          existingKeys.add(targetKey);
        }
        changed = true;
        return next;
      }
      return tab;
    };

    if (Array.isArray(desk["tabs"])) {
      desk["tabs"] = desk["tabs"].map(rewriteTab);
    }
    if (Array.isArray(desk["floats"])) {
      desk["floats"] = desk["floats"].map((item) =>
        isRecord(item) ? { ...item, tab: rewriteTab(item["tab"]) } : item,
      );
    }
    if (Array.isArray(desk["detached"])) {
      desk["detached"] = desk["detached"].map((item) =>
        isRecord(item) ? { ...item, tab: rewriteTab(item["tab"]) } : item,
      );
    }
    if (keyMap.size > 0) {
      if (
        typeof desk["selected_tab"] === "string" &&
        keyMap.has(desk["selected_tab"])
      ) {
        desk["selected_tab"] = keyMap.get(desk["selected_tab"]);
      }
      if (Array.isArray(desk["groups"])) {
        desk["groups"] = desk["groups"].map((group) => {
          if (!isRecord(group)) return group;
          const focus =
            typeof group["focus"] === "string"
              ? (keyMap.get(group["focus"]) ?? group["focus"])
              : group["focus"];
          return {
            ...group,
            focus,
            layout: remapNodeKeys(group["layout"], keyMap),
          };
        });
      }
    }
  }

  if (!changed) return null;
  layout["desks"] = nextDesks;
  return JSON.stringify(layout);
}

/** workflow 삭제 시 `<prj>.json`에서 해당 workflow desk와 `workflow:<name>` 탭·group 참조를 깨끗이 지운다. */
export function removeWorkflowFromLayoutText(
  text: string,
  name: string,
): string | null {
  let layout: unknown;
  try {
    layout = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(layout) || !isRecord(layout["desks"])) return null;
  const oldDesks = layout["desks"];
  const nextDesks: Record<string, unknown> = {};
  let changed = false;

  for (const [deskKey, desk] of Object.entries(oldDesks)) {
    const isTargetDesk =
      deskKey !== "_default" &&
      (deskKey === name || (isRecord(desk) && desk["workflow"] === name));
    if (isTargetDesk) {
      changed = true;
      continue;
    }
    nextDesks[deskKey] = isRecord(desk) ? { ...desk } : desk;
  }

  if (
    typeof layout["active_desk"] === "string" &&
    !Object.hasOwn(nextDesks, layout["active_desk"])
  ) {
    layout["active_desk"] = Object.hasOwn(nextDesks, "_default")
      ? "_default"
      : (Object.keys(nextDesks)[0] ?? "_default");
    changed = true;
  }

  const isTargetTab = (tab: unknown): boolean =>
    isRecord(tab) &&
    ((tab["kind"] === "workflow" && tab["workflow"] === name) ||
      (tab["kind"] === "artifact" && tab["workflow"] === name));

  for (const desk of Object.values(nextDesks)) {
    if (
      !isRecord(desk) ||
      !Array.isArray(desk["tabs"]) ||
      !Array.isArray(desk["floats"]) ||
      !Array.isArray(desk["detached"])
    ) {
      continue;
    }
    const keptTabs = desk["tabs"].filter((tab) => !isTargetTab(tab));
    const keptFloats = desk["floats"].filter(
      (item) => !(isRecord(item) && isTargetTab(item["tab"])),
    );
    const keptDetached = desk["detached"].filter(
      (item) => !(isRecord(item) && isTargetTab(item["tab"])),
    );
    if (
      keptTabs.length === desk["tabs"].length &&
      keptFloats.length === desk["floats"].length &&
      keptDetached.length === desk["detached"].length
    ) {
      continue;
    }
    changed = true;
    const keptKeys = new Set<string>(
      keptTabs
        .filter((tab): tab is Record<string, unknown> => isRecord(tab))
        .map((tab) => tab["key"])
        .filter((k): k is string => typeof k === "string"),
    );
    const groups = pruneGroups(
      Array.isArray(desk["groups"]) ? desk["groups"] : [],
      keptKeys,
    );
    const gluedTabs = glueGroupTabs(keptTabs, groups);
    const hidden = new Set(
      groups.flatMap((group) =>
        isRecord(group) ? hiddenIn(group["layout"]) : [],
      ),
    );
    const selected = desk["selected_tab"];
    if (
      typeof selected === "string" &&
      (!keptKeys.has(selected) || hidden.has(selected))
    ) {
      const next = gluedTabs.find(
        (tab) =>
          isRecord(tab) &&
          typeof tab["key"] === "string" &&
          !hidden.has(tab["key"]),
      );
      desk["selected_tab"] = isRecord(next) ? next["key"] : null;
    }
    desk["tabs"] = gluedTabs;
    desk["floats"] = keptFloats;
    desk["detached"] = keptDetached;
    desk["groups"] = groups;
  }

  if (!changed) return null;
  layout["desks"] = nextDesks;
  return JSON.stringify(layout);
}

async function rewriteWorkspaceLayout(
  dataRoot: string,
  project: string,
  convert: (text: string) => string | null,
): Promise<void> {
  const path = `${dataRoot}/shell/workspaces/${project}.json`;
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (thrown) {
    if (errorCode(thrown) === "ENOENT") return;
    return;
  }
  const next = convert(text);
  if (next === null) return;
  try {
    const mode = await stat(path).then((found) => found.mode & 0o777);
    await writeFile(`${path}.tmp`, next, { mode });
    await rename(`${path}.tmp`, path);
  } catch {
    // 창 layout 갱신 실패가 workflow 변경 자체를 되돌리지 않는다.
  }
}

export function updateWorkspaceLayoutForWorkflowRename(
  dataRoot: string,
  project: string,
  from: string,
  to: string,
): Promise<void> {
  return rewriteWorkspaceLayout(dataRoot, project, (text) =>
    renameWorkflowInLayoutText(text, from, to),
  );
}

export function updateWorkspaceLayoutForWorkflowDelete(
  dataRoot: string,
  project: string,
  name: string,
): Promise<void> {
  return rewriteWorkspaceLayout(dataRoot, project, (text) =>
    removeWorkflowFromLayoutText(text, name),
  );
}

const EXPORT_EXCLUDED_DIRS = new Set(["node_modules", ".git"]);
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isSafeExportPath(rel: string): boolean {
  if (rel.length === 0 || rel.includes("\0") || rel.includes("\\")) {
    return false;
  }
  if (rel.startsWith("/") || rel.endsWith("/")) return false;
  const parts = rel.split("/");
  return parts.every(
    (part) =>
      part !== "" &&
      part !== "." &&
      part !== ".." &&
      !EXPORT_EXCLUDED_DIRS.has(part),
  );
}

// symlink 폴더는 isDirectory()가 거짓이라 data root 밖을 가리키는 폴더가 빠진다.
export function createWorkflowFiles(dataRoot: string): WorkflowFiles {
  async function verifyInsideWorkflowsRoot(
    project: string,
    dir: string,
  ): Promise<Result<void>> {
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(dir);
    } catch {
      return err({ code: "not_found", message: "workflow not found" });
    }
    if (info.isSymbolicLink()) {
      return err({
        code: "forbidden",
        message: "workflow folder is a symbolic link",
      });
    }
    if (!info.isDirectory()) {
      return err({ code: "not_found", message: "workflow not found" });
    }
    try {
      const base = await realpath(workflowsFolder(dataRoot, project));
      const real = await realpath(dir);
      if (!real.startsWith(base + sep)) {
        return err({
          code: "forbidden",
          message: "workflow folder is outside workflows directory",
        });
      }
    } catch {
      return err({ code: "not_found", message: "workflow not found" });
    }
    return ok(undefined);
  }

  return {
    async list(project) {
      const names: string[] = [];
      try {
        for (const e of await readdir(workflowsFolder(dataRoot, project), {
          withFileTypes: true,
        })) {
          if (e.isDirectory() && workflowNameSchema.safeParse(e.name).success) {
            names.push(e.name);
          }
        }
      } catch (e) {
        if (errorCode(e) !== "ENOENT") {
          return err({
            code: "unavailable",
            message: "workflows folder could not be read",
          });
        }
      }
      names.sort();
      const files: DefinitionFile[] = [];
      for (const name of names) {
        const entry = (view: "static" | "instance") =>
          isFile(
            `${workflowArtifactFolder(
              dataRoot,
              project,
              name,
              view,
            )}/${WORKFLOW_ARTIFACT_ENTRY}`,
          );
        files.push({
          name,
          declaration: await readDeclaration(
            `${workflowFolder(
              dataRoot,
              project,
              name,
            )}/${WORKFLOW_DECLARATION_FILE}`,
          ),
          flow: await isFile(
            `${workflowFolder(dataRoot, project, name)}/${WORKFLOW_FLOW_FILE}`,
          ),
          artifacts: {
            static: await entry("static"),
            instance: await entry("instance"),
          },
        });
      }
      return ok(files);
    },

    flowSdkInfo: () => readInstalledFlowSdkInfo(dataRoot),

    async rename(project, from, to) {
      if (
        !workflowNameSchema.safeParse(from).success ||
        !workflowNameSchema.safeParse(to).success
      ) {
        return err({
          code: "invalid_input",
          message: "invalid workflow name",
        });
      }
      const fromDir = workflowFolder(dataRoot, project, from);
      const toDir = workflowFolder(dataRoot, project, to);
      const verified = await verifyInsideWorkflowsRoot(project, fromDir);
      if (!verified.ok) return verified;
      const targetExists = await lstat(toDir).then(
        () => true,
        () => false,
      );
      if (targetExists) {
        return err({
          code: "conflict",
          message: `workflow '${to}' already exists`,
        });
      }
      try {
        await rename(fromDir, toDir);
      } catch (e) {
        const code = errorCode(e);
        if (code === "EEXIST" || code === "ENOTEMPTY") {
          return err({
            code: "conflict",
            message: `workflow '${to}' already exists`,
          });
        }
        return err({
          code: "unavailable",
          message: "could not rename workflow folder",
        });
      }
      return ok(undefined);
    },

    async remove(project, name) {
      if (!workflowNameSchema.safeParse(name).success) {
        return err({
          code: "invalid_input",
          message: "invalid workflow name",
        });
      }
      const dir = workflowFolder(dataRoot, project, name);
      const verified = await verifyInsideWorkflowsRoot(project, dir);
      if (!verified.ok) return verified;
      try {
        await rm(dir, { recursive: true });
      } catch {
        return err({
          code: "unavailable",
          message: "could not delete workflow folder",
        });
      }
      return ok(undefined);
    },

    async exportBundle(project, name) {
      if (!workflowNameSchema.safeParse(name).success) {
        return err({
          code: "invalid_input",
          message: "invalid workflow name",
        });
      }
      const rootDir = workflowFolder(dataRoot, project, name);
      const verified = await verifyInsideWorkflowsRoot(project, rootDir);
      if (!verified.ok) return verified;

      const discovered: { rel: string; abs: string }[] = [];
      async function walk(
        relDir: string,
        absDir: string,
      ): Promise<Result<void>> {
        let entries;
        try {
          entries = await readdir(absDir, { withFileTypes: true });
        } catch {
          return err({
            code: "unavailable",
            message: "workflow folder could not be read",
          });
        }
        entries.sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        );
        for (const entry of entries) {
          if (entry.isSymbolicLink()) continue;
          const nextRel =
            relDir === "" ? entry.name : `${relDir}/${entry.name}`;
          const nextAbs = `${absDir}/${entry.name}`;
          if (entry.isDirectory()) {
            if (EXPORT_EXCLUDED_DIRS.has(entry.name)) continue;
            const nested = await walk(nextRel, nextAbs);
            if (!nested.ok) return nested;
            continue;
          }
          if (!entry.isFile()) continue;
          if (discovered.length >= WORKFLOW_EXPORT_MAX_FILES) {
            return err({
              code: "invalid_input",
              message: `workflow exceeds maximum of ${WORKFLOW_EXPORT_MAX_FILES} files`,
            });
          }
          discovered.push({ rel: posix.normalize(nextRel), abs: nextAbs });
        }
        return ok(undefined);
      }

      const walked = await walk("", rootDir);
      if (!walked.ok) return walked;
      discovered.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
      if (discovered.length === 0) {
        return err({
          code: "not_found",
          message: "workflow folder has no files to export",
        });
      }

      const files: WorkflowExportFile[] = [];
      let totalBytes = 0;
      for (const item of discovered) {
        let bytes: Buffer;
        try {
          bytes = await readFile(item.abs);
        } catch {
          return err({
            code: "unavailable",
            message: `could not read workflow file ${item.rel}`,
          });
        }
        totalBytes += bytes.byteLength;
        if (totalBytes > WORKFLOW_EXPORT_MAX_TOTAL_BYTES) {
          return err({
            code: "invalid_input",
            message: `workflow exceeds maximum export size of ${WORKFLOW_EXPORT_MAX_TOTAL_BYTES} bytes`,
          });
        }
        files.push({
          path: item.rel,
          content_base64: bytes.toString("base64"),
        });
      }
      return ok(files);
    },

    async importBundle(project, name, files, options) {
      if (!workflowNameSchema.safeParse(name).success) {
        return err({
          code: "invalid_input",
          message: "invalid workflow name",
        });
      }
      if (files.length === 0 || files.length > WORKFLOW_EXPORT_MAX_FILES) {
        return err({
          code: "invalid_input",
          message: `workflow import must contain 1 to ${WORKFLOW_EXPORT_MAX_FILES} files`,
        });
      }

      const decoded: { rel: string; bytes: Buffer }[] = [];
      const seenPaths = new Set<string>();
      const dirPrefixes = new Set<string>();
      let totalBytes = 0;
      for (const file of files) {
        if (!isSafeExportPath(file.path)) {
          return err({
            code: "invalid_input",
            message: `invalid workflow file path: ${file.path}`,
          });
        }
        const normalized = posix.normalize(file.path);
        if (normalized !== file.path || seenPaths.has(normalized)) {
          return err({
            code: "invalid_input",
            message: `duplicate or non-canonical workflow file path: ${file.path}`,
          });
        }
        if (!BASE64_PATTERN.test(file.content_base64)) {
          return err({
            code: "invalid_input",
            message: `invalid base64 content for ${file.path}`,
          });
        }
        const bytes = Buffer.from(file.content_base64, "base64");
        totalBytes += bytes.byteLength;
        if (totalBytes > WORKFLOW_EXPORT_MAX_TOTAL_BYTES) {
          return err({
            code: "invalid_input",
            message: `workflow import exceeds maximum size of ${WORKFLOW_EXPORT_MAX_TOTAL_BYTES} bytes`,
          });
        }
        seenPaths.add(normalized);
        const parts = normalized.split("/");
        for (let i = 1; i < parts.length; i += 1) {
          dirPrefixes.add(parts.slice(0, i).join("/"));
        }
        decoded.push({ rel: normalized, bytes });
      }
      for (const p of seenPaths) {
        if (dirPrefixes.has(p)) {
          return err({
            code: "invalid_input",
            message: `conflicting file and directory path: ${p}`,
          });
        }
      }
      if (!seenPaths.has(WORKFLOW_DECLARATION_FILE)) {
        return err({
          code: "invalid_input",
          message: `${WORKFLOW_DECLARATION_FILE} is required`,
        });
      }

      const parentDir = workflowsFolder(dataRoot, project);
      const targetDir = workflowFolder(dataRoot, project, name);
      const overwrite = options?.overwrite === true;
      try {
        await mkdir(parentDir, { recursive: true });
      } catch {
        return err({
          code: "unavailable",
          message: "could not create workflows directory",
        });
      }

      const exists = await lstat(targetDir).then(
        () => true,
        () => false,
      );
      if (exists) {
        if (!overwrite) {
          return err({
            code: "conflict",
            message: `workflow '${name}' already exists`,
          });
        }
        const verified = await verifyInsideWorkflowsRoot(project, targetDir);
        if (!verified.ok) return verified;
      }

      const token = randomBytes(6).toString("hex");
      const stageDir = `${parentDir}/.lophn-import-${token}`;
      const backupDir = `${parentDir}/.lophn-replace-${token}`;
      try {
        await mkdir(stageDir, { recursive: true });
        const stageRoot = resolve(stageDir);
        for (const item of decoded) {
          const dest = resolve(stageRoot, item.rel);
          if (!dest.startsWith(stageRoot + sep)) {
            return err({
              code: "invalid_input",
              message: `invalid workflow file path: ${item.rel}`,
            });
          }
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, item.bytes);
        }

        if (!exists) {
          try {
            await rename(stageDir, targetDir);
          } catch (e) {
            const code = errorCode(e);
            if (code === "EEXIST" || code === "ENOTEMPTY") {
              return err({
                code: "conflict",
                message: `workflow '${name}' already exists`,
              });
            }
            throw e;
          }
        } else {
          await rename(targetDir, backupDir);
          try {
            await rename(stageDir, targetDir);
          } catch (e) {
            await rename(backupDir, targetDir).catch(() => {});
            throw e;
          }
          await rm(backupDir, { recursive: true, force: true }).catch(() => {});
        }
        return ok({ files_written: decoded.length });
      } catch {
        return err({
          code: "unavailable",
          message: "could not write imported workflow folder",
        });
      } finally {
        await rm(stageDir, { recursive: true, force: true }).catch(() => {});
      }
    },

    async writeDeclaration(project, name, declaration) {
      if (!workflowNameSchema.safeParse(name).success) {
        return err({ code: "invalid_input", message: "invalid workflow name" });
      }
      const dir = workflowFolder(dataRoot, project, name);
      const verified = await verifyInsideWorkflowsRoot(project, dir);
      if (!verified.ok) return verified;
      const declPath = `${dir}/${WORKFLOW_DECLARATION_FILE}`;
      let mode = 0o600;
      try {
        const info = await lstat(declPath);
        if (info.isSymbolicLink()) {
          return err({
            code: "forbidden",
            message: `${WORKFLOW_DECLARATION_FILE} is a symbolic link`,
          });
        }
        mode = info.mode & 0o777;
      } catch (e) {
        if (errorCode(e) !== "ENOENT") {
          return err({
            code: "unavailable",
            message: `could not read ${WORKFLOW_DECLARATION_FILE}`,
          });
        }
      }
      const tmpPath = `${declPath}.tmp-${randomBytes(6).toString("hex")}`;
      try {
        await writeFile(tmpPath, declaration, { encoding: "utf8", mode });
        await rename(tmpPath, declPath);
        return ok(undefined);
      } catch {
        await rm(tmpPath, { force: true }).catch(() => {});
        return err({
          code: "unavailable",
          message: `could not write ${WORKFLOW_DECLARATION_FILE}`,
        });
      }
    },
  };
}
