// 다른 컴퓨터로 file을 보내고(꺼져 있으면 hub가 carry로 보관) `<dataRoot>/inbox/<trf>/`에 0644로 안전하게 내려놓는다.
// SQLite ledger schema를 추가하지 않고 검증된 disk 파일(`<dataRoot>/transfers/`, `<dataRoot>/inbox/<trf>/`,
// `<dataRoot>/computers/machines/<m>/transfers/`)로만 상태와 기록을 관리한다.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, extname, join, sep } from "node:path";
import { z } from "zod";
import {
  canonicalize,
  type Clock,
  err,
  errorCode,
  formatAt,
  ok,
  type RandomSource,
  type Result,
  sha256Hex,
} from "../../base/mod.ts";
import { type Id, idSchema } from "../../protocol/base/ids.ts";
import { parseActor } from "../../protocol/base/mod.ts";
import { atSchema, sha256Schema } from "../../protocol/base/values.ts";
import { machineDir } from "../../protocol/folder/layout.ts";
import { decodeRecord, encodeRecord } from "../../protocol/folder/records.ts";
import {
  TRANSFER_MAX_FILE_BYTES,
  TRANSFER_MAX_FILES,
  TRANSFER_TTL_MS,
  type TransferDeliveryState,
  type TransferFileEntry,
  type TransferRecord,
  transferFileEntrySchema,
  transferRecordSchema,
  type transfersClear,
  type transfersList,
  type transfersSend,
  type transfersStatus,
} from "../../protocol/folder/transfers.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import { createFolderReader, createFolderWriter } from "./fs.ts";

const TRANSFER_META_MAX_BYTES = 512 * 1024;
const TRANSFER_ACKS_MAX = 4096;
const TRANSFER_ACKS_MAX_BYTES = 512 * 1024;
const INBOX_FILE_MODE = 0o644;
const RECORD_FILE_MODE = 0o600;
const DIR_MODE = 0o700;

const CONTROLS = /\p{Cc}/gu;

/**
 * `carry.ts`의 transfers·custody·staged-settings path 정규식은 ULID 접미사를 대문자로 받는다.
 * API/JSON id는 소문자(`idSchema`)를 유지하고 carry 경로 구간에만 대문자 ULID를 쓴다.
 */
export function toCarryId(id: string): string {
  const idx = id.indexOf("_");
  if (idx < 0) return id;
  return `${id.slice(0, idx + 1)}${id.slice(idx + 1).toUpperCase()}`;
}

export const transfersDir = (machine: Id<"mch">) =>
  `${machineDir(machine)}/transfers`;
export const transferAcksPath = (machine: Id<"mch">) =>
  `${transfersDir(machine)}/acks.json`;
export const transferDir = (machine: Id<"mch">, id: Id<"trf">) =>
  `${transfersDir(machine)}/${toCarryId(id)}`;
export const transferMetaPath = (machine: Id<"mch">, id: Id<"trf">) =>
  `${transferDir(machine, id)}/meta.json`;
export const transferBinPath = (
  machine: Id<"mch">,
  id: Id<"trf">,
  index: number,
) => `${transferDir(machine, id)}/files/${String(index).padStart(4, "0")}.bin`;

const transferCarryFileSchema = transferFileEntrySchema.extend({
  bin: z.string().regex(/^files\/[0-9]{4}\.bin$/),
});
type TransferCarryFile = z.infer<typeof transferCarryFileSchema>;

const transferMetaSchema = z.strictObject({
  format: z.literal(1),
  id: idSchema("trf"),
  from_machine: idSchema("mch"),
  from_name: z.string().min(1).max(128),
  to_machine: idSchema("mch"),
  to_name: z.string().min(1).max(128),
  note: z.string().nullable(),
  files: z.array(transferCarryFileSchema).min(1).max(TRANSFER_MAX_FILES),
  created_at: atSchema,
  expires_at: atSchema,
});
type TransferMeta = z.infer<typeof transferMetaSchema>;

const transferAcksSchema = z.object({
  format: z.literal(1),
  machine: idSchema("mch"),
  transfers: z.array(idSchema("trf")).max(TRANSFER_ACKS_MAX),
});

function hex16(random: RandomSource): string {
  const bytes = new Uint8Array(8);
  random.fill(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 경로 구분자·`..`·제어 문자를 제거한 안전한 단일 파일 이름. 만들 수 없으면 null. */
export function safeFileName(raw: string): string | null {
  const cleaned = raw.replace(/\\/g, "/").replace(CONTROLS, "").trim();
  const base = basename(cleaned);
  if (
    base === "" ||
    base === "." ||
    base === ".." ||
    base.includes("/") ||
    base.includes("\\") ||
    base.includes("\0")
  ) {
    return null;
  }
  return base.slice(0, 255);
}

/** 첨부 객체에서 inbox 아래로 안전하게 붙일 상대 파일 경로를 구한다. 경로 탈출은 차단한다. */
export function safeAttachmentRelPath(att: {
  name: string;
  rel_path?: string;
}): string | null {
  const candidate = att.rel_path ?? att.name;
  const normalized = candidate.replace(/\\/g, "/").replace(CONTROLS, "").trim();
  if (
    normalized === "" ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    return safeFileName(att.name);
  }
  const parts = normalized.split("/");
  if (
    parts.some(
      (part) =>
        part === "" || part === "." || part === ".." || part.includes("\0"),
    )
  ) {
    return safeFileName(att.name);
  }
  return parts.join("/");
}

/** 첨부 파일을 받는 컴퓨터의 `<dataRoot>/inbox/<trf>/` 아래 안전한 경로로 매핑한다. */
export function inboxAttachmentPath(
  dataRoot: string | null,
  att: { transfer: string; name: string; rel_path?: string },
): string | null {
  if (!idSchema("trf").safeParse(att.transfer).success) return null;
  const rel = safeAttachmentRelPath(att);
  if (rel === null) return null;
  const parts = rel.split("/");
  return dataRoot === null
    ? ["inbox", att.transfer, ...parts].join("/")
    : join(dataRoot, "inbox", att.transfer, ...parts);
}

function insideRoot(realPath: string, realRoot: string): boolean {
  return realPath === realRoot || realPath.startsWith(`${realRoot}${sep}`);
}

async function atomicWriteFile(
  target: string,
  bytes: Uint8Array,
  mode: number,
  random: RandomSource,
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

async function atomicWriteStream(
  target: string,
  sourcePath: string,
  mode: number,
  random: RandomSource,
): Promise<{ size: number; sha256: string }> {
  const dir = join(target, "..");
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  const temp = join(dir, `${basename(target)}.tmp-${hex16(random)}`);
  const hash = createHash("sha256");
  let size = 0;
  try {
    const handle = await open(temp, "wx", mode);
    try {
      for await (const chunk of createReadStream(sourcePath)) {
        const buf = chunk as Uint8Array;
        hash.update(buf);
        size += buf.byteLength;
        await handle.write(buf);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temp, mode);
    await rename(temp, target);
    return { size, sha256: hash.digest("hex") };
  } catch (thrown) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw thrown;
  }
}

async function hashFile(
  path: string,
): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    const buf = chunk as Uint8Array;
    hash.update(buf);
    size += buf.byteLength;
  }
  return { size, sha256: hash.digest("hex") };
}

function uniqueInboxName(dir: string, name: string, used: Set<string>): string {
  if (!used.has(name) && !existsSync(join(dir, name))) {
    used.add(name);
    return name;
  }
  const ext = extname(name);
  const stem = ext.length > 0 ? name.slice(0, -ext.length) : name;
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${stem}-${i}${ext}`.slice(0, 255);
    if (!used.has(candidate) && !existsSync(join(dir, candidate))) {
      used.add(candidate);
      return candidate;
    }
  }
  const fallback = `${stem}-${Date.now()}${ext}`.slice(0, 255);
  used.add(fallback);
  return fallback;
}

export type TransfersDeps = {
  dataRoot: string;
  computersRoot: string;
  me(): { id: Id<"mch">; name: string };
  resolveMachine(
    ref: string,
  ): Result<{ machine: Id<"mch">; name: string; self: boolean }>;
  onlineMachines(): { machine: Id<"mch">; status: string; hub: boolean }[];
  isHub(): boolean;
  holds(machine: Id<"mch">, path: string): Promise<boolean>;
  /**
   * agent 호출일 때 허용된 workspace 절대 경로 목록을 돌려준다.
   * user 호출이고 특정 workspace에 묶여 있지 않으면 null을 돌려줄 수 있다.
   */
  workspaceRoots(auth: AuthenticatedContext): Promise<string[] | null>;
  clock: Clock;
  random: RandomSource;
  newTransferId(): Id<"trf">;
  carryKick(): void;
  log(event: string, message: string): void;
};

export function createTransfersService(deps: TransfersDeps) {
  const outgoingDir = join(deps.dataRoot, "transfers", "outgoing");
  const incomingDir = join(deps.dataRoot, "transfers", "incoming");
  const inboxRoot = join(deps.dataRoot, "inbox");
  const encoder = new TextEncoder();

  const recordPath = (dir: string, id: Id<"trf">) => join(dir, `${id}.json`);

  async function saveRecord(
    dir: string,
    record: TransferRecord,
  ): Promise<void> {
    const checked = transferRecordSchema.parse(record);
    await atomicWriteFile(
      recordPath(dir, checked.id as Id<"trf">),
      encoder.encode(`${JSON.stringify(checked)}\n`),
      RECORD_FILE_MODE,
      deps.random,
    );
  }

  async function readRecordFile(path: string): Promise<TransferRecord | null> {
    try {
      const text = await readFile(path, "utf8");
      const parsed = transferRecordSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async function listDirRecords(dir: string): Promise<TransferRecord[]> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const out: TransferRecord[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const rec = await readRecordFile(join(dir, name));
      if (rec !== null) out.push(rec);
    }
    return out;
  }

  function hubInfo(target: Id<"mch">): {
    state: TransferDeliveryState;
    held_by?: Id<"mch">[];
  } {
    const peers = deps.onlineMachines();
    const targetOnline = peers.some(
      (p) => p.machine === target && p.status === "connected",
    );
    if (targetOnline) return { state: "queued" };
    const onlineHubs = peers
      .filter((p) => p.status === "connected" && p.hub && p.machine !== target)
      .map((p) => p.machine)
      .sort();
    if (onlineHubs.length > 0) {
      return { state: "held_at_hub", held_by: onlineHubs };
    }
    return { state: "queued" };
  }

  async function writeAcks(acks: readonly Id<"trf">[]): Promise<Result<void>> {
    const me = deps.me().id;
    mkdirSync(deps.computersRoot, { recursive: true, mode: DIR_MODE });
    const writer = createFolderWriter({
      root: deps.computersRoot,
      machine: me,
      random: deps.random,
    });
    const path = transferAcksPath(me);
    const unique = [...new Set(acks)].sort().slice(0, TRANSFER_ACKS_MAX);
    if (unique.length === 0) return await writer.remove(path);
    const reader = createFolderReader(deps.computersRoot);
    const before = await reader.read(path, TRANSFER_ACKS_MAX_BYTES);
    const parsed = before.ok
      ? decodeRecord(transferAcksSchema, before.value, TRANSFER_ACKS_MAX_BYTES)
      : null;
    if (
      parsed?.ok &&
      canonicalize(parsed.value.transfers) === canonicalize(unique)
    ) {
      return ok(undefined);
    }
    return await writer.writeFile(
      path,
      encodeRecord(transferAcksSchema, {
        format: 1,
        machine: me,
        transfers: unique,
      }),
    );
  }

  return {
    async send(
      auth: AuthenticatedContext,
      input: z.infer<typeof transfersSend.input>,
    ): Promise<Result<z.infer<typeof transfersSend.output>>> {
      const me = deps.me();
      const target = deps.resolveMachine(input.to);
      if (!target.ok) return target;
      if (target.value.self || target.value.machine === me.id) {
        return err({
          code: "invalid_input",
          message: "that is this computer; specify another paired computer",
        });
      }

      const actorKind = parseActor(auth.actor)?.kind;
      const isAgent = actorKind === "agent";
      const rawRoots = await deps.workspaceRoots(auth);
      const enforceWorkspace =
        isAgent ||
        (rawRoots !== null && input.allow_outside_workspace !== true);
      const realRoots: string[] = [];
      if (enforceWorkspace) {
        if (rawRoots === null || rawRoots.length === 0) {
          return err({
            code: "forbidden",
            message:
              "agent transfers are restricted to files inside the workspace",
          });
        }
        for (const root of rawRoots) {
          try {
            realRoots.push(await realpath(root));
          } catch {
            // 없는 폴더는 건너뛴다.
          }
        }
        if (realRoots.length === 0) {
          return err({
            code: "forbidden",
            message: "workspace folder is not accessible",
          });
        }
      }

      if (input.paths.length === 0 || input.paths.length > TRANSFER_MAX_FILES) {
        return err({
          code: "invalid_input",
          message: `transfers must contain 1 to ${TRANSFER_MAX_FILES} files`,
        });
      }

      const checkedSources: {
        realPath: string;
        name: string;
        size: number;
        executable: boolean;
      }[] = [];
      for (const reqPath of input.paths) {
        let real: string;
        try {
          real = await realpath(reqPath);
        } catch (thrown) {
          const code = errorCode(thrown);
          return err({
            code:
              code === "ENOENT" || code === "ENOTDIR"
                ? "not_found"
                : "forbidden",
            message: `cannot read file: ${reqPath}`,
          });
        }
        if (enforceWorkspace && !realRoots.some((r) => insideRoot(real, r))) {
          return err({
            code: "forbidden",
            message: isAgent
              ? `path is outside the agent workspace: ${reqPath}`
              : `path is outside the workspace; pass allow_outside_workspace to send: ${reqPath}`,
          });
        }
        let info;
        try {
          info = await stat(real);
        } catch {
          return err({
            code: "not_found",
            message: `cannot stat file: ${reqPath}`,
          });
        }
        if (!info.isFile()) {
          return err({
            code: "invalid_input",
            message: `only regular files can be transferred: ${reqPath}`,
          });
        }
        if (info.size > TRANSFER_MAX_FILE_BYTES) {
          return err({
            code: "invalid_input",
            message: `file exceeds ${TRANSFER_MAX_FILE_BYTES} bytes limit: ${reqPath}`,
          });
        }
        const name = safeFileName(basename(real));
        if (name === null) {
          return err({
            code: "invalid_input",
            message: `invalid file name: ${reqPath}`,
          });
        }
        checkedSources.push({
          realPath: real,
          name,
          size: info.size,
          executable: (info.mode & 0o111) !== 0,
        });
      }

      const id = deps.newTransferId();
      const nowMs = deps.clock.nowMs();
      const createdAt = formatAt(nowMs);
      const expiresAt = formatAt(nowMs + TRANSFER_TTL_MS);

      await mkdir(deps.computersRoot, { recursive: true, mode: DIR_MODE });
      const writer = createFolderWriter({
        root: deps.computersRoot,
        machine: me.id,
        random: deps.random,
      });

      const carryFiles: TransferCarryFile[] = [];
      const publicFiles: TransferFileEntry[] = [];
      for (let i = 0; i < checkedSources.length; i++) {
        const src = checkedSources[i]!;
        const binRel = `files/${String(i).padStart(4, "0")}.bin`;
        const carryRel = transferBinPath(me.id, id, i);
        const hashed = await hashFile(src.realPath);
        if (hashed.size > TRANSFER_MAX_FILE_BYTES) {
          await writer.remove(transferDir(me.id, id));
          return err({
            code: "invalid_input",
            message: `file exceeds ${TRANSFER_MAX_FILE_BYTES} bytes limit`,
          });
        }
        const written = await writer.writeStream(
          carryRel,
          createReadStream(src.realPath),
        );
        if (!written.ok) {
          await writer.remove(transferDir(me.id, id));
          return written;
        }
        const entry: TransferFileEntry = {
          name: src.name,
          rel_path: src.name,
          size: hashed.size,
          sha256: hashed.sha256,
          ...(src.executable ? { executable_stripped: true } : {}),
        };
        publicFiles.push(entry);
        carryFiles.push({ ...entry, bin: binRel });
      }

      const meta: TransferMeta = {
        format: 1,
        id,
        from_machine: me.id,
        from_name: me.name,
        to_machine: target.value.machine,
        to_name: target.value.name,
        note: input.note ?? null,
        files: carryFiles,
        created_at: createdAt,
        expires_at: expiresAt,
      };
      const metaWritten = await writer.writeFile(
        transferMetaPath(me.id, id),
        encodeRecord(transferMetaSchema, meta),
      );
      if (!metaWritten.ok) {
        await writer.remove(transferDir(me.id, id));
        return metaWritten;
      }

      const delivery = hubInfo(target.value.machine);
      const record: TransferRecord = {
        id,
        from_machine: me.id,
        from_name: me.name,
        to_machine: target.value.machine,
        to_name: target.value.name,
        direction: "outgoing",
        note: input.note ?? null,
        files: publicFiles,
        state: delivery.state,
        ...(delivery.held_by !== undefined
          ? { held_by: delivery.held_by }
          : {}),
        inbox_dir: null,
        created_at: createdAt,
        updated_at: createdAt,
        expires_at: expiresAt,
      };
      await saveRecord(outgoingDir, record);
      deps.carryKick();

      return ok({
        transfer: id,
        to_machine: target.value.machine,
        to_name: target.value.name,
        state: record.state,
        ...(record.held_by !== undefined ? { held_by: record.held_by } : {}),
        files: publicFiles,
        created_at: createdAt,
        expires_at: expiresAt,
      });
    },

    async list(
      _auth: AuthenticatedContext,
      input: z.infer<typeof transfersList.input>,
    ): Promise<Result<z.infer<typeof transfersList.output>>> {
      const direction = input.direction ?? "all";
      const limit = input.limit ?? 50;
      const rows: TransferRecord[] = [];
      if (direction === "all" || direction === "outgoing") {
        rows.push(...(await listDirRecords(outgoingDir)));
      }
      if (direction === "all" || direction === "incoming") {
        rows.push(...(await listDirRecords(incomingDir)));
      }
      rows.sort((a, b) =>
        a.created_at === b.created_at
          ? a.id < b.id
            ? 1
            : -1
          : a.created_at < b.created_at
            ? 1
            : -1,
      );
      return ok({ transfers: rows.slice(0, limit) });
    },

    async status(
      _auth: AuthenticatedContext,
      input: z.infer<typeof transfersStatus.input>,
    ): Promise<Result<z.infer<typeof transfersStatus.output>>> {
      const id = input.transfer as Id<"trf">;
      const found =
        (await readRecordFile(recordPath(outgoingDir, id))) ??
        (await readRecordFile(recordPath(incomingDir, id)));
      if (found === null) {
        return err({ code: "not_found", message: `transfer ${id} not found` });
      }
      return ok({ transfer: found });
    },

    async clear(
      auth: AuthenticatedContext,
      input: z.infer<typeof transfersClear.input>,
    ): Promise<Result<z.infer<typeof transfersClear.output>>> {
      if (parseActor(auth.actor)?.kind !== "user") {
        return err({
          code: "forbidden",
          message: "only the person can clear transfers",
        });
      }
      const id = input.transfer as Id<"trf">;
      const outPath = recordPath(outgoingDir, id);
      const inPath = recordPath(incomingDir, id);
      const outRec = await readRecordFile(outPath);
      const inRec = await readRecordFile(inPath);
      if (outRec === null && inRec === null) {
        return err({ code: "not_found", message: `transfer ${id} not found` });
      }
      if (outRec !== null) {
        await rm(outPath, { force: true });
        if (existsSync(deps.computersRoot)) {
          const writer = createFolderWriter({
            root: deps.computersRoot,
            machine: deps.me().id,
            random: deps.random,
          });
          await writer.remove(transferDir(deps.me().id, id));
          deps.carryKick();
        }
      }
      if (inRec !== null) {
        await rm(inPath, { force: true });
        if (input.delete_inbox_files === true) {
          // idSchema("trf")로 검증된 id 아래 `<dataRoot>/inbox/<trf>`만 지운다.
          const targetInbox = join(inboxRoot, id);
          await rm(targetInbox, { recursive: true, force: true });
        }
      }
      return ok({ cleared: true });
    },

    /**
     * 다른 컴퓨터가 보낸 `transfers/<trf>/` 가운데 이 컴퓨터가 대상인 것을 검증해
     * `<dataRoot>/inbox/<trf>/`에 0644로 atomic write하고 `transfers/acks.json`을 갱신한다.
     */
    async processIncoming(): Promise<number> {
      const me = deps.me().id;
      const nowMs = deps.clock.nowMs();
      const now = formatAt(nowMs);
      const reader = createFolderReader(deps.computersRoot);
      const machines = await reader.listMachines();
      if (!machines.ok) return 0;

      let changed = 0;
      const ackIds: Id<"trf">[] = [];

      for (const origin of machines.value) {
        if (origin === me) continue;
        let dirNames: string[];
        try {
          dirNames = await readdir(
            join(deps.computersRoot, ...transfersDir(origin).split("/")),
          );
        } catch {
          continue;
        }
        for (const trfDirName of dirNames.sort()) {
          if (!/^trf_[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/.test(trfDirName)) {
            continue;
          }
          const metaRel = `${transfersDir(origin)}/${trfDirName}/meta.json`;
          if (!(await deps.holds(origin, metaRel))) continue;
          const read = await reader.read(metaRel, TRANSFER_META_MAX_BYTES);
          const decoded = read.ok
            ? decodeRecord(
                transferMetaSchema,
                read.value,
                TRANSFER_META_MAX_BYTES,
              )
            : null;
          if (!decoded?.ok) {
            deps.log("transfer_meta_invalid", `${metaRel} is not valid`);
            continue;
          }
          const meta = decoded.value;
          if (
            meta.from_machine !== origin ||
            trfDirName.toLowerCase() !== meta.id
          ) {
            deps.log(
              "transfer_meta_mismatch",
              `${metaRel} does not match folder`,
            );
            continue;
          }
          // 대상이 이 컴퓨터일 때만 inbox에 내려놓는다(hub는 carry 사본만 보관한다).
          if (meta.to_machine !== me) continue;
          if (nowMs > Date.parse(meta.expires_at)) continue;

          const existing = await readRecordFile(
            recordPath(incomingDir, meta.id as Id<"trf">),
          );
          if (existing?.state === "delivered") {
            ackIds.push(meta.id as Id<"trf">);
            continue;
          }

          // manifest에 실린 모든 bin file이 도착했고 sha256·크기가 meta와 맞는지 확인한다.
          const verifiedFiles: {
            entry: TransferCarryFile;
            absPath: string;
          }[] = [];
          let ready = true;
          for (const file of meta.files) {
            const binRel = `${transfersDir(origin)}/${trfDirName}/${file.bin}`;
            if (!(await deps.holds(origin, binRel))) {
              ready = false;
              break;
            }
            const absBin = join(deps.computersRoot, ...binRel.split("/"));
            let hashed: { size: number; sha256: string };
            try {
              hashed = await hashFile(absBin);
            } catch {
              ready = false;
              break;
            }
            if (hashed.size !== file.size || hashed.sha256 !== file.sha256) {
              deps.log(
                "transfer_file_mismatch",
                `${binRel} hash/size mismatch`,
              );
              ready = false;
              break;
            }
            verifiedFiles.push({ entry: file, absPath: absBin });
          }
          if (!ready) continue;

          const targetDir = join(inboxRoot, meta.id);
          await mkdir(targetDir, { recursive: true, mode: DIR_MODE });
          const usedNames = new Set<string>();
          const materialized: TransferFileEntry[] = [];
          let failed = false;
          for (const { entry, absPath } of verifiedFiles) {
            const base = safeFileName(entry.name);
            if (base === null) {
              failed = true;
              break;
            }
            const finalName = uniqueInboxName(targetDir, base, usedNames);
            const dest = join(targetDir, finalName);
            try {
              const written = await atomicWriteStream(
                dest,
                absPath,
                INBOX_FILE_MODE,
                deps.random,
              );
              if (
                written.size !== entry.size ||
                written.sha256 !== entry.sha256
              ) {
                await rm(dest, { force: true });
                failed = true;
                break;
              }
              materialized.push({
                name: finalName,
                rel_path: finalName,
                size: entry.size,
                sha256: entry.sha256,
                ...(entry.executable_stripped
                  ? { executable_stripped: true }
                  : {}),
              });
            } catch (thrown) {
              deps.log(
                "transfer_materialize_failed",
                thrown instanceof Error ? thrown.message : String(thrown),
              );
              failed = true;
              break;
            }
          }
          if (failed) continue;

          await saveRecord(incomingDir, {
            id: meta.id,
            from_machine: meta.from_machine,
            from_name: meta.from_name,
            to_machine: meta.to_machine,
            to_name: meta.to_name,
            direction: "incoming",
            note: meta.note,
            files: materialized,
            state: "delivered",
            inbox_dir: targetDir,
            created_at: meta.created_at,
            updated_at: now,
            expires_at: meta.expires_at,
          });
          ackIds.push(meta.id as Id<"trf">);
          changed += 1;
        }
      }

      const acked = await writeAcks(ackIds);
      if (!acked.ok) {
        deps.log("transfer_acks_not_written", acked.error.message);
      }
      if (changed > 0) deps.carryKick();
      return changed;
    },

    /**
     * 받는 컴퓨터의 `transfers/acks.json`을 읽어 보낸 transfer를 delivered로 닫고 carry file을 정리한다.
     * `TRANSFER_TTL_MS`(7일)가 지난 carry file과 hub 보관 사본도 여기서 정리한다.
     */
    async processAcksAndGc(): Promise<number> {
      const me = deps.me().id;
      const nowMs = deps.clock.nowMs();
      const now = formatAt(nowMs);
      const reader = createFolderReader(deps.computersRoot);
      const machines = await reader.listMachines();
      if (!machines.ok) return 0;

      // peer별 ack 집합 수집.
      const peerAcks = new Map<Id<"mch">, Set<string>>();
      for (const peer of machines.value) {
        if (peer === me) continue;
        const path = transferAcksPath(peer);
        if (!(await deps.holds(peer, path))) continue;
        const read = await reader.read(path, TRANSFER_ACKS_MAX_BYTES);
        const parsed = read.ok
          ? decodeRecord(
              transferAcksSchema,
              read.value,
              TRANSFER_ACKS_MAX_BYTES,
            )
          : null;
        if (parsed?.ok && parsed.value.machine === peer) {
          peerAcks.set(peer, new Set(parsed.value.transfers));
        }
      }

      let changed = 0;
      const writer = existsSync(deps.computersRoot)
        ? createFolderWriter({
            root: deps.computersRoot,
            machine: me,
            random: deps.random,
          })
        : null;

      // 1) 내가 보낸 transfer: ack 도착 → delivered + carry 삭제, TTL 경과 → expired + carry 삭제.
      for (const rec of await listDirRecords(outgoingDir)) {
        if (rec.state === "delivered" || rec.state === "expired") continue;
        const ackedByTarget =
          peerAcks.get(rec.to_machine as Id<"mch">)?.has(rec.id) === true;
        if (ackedByTarget) {
          await saveRecord(outgoingDir, {
            ...rec,
            state: "delivered",
            updated_at: now,
          });
          await writer?.remove(transferDir(me, rec.id as Id<"trf">));
          changed += 1;
          continue;
        }
        if (nowMs > Date.parse(rec.expires_at)) {
          await saveRecord(outgoingDir, {
            ...rec,
            state: "expired",
            updated_at: now,
          });
          await writer?.remove(transferDir(me, rec.id as Id<"trf">));
          changed += 1;
          continue;
        }
        const nextDelivery = hubInfo(rec.to_machine as Id<"mch">);
        if (
          nextDelivery.state === "held_at_hub" &&
          (rec.state !== "held_at_hub" ||
            canonicalize(rec.held_by ?? []) !==
              canonicalize(nextDelivery.held_by ?? []))
        ) {
          await saveRecord(outgoingDir, {
            ...rec,
            state: "held_at_hub",
            held_by: nextDelivery.held_by,
            updated_at: now,
          });
          changed += 1;
        }
      }

      // 2) Hub 컴퓨터 보관 정리: 다른 컴퓨터가 맡긴 transfer가 대상에게 ack됐거나 만료됐으면 보관 사본을 정리한다.
      if (deps.isHub()) {
        for (const origin of machines.value) {
          if (origin === me) continue;
          const base = join(
            deps.computersRoot,
            ...transfersDir(origin).split("/"),
          );
          let dirNames: string[];
          try {
            dirNames = await readdir(base);
          } catch {
            continue;
          }
          for (const trfDirName of dirNames) {
            if (!/^trf_[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/.test(trfDirName)) {
              continue;
            }
            const metaRel = `${transfersDir(origin)}/${trfDirName}/meta.json`;
            const read = await reader.read(metaRel, TRANSFER_META_MAX_BYTES);
            const decoded = read.ok
              ? decodeRecord(
                  transferMetaSchema,
                  read.value,
                  TRANSFER_META_MAX_BYTES,
                )
              : null;
            if (!decoded?.ok) continue;
            const meta = decoded.value;
            const acked =
              peerAcks.get(meta.to_machine as Id<"mch">)?.has(meta.id) === true;
            const expired = nowMs > Date.parse(meta.expires_at);
            if (acked || expired) {
              await rm(join(base, trfDirName), {
                recursive: true,
                force: true,
              });
              changed += 1;
            }
          }
        }
      }

      if (changed > 0) deps.carryKick();
      return changed;
    },
  };
}

export type TransfersService = ReturnType<typeof createTransfersService>;

export { sha256Hex, sha256Schema };
