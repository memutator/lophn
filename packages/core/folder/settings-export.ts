// 5종 설정·workflow(agent, skill, project_command, permission_rules, workflow) 내보내기·staging·적용.
// 대상이 offline이면 hub가 carry(`staged-settings/<stg>.json`)로 보관·전달한다.
// `permission_rules`나 `locked_fields`가 들어 있는 항목은 `confirm_permissions === true`인 사람 호출이 아니면
// 절대 자동 적용하지 않고 `"requires_person_confirmation"`을 돌려준다.
import { existsSync, mkdirSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
} from "node:fs/promises";
import { basename, join, sep } from "node:path";
import { z } from "zod";
import {
  canonicalize,
  type Clock,
  err,
  formatAt,
  ok,
  type RandomSource,
  type Result,
  sha256Hex,
} from "../../base/mod.ts";
import { type Id, idSchema } from "../../protocol/base/ids.ts";
import { parseActor } from "../../protocol/base/mod.ts";
import { machineDir } from "../../protocol/folder/layout.ts";
import { decodeRecord, encodeRecord } from "../../protocol/folder/records.ts";
import {
  type SettingsExportFile,
  type SettingsExportItem,
  type SettingsExportKind,
  type StagedSettingsBatch,
  type settingsExportApply,
  type settingsExportDismiss,
  type settingsExportSend,
  type settingsExportStaged,
  stagedSettingsBatchSchema,
} from "../../protocol/folder/settings-export.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import { createFolderReader, createFolderWriter } from "./fs.ts";
import { toCarryId } from "./transfers.ts";

export const STAGED_SETTINGS_FILE_MAX_BYTES = 16 * 1024 * 1024;
const STAGED_ACKS_MAX = 4096;
const STAGED_ACKS_MAX_BYTES = 512 * 1024;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const MAX_DIR_FILES = 256;

export const stagedSettingsDir = (machine: Id<"mch">) =>
  `${machineDir(machine)}/staged-settings`;
export const stagedSettingsAcksPath = (machine: Id<"mch">) =>
  `${stagedSettingsDir(machine)}/acks.json`;
export const stagedSettingsFilePath = (machine: Id<"mch">, id: Id<"stg">) =>
  `${stagedSettingsDir(machine)}/${toCarryId(id)}.json`;

const stagedAcksSchema = z.object({
  format: z.literal(1),
  machine: idSchema("mch"),
  batches: z.array(idSchema("stg")).max(STAGED_ACKS_MAX),
});

// agent 정의 글에서 사람이 직접 확인해야 하는 칸이다: 권한 단계와 앱 skill 배포(agent가 앱을 아는 길이고 묻지 않고 부르게 한다).
// 내보낼 때 항목에 싣지만, 받은 batch가 싣거나 빼먹은 값은 믿지 않는다: 적용할 때 내용을 다시 읽어 정한다.
function lockedAgentFields(content: string): string[] {
  const locked: string[] = [];
  if (/^permission_mode:/m.test(content)) locked.push("permissions");
  if (/^deployed_skills:/m.test(content)) locked.push("deployed_skills");
  return locked;
}

function hex16(random: RandomSource): string {
  const bytes = new Uint8Array(8);
  random.fill(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function atomicWrite(
  target: string,
  bytes: Uint8Array,
  random: RandomSource,
  mode = FILE_MODE,
): Promise<void> {
  const dir = join(target, "..");
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  const temp = join(dir, `${basename(target)}.tmp-${hex16(random)}`);
  const handle = await open(temp, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temp, mode);
  await rename(temp, target);
}

/** 상대 경로가 디렉터리 밖으로 탈출하지 않는지 검증한다. */
export function safeRelPath(rel: string): string[] | null {
  if (
    rel === "" ||
    rel.startsWith("/") ||
    rel.startsWith("\\") ||
    /^[A-Za-z]:/.test(rel)
  ) {
    return null;
  }
  const parts = rel.split("/");
  if (
    parts.some(
      (p) =>
        p === "" ||
        p === "." ||
        p === ".." ||
        p.includes("\\") ||
        p.includes("\0"),
    )
  ) {
    return null;
  }
  return parts;
}

function safeItemId(id: string): string | null {
  const parts = safeRelPath(id);
  return parts !== null && parts.length === 1 ? parts[0]! : null;
}

async function collectDirFiles(
  rootDir: string,
): Promise<Result<SettingsExportFile[]>> {
  let realBase: string;
  try {
    realBase = await realpath(rootDir);
  } catch {
    return err({ code: "not_found", message: `folder not found: ${rootDir}` });
  }
  const files: SettingsExportFile[] = [];
  async function walk(dir: string, prefix: string): Promise<Result<void>> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, entry.name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) continue;
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (info.isDirectory()) {
        const sub = await walk(full, rel);
        if (!sub.ok) return sub;
      } else if (info.isFile()) {
        if (files.length >= MAX_DIR_FILES) {
          return err({
            code: "invalid_input",
            message: `too many files in ${rootDir} (max ${MAX_DIR_FILES})`,
          });
        }
        const real = await realpath(full);
        if (!real.startsWith(`${realBase}${sep}`) && real !== realBase) {
          continue;
        }
        const content = await readFile(real, "utf8");
        files.push({
          rel_path: rel,
          content,
          sha256: await sha256Hex(content),
        });
      }
    }
    return ok(undefined);
  }
  const walked = await walk(realBase, "");
  if (!walked.ok) return walked;
  if (files.length === 0) {
    return err({ code: "not_found", message: `no files in ${rootDir}` });
  }
  return ok(files);
}

async function verifyItemFiles(
  items: readonly SettingsExportItem[],
): Promise<Result<void>> {
  for (const item of items) {
    for (const file of item.files) {
      if (safeRelPath(file.rel_path) === null) {
        return err({
          code: "invalid_input",
          message: `unsafe rel_path in ${item.kind}/${item.id}: ${file.rel_path}`,
        });
      }
      const actual = await sha256Hex(file.content);
      if (actual !== file.sha256) {
        return err({
          code: "invalid_input",
          message: `sha256 mismatch in ${item.kind}/${item.id}:${file.rel_path}`,
        });
      }
    }
  }
  return ok(undefined);
}

async function writeSafeFiles(input: {
  baseDir: string;
  files: readonly SettingsExportFile[];
  overwrite: boolean;
  random: RandomSource;
}): Promise<Result<"applied" | "skipped_conflict">> {
  await mkdir(input.baseDir, { recursive: true, mode: DIR_MODE });
  const realBase = await realpath(input.baseDir);
  const targets: { path: string; content: string }[] = [];
  for (const file of input.files) {
    const parts = safeRelPath(file.rel_path);
    if (parts === null) {
      return err({
        code: "invalid_input",
        message: `unsafe rel_path: ${file.rel_path}`,
      });
    }
    const target = join(realBase, ...parts);
    if (!target.startsWith(`${realBase}${sep}`)) {
      return err({
        code: "forbidden",
        message: `target escapes destination: ${file.rel_path}`,
      });
    }
    if (!input.overwrite && existsSync(target)) {
      return ok("skipped_conflict");
    }
    targets.push({ path: target, content: file.content });
  }
  const encoder = new TextEncoder();
  for (const target of targets) {
    await atomicWrite(
      target.path,
      encoder.encode(target.content),
      input.random,
      FILE_MODE,
    );
  }
  return ok("applied");
}

export type SettingsExportDeps = {
  dataRoot: string;
  computersRoot: string;
  me(): { id: Id<"mch">; name: string };
  resolveMachine(
    ref: string,
  ): Result<{ machine: Id<"mch">; name: string; self: boolean }>;
  onlineMachines(): { machine: Id<"mch">; status: string; hub: boolean }[];
  holds(machine: Id<"mch">, path: string): Promise<boolean>;
  /** project ref(id·이름·identity)에서 이 기계 project의 id, identity, 첫 폴더를 푼다. */
  resolveProject?(ref: string): {
    id: Id<"prj">;
    identity: Id<"pri">;
    folder: string | null;
  } | null;
  /** `permission_rules` 현재 값 읽기·쓰기(사람 확인 뒤에만 호출). */
  readPermissionRules(): unknown;
  applyPermissionRules(
    value: unknown,
    overwrite: boolean,
  ): Promise<Result<"applied" | "skipped_conflict">>;
  /** `project_command` 읽기·쓰기. */
  readProjectCommand?(
    project: Id<"prj">,
    id: string,
  ): Result<SettingsExportItem>;
  applyProjectCommand?(
    project: Id<"prj">,
    item: SettingsExportItem,
    overwrite: boolean,
  ): Promise<Result<"applied" | "skipped_conflict">>;
  clock: Clock;
  random: RandomSource;
  newBatchId(): Id<"stg">;
  carryKick(): void;
  log(event: string, message: string): void;
};

export function createSettingsExportService(deps: SettingsExportDeps) {
  const stagedDir = join(deps.dataRoot, "staged-settings");
  const outgoingDir = join(stagedDir, "outgoing");
  const encoder = new TextEncoder();

  const batchPath = (id: Id<"stg">) => join(stagedDir, `${id}.json`);
  const outgoingPath = (id: Id<"stg">) => join(outgoingDir, `${id}.json`);

  async function saveBatch(
    path: string,
    batch: StagedSettingsBatch,
  ): Promise<void> {
    const checked = stagedSettingsBatchSchema.parse(batch);
    await atomicWrite(
      path,
      encoder.encode(`${JSON.stringify(checked)}\n`),
      deps.random,
    );
  }

  async function readBatch(path: string): Promise<StagedSettingsBatch | null> {
    try {
      const text = await readFile(path, "utf8");
      const parsed = stagedSettingsBatchSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  function deliveryStateFor(
    target: Id<"mch">,
  ): "queued" | "held_at_hub" | "delivered" {
    const peers = deps.onlineMachines();
    if (peers.some((p) => p.machine === target && p.status === "connected")) {
      return "queued";
    }
    if (
      peers.some(
        (p) => p.status === "connected" && p.hub && p.machine !== target,
      )
    ) {
      return "held_at_hub";
    }
    return "queued";
  }

  async function writeAcks(acks: readonly Id<"stg">[]): Promise<Result<void>> {
    const me = deps.me().id;
    mkdirSync(deps.computersRoot, { recursive: true, mode: DIR_MODE });
    const writer = createFolderWriter({
      root: deps.computersRoot,
      machine: me,
      random: deps.random,
    });
    const path = stagedSettingsAcksPath(me);
    const unique = [...new Set(acks)].sort().slice(0, STAGED_ACKS_MAX);
    if (unique.length === 0) return await writer.remove(path);
    const reader = createFolderReader(deps.computersRoot);
    const before = await reader.read(path, STAGED_ACKS_MAX_BYTES);
    const parsed = before.ok
      ? decodeRecord(stagedAcksSchema, before.value, STAGED_ACKS_MAX_BYTES)
      : null;
    if (
      parsed?.ok &&
      canonicalize(parsed.value.batches) === canonicalize(unique)
    ) {
      return ok(undefined);
    }
    return await writer.writeFile(
      path,
      encodeRecord(stagedAcksSchema, {
        format: 1,
        machine: me,
        batches: unique,
      }),
    );
  }

  async function loadLocalItem(
    kind: SettingsExportKind,
    id: string,
    project: {
      id: Id<"prj">;
      identity: Id<"pri">;
      folder: string | null;
    } | null,
  ): Promise<Result<SettingsExportItem>> {
    switch (kind) {
      case "agent": {
        const safe = safeItemId(id);
        if (safe === null) {
          return err({
            code: "invalid_input",
            message: `invalid agent id: ${id}`,
          });
        }
        const file = join(deps.dataRoot, "agents", `${safe}.md`);
        let content: string;
        try {
          content = await readFile(file, "utf8");
        } catch {
          return err({ code: "not_found", message: `agent not found: ${id}` });
        }
        const locked = lockedAgentFields(content);
        return ok({
          kind: "agent",
          id: safe,
          title: safe,
          files: [
            {
              rel_path: `${safe}.md`,
              content,
              sha256: await sha256Hex(content),
            },
          ],
          ...(locked.length > 0 ? { locked_fields: locked } : {}),
        });
      }
      case "skill": {
        const safe = safeItemId(id);
        if (safe === null) {
          return err({
            code: "invalid_input",
            message: `invalid skill id: ${id}`,
          });
        }
        const candidates = [
          ...(project?.folder
            ? [join(project.folder, ".lophn", "skills", safe)]
            : []),
          join(deps.dataRoot, "skills", safe),
        ];
        const dir = candidates.find((c) => existsSync(c));
        if (dir === undefined) {
          return err({ code: "not_found", message: `skill not found: ${id}` });
        }
        const files = await collectDirFiles(dir);
        if (!files.ok) return files;
        return ok({
          kind: "skill",
          id: safe,
          title: safe,
          files: files.value,
        });
      }
      case "workflow": {
        const safe = safeItemId(id);
        if (safe === null) {
          return err({
            code: "invalid_input",
            message: `invalid workflow id: ${id}`,
          });
        }
        const candidates = [
          ...(project?.folder
            ? [join(project.folder, ".lophn", "workflows", safe)]
            : []),
          join(deps.dataRoot, "workflows", safe),
        ];
        const dir = candidates.find((c) => existsSync(c));
        if (dir === undefined) {
          return err({
            code: "not_found",
            message: `workflow not found: ${id}`,
          });
        }
        const files = await collectDirFiles(dir);
        if (!files.ok) return files;
        return ok({
          kind: "workflow",
          id: safe,
          title: safe,
          files: files.value,
        });
      }
      case "permission_rules": {
        const current = deps.readPermissionRules();
        const content = `${JSON.stringify(current, null, 2)}\n`;
        return ok({
          kind: "permission_rules",
          id,
          title: "Permission rules",
          files: [
            {
              rel_path: "permission-rules.json",
              content,
              sha256: await sha256Hex(content),
            },
          ],
          locked_fields: ["permission_rules"],
        });
      }
      case "project_command": {
        if (project === null) {
          return err({
            code: "invalid_input",
            message: "project_command export requires project",
          });
        }
        if (deps.readProjectCommand === undefined) {
          return err({
            code: "unavailable",
            message: "project commands are not available",
          });
        }
        return deps.readProjectCommand(project.id, id);
      }
    }
  }

  async function applyOneItem(
    item: SettingsExportItem,
    project: {
      id: Id<"prj">;
      identity: Id<"pri">;
      folder: string | null;
    } | null,
    overwrite: boolean,
  ): Promise<Result<"applied" | "skipped_conflict">> {
    const verified = await verifyItemFiles([item]);
    if (!verified.ok) return verified;

    switch (item.kind) {
      case "agent": {
        const safe = safeItemId(item.id);
        if (safe === null) {
          return err({
            code: "invalid_input",
            message: `invalid agent id: ${item.id}`,
          });
        }
        const primary = item.files[0];
        if (primary === undefined) {
          return err({
            code: "invalid_input",
            message: "agent item has no file",
          });
        }
        const target = join(deps.dataRoot, "agents", `${safe}.md`);
        if (!overwrite && existsSync(target)) return ok("skipped_conflict");
        await atomicWrite(
          target,
          encoder.encode(primary.content),
          deps.random,
          FILE_MODE,
        );
        return ok("applied");
      }
      case "skill": {
        const safe = safeItemId(item.id);
        if (safe === null) {
          return err({
            code: "invalid_input",
            message: `invalid skill id: ${item.id}`,
          });
        }
        const base = project?.folder
          ? join(project.folder, ".lophn", "skills", safe)
          : join(deps.dataRoot, "skills", safe);
        return await writeSafeFiles({
          baseDir: base,
          files: item.files,
          overwrite,
          random: deps.random,
        });
      }
      case "workflow": {
        const safe = safeItemId(item.id);
        if (safe === null) {
          return err({
            code: "invalid_input",
            message: `invalid workflow id: ${item.id}`,
          });
        }
        const base = project?.folder
          ? join(project.folder, ".lophn", "workflows", safe)
          : join(deps.dataRoot, "workflows", safe);
        return await writeSafeFiles({
          baseDir: base,
          files: item.files,
          overwrite,
          random: deps.random,
        });
      }
      case "permission_rules": {
        const primary = item.files[0];
        if (primary === undefined) {
          return err({
            code: "invalid_input",
            message: "permission_rules item has no file",
          });
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(primary.content);
        } catch {
          return err({
            code: "invalid_input",
            message: "permission_rules content is not valid JSON",
          });
        }
        return await deps.applyPermissionRules(parsed, overwrite);
      }
      case "project_command": {
        if (project === null) {
          return err({
            code: "invalid_input",
            message: "applying project_command requires a matching project",
          });
        }
        if (deps.applyProjectCommand === undefined) {
          return err({
            code: "unavailable",
            message: "project commands are not available",
          });
        }
        return await deps.applyProjectCommand(project.id, item, overwrite);
      }
    }
  }

  return {
    async send(
      auth: AuthenticatedContext,
      input: z.infer<typeof settingsExportSend.input>,
    ): Promise<Result<z.infer<typeof settingsExportSend.output>>> {
      if (parseActor(auth.actor)?.kind !== "user") {
        return err({
          code: "forbidden",
          message: "only the person can export settings",
        });
      }
      const hasItems = (input.items?.length ?? 0) > 0;
      const hasRaw = (input.raw_items?.length ?? 0) > 0;
      if (!hasItems && !hasRaw) {
        return err({
          code: "invalid_input",
          message: "provide at least one item or raw_item to export",
        });
      }
      const me = deps.me();
      const target = deps.resolveMachine(input.to);
      if (!target.ok) return target;
      if (target.value.self || target.value.machine === me.id) {
        return err({
          code: "invalid_input",
          message: "that is this computer; specify another paired computer",
        });
      }
      const project =
        input.project !== undefined
          ? (deps.resolveProject?.(input.project) ?? null)
          : null;
      if (input.project !== undefined && project === null) {
        return err({
          code: "not_found",
          message: `project not found: ${input.project}`,
        });
      }

      const collected: SettingsExportItem[] = [];
      for (const ref of input.items ?? []) {
        const loaded = await loadLocalItem(ref.kind, ref.id, project);
        if (!loaded.ok) return loaded;
        collected.push(loaded.value);
      }
      for (const raw of input.raw_items ?? []) {
        collected.push(raw);
      }
      const verified = await verifyItemFiles(collected);
      if (!verified.ok) return verified;

      const id = deps.newBatchId();
      const now = formatAt(deps.clock.nowMs());
      const deliveryState = deliveryStateFor(target.value.machine);
      const batch: StagedSettingsBatch = {
        id,
        from_machine: me.id,
        from_name: me.name,
        to_machine: target.value.machine,
        project_identity: project?.identity ?? null,
        items: collected,
        state: "pending",
        delivery_state: deliveryState,
        note: input.note ?? null,
        created_at: now,
        updated_at: now,
      };
      const bytes = encoder.encode(`${JSON.stringify(batch)}\n`);
      if (bytes.byteLength > STAGED_SETTINGS_FILE_MAX_BYTES) {
        return err({
          code: "invalid_input",
          message: "exported settings batch exceeds size limit",
        });
      }
      await mkdir(deps.computersRoot, { recursive: true, mode: DIR_MODE });
      const writer = createFolderWriter({
        root: deps.computersRoot,
        machine: me.id,
        random: deps.random,
      });
      const written = await writer.writeFile(
        stagedSettingsFilePath(me.id, id),
        bytes,
      );
      if (!written.ok) return written;
      await saveBatch(outgoingPath(id), batch);
      deps.carryKick();
      return ok({
        batch: id,
        to_machine: target.value.machine,
        delivery_state: deliveryState,
        item_count: collected.length,
      });
    },

    async staged(
      auth: AuthenticatedContext,
      input: z.infer<typeof settingsExportStaged.input>,
    ): Promise<Result<z.infer<typeof settingsExportStaged.output>>> {
      if (parseActor(auth.actor)?.kind !== "user") {
        return err({
          code: "forbidden",
          message: "only the person can view staged settings",
        });
      }
      const filterState = input.state ?? "pending";
      let names: string[];
      try {
        names = await readdir(stagedDir);
      } catch {
        return ok({ batches: [] });
      }
      const batches: StagedSettingsBatch[] = [];
      for (const name of names) {
        if (!name.startsWith("stg_") || !name.endsWith(".json")) continue;
        const batch = await readBatch(join(stagedDir, name));
        if (batch === null) continue;
        if (filterState === "pending" && batch.state !== "pending") continue;
        batches.push(batch);
      }
      batches.sort((a, b) =>
        a.created_at === b.created_at
          ? a.id < b.id
            ? 1
            : -1
          : a.created_at < b.created_at
            ? 1
            : -1,
      );
      return ok({ batches });
    },

    async apply(
      auth: AuthenticatedContext,
      input: z.infer<typeof settingsExportApply.input>,
    ): Promise<Result<z.infer<typeof settingsExportApply.output>>> {
      if (parseActor(auth.actor)?.kind !== "user") {
        return err({
          code: "forbidden",
          message: "only the person can apply staged settings",
        });
      }
      const id = input.batch as Id<"stg">;
      const batch = await readBatch(batchPath(id));
      if (batch === null) {
        return err({
          code: "not_found",
          message: `staged settings batch ${id} not found`,
        });
      }
      if (batch.state === "dismissed") {
        return err({
          code: "conflict",
          message: `staged settings batch ${id} was dismissed`,
        });
      }

      const projectRef = input.project ?? batch.project_identity ?? undefined;
      const project =
        projectRef !== undefined
          ? (deps.resolveProject?.(projectRef) ?? null)
          : null;
      if (input.project !== undefined && project === null) {
        return err({
          code: "not_found",
          message: `project not found: ${input.project}`,
        });
      }

      const wantedIds =
        input.item_ids !== undefined ? new Set(input.item_ids) : null;
      const selected =
        wantedIds === null
          ? batch.items
          : batch.items.filter((item) => wantedIds.has(item.id));
      const overwrite = input.overwrite === true;
      const confirmPermissions = input.confirm_permissions === true;

      const applied: z.infer<typeof settingsExportApply.output>["applied"] = [];
      let requiresPermissionConfirmation = false;

      for (const item of selected) {
        const sensitive =
          item.kind === "permission_rules" ||
          (item.locked_fields !== undefined && item.locked_fields.length > 0) ||
          (item.kind === "agent" &&
            item.files.some(
              (file) => lockedAgentFields(file.content).length > 0,
            ));
        if (sensitive && !confirmPermissions) {
          requiresPermissionConfirmation = true;
          applied.push({
            kind: item.kind,
            id: item.id,
            status: "requires_person_confirmation",
          });
          continue;
        }
        const res = await applyOneItem(item, project, overwrite);
        if (!res.ok) return res;
        applied.push({ kind: item.kind, id: item.id, status: res.value });
      }

      const allApplied =
        !requiresPermissionConfirmation &&
        selected.length === batch.items.length &&
        applied.every((row) => row.status === "applied");
      if (allApplied) {
        await saveBatch(batchPath(id), {
          ...batch,
          state: "applied",
          updated_at: formatAt(deps.clock.nowMs()),
        });
      }

      return ok({
        applied,
        requires_permission_confirmation: requiresPermissionConfirmation,
      });
    },

    async dismiss(
      auth: AuthenticatedContext,
      input: z.infer<typeof settingsExportDismiss.input>,
    ): Promise<Result<z.infer<typeof settingsExportDismiss.output>>> {
      if (parseActor(auth.actor)?.kind !== "user") {
        return err({
          code: "forbidden",
          message: "only the person can dismiss staged settings",
        });
      }
      const id = input.batch as Id<"stg">;
      const batch = await readBatch(batchPath(id));
      if (batch === null) {
        return err({
          code: "not_found",
          message: `staged settings batch ${id} not found`,
        });
      }
      await saveBatch(batchPath(id), {
        ...batch,
        state: "dismissed",
        updated_at: formatAt(deps.clock.nowMs()),
      });
      return ok({ dismissed: true });
    },

    /**
     * 다른 컴퓨터가 보낸 `staged-settings/<stg>.json` 가운데 이 컴퓨터 앞인 것을 검증해
     * `<dataRoot>/staged-settings/<stg>.json`에 `state: "pending"`으로 저장하고 acks를 남긴다.
     */
    async processIncoming(): Promise<number> {
      const me = deps.me().id;
      const now = formatAt(deps.clock.nowMs());
      const reader = createFolderReader(deps.computersRoot);
      const machines = await reader.listMachines();
      if (!machines.ok) return 0;

      const ackIds: Id<"stg">[] = [];
      let staged = 0;

      for (const origin of machines.value) {
        if (origin === me) continue;
        let names: string[];
        try {
          names = await readdir(
            join(deps.computersRoot, ...stagedSettingsDir(origin).split("/")),
          );
        } catch {
          continue;
        }
        for (const name of names.sort()) {
          if (!/^stg_[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}\.json$/.test(name)) {
            continue;
          }
          const rel = `${stagedSettingsDir(origin)}/${name}`;
          if (!(await deps.holds(origin, rel))) continue;
          const read = await reader.read(rel, STAGED_SETTINGS_FILE_MAX_BYTES);
          if (!read.ok) continue;
          let batch: StagedSettingsBatch;
          try {
            const parsed = stagedSettingsBatchSchema.safeParse(
              JSON.parse(
                new TextDecoder("utf-8", { fatal: true }).decode(read.value),
              ),
            );
            if (!parsed.success) {
              deps.log("staged_settings_invalid", `${rel} is invalid`);
              continue;
            }
            batch = parsed.data;
          } catch {
            deps.log("staged_settings_invalid", `${rel} is not JSON`);
            continue;
          }
          if (
            batch.from_machine !== origin ||
            `${batch.id}.json` !== name.toLowerCase()
          ) {
            deps.log(
              "staged_settings_mismatch",
              `${rel} does not match folder`,
            );
            continue;
          }
          if (batch.to_machine !== me) continue;
          const verified = await verifyItemFiles(batch.items);
          if (!verified.ok) {
            deps.log(
              "staged_settings_tampered",
              `${rel}: ${verified.error.message}`,
            );
            continue;
          }

          const dest = batchPath(batch.id as Id<"stg">);
          if (!existsSync(dest)) {
            await saveBatch(dest, {
              ...batch,
              state: "pending",
              delivery_state: "delivered",
              updated_at: now,
            });
            staged += 1;
          }
          ackIds.push(batch.id as Id<"stg">);
        }
      }

      const acked = await writeAcks(ackIds);
      if (!acked.ok) {
        deps.log("staged_settings_acks_not_written", acked.error.message);
      }
      if (staged > 0) deps.carryKick();
      return staged;
    },

    /**
     * 대상 컴퓨터의 `staged-settings/acks.json`을 읽어 보낸 배치의 carry 파일을 정리한다.
     */
    async processAcks(): Promise<number> {
      const me = deps.me().id;
      const now = formatAt(deps.clock.nowMs());
      const reader = createFolderReader(deps.computersRoot);
      const machines = await reader.listMachines();
      if (!machines.ok) return 0;

      const peerAcks = new Map<Id<"mch">, Set<string>>();
      for (const peer of machines.value) {
        if (peer === me) continue;
        const path = stagedSettingsAcksPath(peer);
        if (!(await deps.holds(peer, path))) continue;
        const read = await reader.read(path, STAGED_ACKS_MAX_BYTES);
        const parsed = read.ok
          ? decodeRecord(stagedAcksSchema, read.value, STAGED_ACKS_MAX_BYTES)
          : null;
        if (parsed?.ok && parsed.value.machine === peer) {
          peerAcks.set(peer, new Set(parsed.value.batches));
        }
      }

      if (!existsSync(deps.computersRoot)) return 0;
      let names: string[];
      try {
        names = await readdir(
          join(deps.computersRoot, ...stagedSettingsDir(me).split("/")),
        );
      } catch {
        return 0;
      }
      const writer = createFolderWriter({
        root: deps.computersRoot,
        machine: me,
        random: deps.random,
      });
      let removed = 0;
      for (const name of names) {
        if (!/^stg_[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}\.json$/.test(name)) {
          continue;
        }
        const rel = `${stagedSettingsDir(me)}/${name}`;
        const read = await reader.read(rel, STAGED_SETTINGS_FILE_MAX_BYTES);
        if (!read.ok) continue;
        let batch: StagedSettingsBatch;
        try {
          const parsed = stagedSettingsBatchSchema.safeParse(
            JSON.parse(new TextDecoder().decode(read.value)),
          );
          if (!parsed.success) continue;
          batch = parsed.data;
        } catch {
          continue;
        }
        if (
          peerAcks.get(batch.to_machine as Id<"mch">)?.has(batch.id) === true
        ) {
          const done = await writer.remove(rel);
          if (done.ok) {
            const outPath = outgoingPath(batch.id as Id<"stg">);
            if (existsSync(outPath)) {
              await saveBatch(outPath, {
                ...batch,
                delivery_state: "delivered",
                updated_at: now,
              });
            }
            removed += 1;
          }
        }
      }
      if (removed > 0) deps.carryKick();
      return removed;
    },
  };
}

export type SettingsExportService = ReturnType<
  typeof createSettingsExportService
>;
