// 폰 앱 데이터 custody(`app_sync/custody_push`, `app_sync/custody_file`, carry `custody/`).
// Hub 컴퓨터는 폰의 Ed25519 signing_key 서명과 sha256을 검증한 뒤 내용을 변조하지 않고 그대로 보관·전달한다.
// 대상 컴퓨터는 carry로 받은 뒤 서명과 sha256을 다시 검증해 앱 sync 경로에 적용하고 acks.json에 남긴다.
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import {
  canonicalize,
  type Clock,
  err,
  ok,
  type RandomSource,
  type Result,
  sha256Hex,
} from "../../base/mod.ts";
import {
  APP_SYNC_PUSH_MAX_BYTES,
  type appSyncCustodyFile,
  type appSyncCustodyPush,
  CUSTODY_SIGN_CONTEXT,
  type CustodyEnvelopeBody,
  custodyEnvelopeBodySchema,
} from "../../protocol/apps/app-sync.ts";
import { type Id, idSchema } from "../../protocol/base/ids.ts";
import { machineDir } from "../../protocol/folder/layout.ts";
import { decodeRecord, encodeRecord } from "../../protocol/folder/records.ts";
import { verifyDetached } from "../../protocol/remote/roster.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import { createFolderReader, createFolderWriter } from "./fs.ts";
import { toCarryId } from "./transfers.ts";

// base64 + JSON 봉투 여유 포함.
export const CUSTODY_FILE_MAX_BYTES = 16 * 1024 * 1024;
const CUSTODY_ACKS_MAX = 4096;
const CUSTODY_ACKS_MAX_BYTES = 512 * 1024;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export const custodyDir = (machine: Id<"mch">) =>
  `${machineDir(machine)}/custody`;
export const custodyAcksPath = (machine: Id<"mch">) =>
  `${custodyDir(machine)}/acks.json`;
export const custodyFilePath = (machine: Id<"mch">, id: Id<"pcs">) =>
  `${custodyDir(machine)}/${toCarryId(id)}.json`;

const custodyEnvelopeSchema = z.strictObject({
  body: custodyEnvelopeBodySchema,
  signature: z.string().min(1),
});
export type CustodyEnvelope = z.infer<typeof custodyEnvelopeSchema>;

const custodyAcksSchema = z.object({
  format: z.literal(1),
  machine: idSchema("mch"),
  custodies: z.array(idSchema("pcs")).max(CUSTODY_ACKS_MAX),
});

const appliedStoreSchema = z.object({
  applied: z.array(idSchema("pcs")),
});

function hex16(random: RandomSource): string {
  const bytes = new Uint8Array(8);
  random.fill(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function atomicWrite(
  target: string,
  bytes: Uint8Array,
  random: RandomSource,
): Promise<void> {
  const dir = join(target, "..");
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  const temp = join(dir, `${basename(target)}.tmp-${hex16(random)}`);
  const handle = await open(temp, "wx", FILE_MODE);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, target);
}

/**
 * 폰이 서명한 custody 봉투의 Ed25519 서명(`CUSTODY_SIGN_CONTEXT` + `canonicalize(body)`)과
 * payload의 크기·sha256을 검증하고 디코딩된 payload bytes를 돌려준다.
 */
export async function verifyCustodyEnvelope(input: {
  body: CustodyEnvelopeBody;
  signature: string;
  signingKey: string | null;
}): Promise<Result<Uint8Array>> {
  if (input.signingKey === null) {
    return err({
      code: "forbidden",
      message: "phone has no trusted signing key in the roster",
    });
  }
  const verified = verifyDetached(
    CUSTODY_SIGN_CONTEXT,
    canonicalize(input.body),
    input.signature,
    input.signingKey,
  );
  if (!verified) {
    return err({
      code: "forbidden",
      message: "invalid phone custody signature",
    });
  }
  const bytes = new Uint8Array(Buffer.from(input.body.payload, "base64"));
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > APP_SYNC_PUSH_MAX_BYTES ||
    bytes.byteLength !== input.body.size
  ) {
    return err({
      code: "invalid_input",
      message: "custody payload size does not match envelope",
    });
  }
  const actualSha = await sha256Hex(bytes);
  if (actualSha !== input.body.sha256) {
    return err({
      code: "invalid_input",
      message: "custody payload sha256 does not match envelope",
    });
  }
  return ok(bytes);
}

function principalDevice(principal: string): Id<"dev"> | null {
  if (!principal.startsWith("device:")) return null;
  const parsed = idSchema("dev").safeParse(principal.slice("device:".length));
  return parsed.success ? (parsed.data as Id<"dev">) : null;
}

export type CustodyDeps = {
  dataRoot: string;
  computersRoot: string;
  me(): Id<"mch">;
  knownComputer(machine: Id<"mch">): boolean;
  /** 명단에서 `body.kind === "phone"`이고 `body.id === device`인 항목의 signing_key. */
  phoneSigningKey(device: Id<"dev">): string | null;
  deviceKind(principal: string): "phone" | "computer" | null;
  deviceMachine(principal: string): Id<"mch"> | null;
  /** 대상 컴퓨터가 온라인이면 즉시 전달 시도. offline이거나 전달 실패면 null. */
  forwardToTarget?(
    target: Id<"mch">,
    envelope: CustodyEnvelope,
  ): Promise<Result<{ state: "held" | "duplicate" | "applied" }> | null>;
  /** 서명과 sha256이 검증된 custody payload를 이 컴퓨터 앱의 sync 경로로 적용한다. */
  applyLocal(input: {
    custody: Id<"pcs">;
    app: Id<"app">;
    device: Id<"dev">;
    origin: Id<"mch">;
    written_at: string;
    payload: Uint8Array;
  }): Promise<Result<void>>;
  holds(machine: Id<"mch">, path: string): Promise<boolean>;
  clock: Clock;
  random: RandomSource;
  carryKick(): void;
  log(event: string, message: string): void;
};

export function createCustodyService(deps: CustodyDeps) {
  const appliedPath = join(deps.dataRoot, "custody", "applied.json");
  const encoder = new TextEncoder();

  async function readApplied(): Promise<Set<string>> {
    try {
      const text = await readFile(appliedPath, "utf8");
      const parsed = appliedStoreSchema.safeParse(JSON.parse(text));
      return parsed.success ? new Set(parsed.data.applied) : new Set();
    } catch {
      return new Set();
    }
  }

  async function markApplied(id: Id<"pcs">): Promise<void> {
    const set = await readApplied();
    if (set.has(id)) return;
    set.add(id);
    const list = [...set].sort().slice(-CUSTODY_ACKS_MAX);
    await atomicWrite(
      appliedPath,
      encoder.encode(`${JSON.stringify({ applied: list })}\n`),
      deps.random,
    );
  }

  async function writeAcks(acks: readonly Id<"pcs">[]): Promise<Result<void>> {
    const me = deps.me();
    mkdirSync(deps.computersRoot, { recursive: true, mode: DIR_MODE });
    const writer = createFolderWriter({
      root: deps.computersRoot,
      machine: me,
      random: deps.random,
    });
    const path = custodyAcksPath(me);
    const unique = [...new Set(acks)].sort().slice(0, CUSTODY_ACKS_MAX);
    if (unique.length === 0) return await writer.remove(path);
    const reader = createFolderReader(deps.computersRoot);
    const before = await reader.read(path, CUSTODY_ACKS_MAX_BYTES);
    const parsed = before.ok
      ? decodeRecord(custodyAcksSchema, before.value, CUSTODY_ACKS_MAX_BYTES)
      : null;
    if (
      parsed?.ok &&
      canonicalize(parsed.value.custodies) === canonicalize(unique)
    ) {
      return ok(undefined);
    }
    return await writer.writeFile(
      path,
      encodeRecord(custodyAcksSchema, {
        format: 1,
        machine: me,
        custodies: unique,
      }),
    );
  }

  async function readEnvelopeAt(path: string): Promise<CustodyEnvelope | null> {
    const reader = createFolderReader(deps.computersRoot);
    const read = await reader.read(path, CUSTODY_FILE_MAX_BYTES);
    if (!read.ok) return null;
    try {
      const parsed = custodyEnvelopeSchema.safeParse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(read.value),
        ),
      );
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  return {
    async push(
      auth: AuthenticatedContext,
      input: z.infer<typeof appSyncCustodyPush.input>,
    ): Promise<Result<z.infer<typeof appSyncCustodyPush.output>>> {
      const { body, signature } = input;
      const callerDevice = principalDevice(auth.principal);
      if (
        callerDevice !== null &&
        deps.deviceKind(auth.principal) === "phone" &&
        callerDevice !== body.device
      ) {
        return err({
          code: "forbidden",
          message: "phone cannot push custody on behalf of another device",
        });
      }

      const verified = await verifyCustodyEnvelope({
        body,
        signature,
        signingKey: deps.phoneSigningKey(body.device as Id<"dev">),
      });
      if (!verified.ok) return verified;

      const me = deps.me();
      // 대상이 이 컴퓨터 자신이면 바로 적용한다.
      if (body.target === me) {
        const already = await readApplied();
        if (already.has(body.custody)) {
          return ok({ custody: body.custody, hub: me, state: "duplicate" });
        }
        const applied = await deps.applyLocal({
          custody: body.custody as Id<"pcs">,
          app: body.app as Id<"app">,
          device: body.device as Id<"dev">,
          origin: me,
          written_at: body.written_at,
          payload: verified.value,
        });
        if (!applied.ok) return applied;
        await markApplied(body.custody as Id<"pcs">);
        return ok({ custody: body.custody, hub: me, state: "applied" });
      }

      if (!deps.knownComputer(body.target as Id<"mch">)) {
        return err({
          code: "not_found",
          message: `target computer ${body.target} is not in the roster`,
        });
      }

      const rel = custodyFilePath(me, body.custody as Id<"pcs">);
      const existing = await readEnvelopeAt(rel);
      if (existing !== null) {
        if (existing.body.sha256 === body.sha256) {
          return ok({ custody: body.custody, hub: me, state: "duplicate" });
        }
        return err({
          code: "forbidden",
          message: "custody id already held with different payload",
        });
      }

      // 대상이 온라인이면 즉시 전달을 시도하고, 안 되면 hub carry 보관으로 넘긴다.
      if (deps.forwardToTarget !== undefined) {
        const forwarded = await deps.forwardToTarget(body.target as Id<"mch">, {
          body,
          signature,
        });
        if (
          forwarded !== null &&
          forwarded.ok &&
          (forwarded.value.state === "applied" ||
            forwarded.value.state === "duplicate")
        ) {
          return ok({
            custody: body.custody,
            hub: me,
            state: forwarded.value.state,
          });
        }
      }

      await mkdir(deps.computersRoot, { recursive: true, mode: DIR_MODE });
      const writer = createFolderWriter({
        root: deps.computersRoot,
        machine: me,
        random: deps.random,
      });
      const bytes = encoder.encode(`${JSON.stringify({ body, signature })}\n`);
      if (bytes.byteLength > CUSTODY_FILE_MAX_BYTES) {
        return err({
          code: "invalid_input",
          message: "custody envelope exceeds size limit",
        });
      }
      const written = await writer.writeFile(rel, bytes);
      if (!written.ok) return written;
      deps.carryKick();
      return ok({ custody: body.custody, hub: me, state: "held" });
    },

    async readFile(
      auth: AuthenticatedContext,
      input: z.infer<typeof appSyncCustodyFile.input>,
    ): Promise<Result<Uint8Array>> {
      const me = deps.me();
      const id = input.custody as Id<"pcs">;
      let envelope = await readEnvelopeAt(custodyFilePath(me, id));
      if (envelope === null) {
        const reader = createFolderReader(deps.computersRoot);
        const machines = await reader.listMachines();
        if (machines.ok) {
          for (const origin of machines.value) {
            if (origin === me) continue;
            const path = custodyFilePath(origin, id);
            if (!(await deps.holds(origin, path))) continue;
            envelope = await readEnvelopeAt(path);
            if (envelope !== null) break;
          }
        }
      }
      if (envelope === null) {
        return err({ code: "not_found", message: `custody ${id} not found` });
      }

      // 인증된 대상 컴퓨터·원래 폰·로컬 사람만 읽을 수 있다.
      const callerDevice = principalDevice(auth.principal);
      if (callerDevice !== null) {
        const kind = deps.deviceKind(auth.principal);
        if (kind === "phone") {
          if (callerDevice !== envelope.body.device) {
            return err({
              code: "forbidden",
              message: "this custody file belongs to another device",
            });
          }
        } else if (kind === "computer") {
          const machine = deps.deviceMachine(auth.principal);
          if (machine !== envelope.body.target && machine !== me) {
            return err({
              code: "forbidden",
              message: "this custody file is for another computer",
            });
          }
        } else {
          return err({
            code: "forbidden",
            message: "unknown device cannot read custody file",
          });
        }
      }

      const payload = new Uint8Array(
        Buffer.from(envelope.body.payload, "base64"),
      );
      if (input.offset > payload.byteLength) {
        return err({
          code: "invalid_input",
          message: "offset exceeds custody payload size",
        });
      }
      return ok(payload.subarray(input.offset, input.offset + input.length));
    },

    /**
     * Hub가 나른 `custody/<pcs>.json` 가운데 대상이 이 컴퓨터인 것을 서명·sha256 재검증 후
     * 앱 sync 경로에 적용하고 `custody/acks.json`에 완료를 남긴다.
     */
    async processIncoming(): Promise<number> {
      const me = deps.me();
      const reader = createFolderReader(deps.computersRoot);
      const machines = await reader.listMachines();
      if (!machines.ok) return 0;

      const appliedSet = await readApplied();
      const ackIds: Id<"pcs">[] = [];
      let appliedCount = 0;

      for (const origin of machines.value) {
        if (origin === me) continue;
        let names: string[];
        try {
          names = await readdir(
            join(deps.computersRoot, ...custodyDir(origin).split("/")),
          );
        } catch {
          continue;
        }
        for (const name of names.sort()) {
          if (!/^pcs_[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}\.json$/.test(name)) {
            continue;
          }
          const rel = `${custodyDir(origin)}/${name}`;
          if (!(await deps.holds(origin, rel))) continue;
          const envelope = await readEnvelopeAt(rel);
          if (envelope === null) {
            deps.log("custody_file_invalid", `${rel} is not valid custody`);
            continue;
          }
          const { body, signature } = envelope;
          if (`${body.custody}.json` !== name.toLowerCase()) {
            deps.log(
              "custody_id_mismatch",
              `${rel} does not match body.custody`,
            );
            continue;
          }
          if (body.target !== me) continue;

          if (appliedSet.has(body.custody)) {
            ackIds.push(body.custody as Id<"pcs">);
            continue;
          }

          // 대상 컴퓨터에서 폰 signing_key로 서명과 sha256을 반드시 다시 검증한다.
          const verified = await verifyCustodyEnvelope({
            body,
            signature,
            signingKey: deps.phoneSigningKey(body.device as Id<"dev">),
          });
          if (!verified.ok) {
            deps.log(
              "custody_verify_failed",
              `${rel}: ${verified.error.message}`,
            );
            continue;
          }

          const applied = await deps.applyLocal({
            custody: body.custody as Id<"pcs">,
            app: body.app as Id<"app">,
            device: body.device as Id<"dev">,
            origin,
            written_at: body.written_at,
            payload: verified.value,
          });
          if (!applied.ok) {
            deps.log(
              "custody_apply_failed",
              `${rel}: ${applied.error.message}`,
            );
            continue;
          }
          await markApplied(body.custody as Id<"pcs">);
          appliedSet.add(body.custody);
          ackIds.push(body.custody as Id<"pcs">);
          appliedCount += 1;
        }
      }

      const acked = await writeAcks(ackIds);
      if (!acked.ok) {
        deps.log("custody_acks_not_written", acked.error.message);
      }
      if (appliedCount > 0) deps.carryKick();
      return appliedCount;
    },

    /**
     * 대상 컴퓨터의 `custody/acks.json`을 읽어 hub가 맡고 있던 `<pcs>.json`을 정리한다.
     */
    async processAcks(): Promise<number> {
      const me = deps.me();
      const reader = createFolderReader(deps.computersRoot);
      const machines = await reader.listMachines();
      if (!machines.ok) return 0;

      const peerAcks = new Map<Id<"mch">, Set<string>>();
      for (const peer of machines.value) {
        if (peer === me) continue;
        const path = custodyAcksPath(peer);
        if (!(await deps.holds(peer, path))) continue;
        const read = await reader.read(path, CUSTODY_ACKS_MAX_BYTES);
        const parsed = read.ok
          ? decodeRecord(custodyAcksSchema, read.value, CUSTODY_ACKS_MAX_BYTES)
          : null;
        if (parsed?.ok && parsed.value.machine === peer) {
          peerAcks.set(peer, new Set(parsed.value.custodies));
        }
      }

      if (!existsSync(deps.computersRoot)) return 0;
      let names: string[];
      try {
        names = await readdir(
          join(deps.computersRoot, ...custodyDir(me).split("/")),
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
        if (!/^pcs_[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}\.json$/.test(name)) {
          continue;
        }
        const rel = `${custodyDir(me)}/${name}`;
        const envelope = await readEnvelopeAt(rel);
        if (envelope === null) continue;
        if (
          peerAcks
            .get(envelope.body.target as Id<"mch">)
            ?.has(envelope.body.custody) === true
        ) {
          const done = await writer.remove(rel);
          if (done.ok) removed += 1;
        }
      }
      if (removed > 0) deps.carryKick();
      return removed;
    },
  };
}

export type CustodyService = ReturnType<typeof createCustodyService>;
