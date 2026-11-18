// 폴더 꼴을 기계 사이의 꼴로 쓰는 약속: 갈 곳 "내 컴퓨터들", 낸 기계가 서명하는 file 목록(manifest)과 그 검증, file을 주고받는
// route, 폴더의 명단 file, 기계를 건너는 event file. 폰도 이 file을 읽어 Node 내장 module과 Buffer를 쓰지 않는다(roster.ts와
// 같다). 설계는 architecture `folder-sync.md`의 "기계 사이로 옮기기".
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";
import { canonicalize } from "../../base/mod.ts";
import { toolNameSchema } from "../apps/channel-values.ts";
import { jsonValueSchema } from "../base/json-values.ts";
import { type Id, idSchema } from "../base/ids.ts";
import { defineFile, defineMemory, defineRead } from "../base/route.ts";
import { atSchema, sha256Schema } from "../base/values.ts";
import { remoteKeyBytes, remoteKeyText } from "../remote/noise.ts";
import { rosterSnapshotSchema, signatureTextSchema } from "../remote/roster.ts";
import {
  isAppDirName,
  isBundleHashName,
  isMachineDirName,
  isSafeRelativePath,
  MACHINES_DIR,
  machineDir,
  appDir,
  parseDataEntry,
  parseSourceEntry,
} from "./layout.ts";
import { RELEASE_RECORD_MAX_BYTES } from "./limits.ts";
import {
  decodeRecord,
  releaseRecordSchema,
  sourceMetaSchema,
} from "./records.ts";

const KIB = 1024;
const MIB = 1024 * KIB;
const DAY = 24 * 60 * 60 * 1000;

// 앱 선언 `sync_to: "computers"`가 고르는 갈 곳 "내 컴퓨터들". 그 폴더는 data root 안 `computers/`이고 배치와 file 꼴은
// 이름 붙인 폴더와 같다. 사람은 `folder.destinations`에 이 이름을 쓰지 못한다.
export const COMPUTERS_DESTINATION = "computers";
export const COMPUTERS_DIR = "computers";
// 사람이 고른 "내 컴퓨터들이 같이 보는 폴더"(`{path} | null`). `computers` 폴더의 거울이다.
export const SHARED_FOLDER_KEY = "folder.shared";

export const MANIFEST_MAX_BYTES = 8 * MIB;
export const MANIFEST_SIGN_CONTEXT = "lophn-folder-manifest/1";
export const ROSTER_FILE_MAX_BYTES = 8 * MIB;
export const EVENT_FILE_MAX_BYTES = 64 * KIB;
// 쓴 기계는 이보다 옛 자기 event file을 지우고, 읽는 기계는 이보다 옛 event를 내지 않는다.
export const CROSS_EVENT_MAX_AGE_MS = 7 * DAY;
export const CARRY_CHUNK_MAX_BYTES = 8 * MIB;
export const CARRY_WANTS_MAX = 1000;
// `carry/put`이 manifest를 넘길 때 쓰는 path.
export const MANIFEST_PUT_PATH = "manifest.json";

const machineIdSchema = idSchema("mch");
const appIdSchema = idSchema("app");
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ULID = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const EVENT_FILE_NAME = /^[0-7][0-9a-hjkmnp-tv-z]{25}\.json$/;
const COVER_FILE =
  /\/(releases\/[0-9a-f]{64}\/release|source\/[0-9]{12})\.json$/;

export const manifestPath = (machine: Id<"mch">) =>
  `${machineDir(machine)}/manifest.json`;
export const rosterFilePath = (machine: Id<"mch">) =>
  `${machineDir(machine)}/roster.json`;
export const eventsDir = (machine: Id<"mch">, app: Id<"app">) =>
  `${appDir(machine, app)}/events`;
export const eventFilePath = (machine: Id<"mch">, app: Id<"app">, id: string) =>
  `${eventsDir(machine, app)}/${id}.json`;

/**
 * 기계 사이로 옮기는 file의 path(destination 기준). manifest가 싣는 file은 `coveredBy`가 null이고, 싣지 않고 목록 file이
 * 덮는 file(release의 `files/<path>`, `source/<n>.bundle`)은 그 목록 file의 path다. 그 밖의 path(`manifest.json` 포함)는 null이다.
 */
export function parseCarryPath(
  path: string,
): { machine: Id<"mch">; coveredBy: string | null } | null {
  const parts = path.split("/");
  if (parts[0] !== MACHINES_DIR || parts.length < 3) return null;
  const machine = parts[1]!;
  if (!isMachineDirName(machine)) return null;
  const listed = { machine, coveredBy: null };
  if (parts.length === 3) {
    return parts[2] === "record.json" || parts[2] === "roster.json"
      ? listed
      : null;
  }
  if (parts[2] !== "apps" || !isAppDirName(parts[3]!) || parts.length < 5) {
    return null;
  }
  if (parts.length === 5) return parts[4] === "app.json" ? listed : null;
  const name = parts[5]!;
  const app = parts.slice(0, 4).join("/");
  switch (parts[4]) {
    case "data":
      return parts.length === 6 && parseDataEntry(name) !== null
        ? listed
        : null;
    case "events":
      return parts.length === 6 && EVENT_FILE_NAME.test(name) ? listed : null;
    case "source": {
      const entry = parts.length === 6 ? parseSourceEntry(name) : null;
      if (entry === null) return null;
      if (entry.kind === "json") return listed;
      return {
        machine,
        coveredBy: `${app}/source/${name.replace(/\.bundle$/, ".json")}`,
      };
    }
    case "releases": {
      if (!isBundleHashName(name)) return null;
      if (parts.length === 7 && parts[6] === "release.json") return listed;
      if (
        parts.length >= 8 &&
        parts[6] === "files" &&
        isSafeRelativePath(parts.slice(7).join("/"))
      ) {
        return { machine, coveredBy: `${app}/releases/${name}/release.json` };
      }
      return null;
    }
    default:
      return null;
  }
}

const fileEntrySchema = z.object({
  path: z.string().min(1).max(2048),
  size: count,
  sha256: sha256Schema,
});
export type CarryFileEntry = z.infer<typeof fileEntrySchema>;

// path는 모두 `machines/<machine>/`의 실는 file이고 겹치지 않는다. 덮이는 file과 `manifest.json`은 싣지 않는다.
export const manifestBodySchema = z
  .object({
    format: z.literal(1),
    machine: machineIdSchema,
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    written_at: atSchema,
    files: z.array(fileEntrySchema),
  })
  .refine(
    (body) =>
      new Set(body.files.map((file) => file.path)).size === body.files.length &&
      body.files.every((file) => {
        const parsed = parseCarryPath(file.path);
        return (
          parsed !== null &&
          parsed.machine === body.machine &&
          parsed.coveredBy === null
        );
      }),
    { message: "manifest files must be distinct listed paths of its machine" },
  );
export type ManifestBody = z.infer<typeof manifestBodySchema>;

const manifestEnvelopeSchema = z.object({
  body: z.unknown(),
  signature: signatureTextSchema,
});

// 늘기만 한다: 지난 revision은 자기 manifest file에서 읽는다. data root를 되살려 지난 file을 잃어도 시계가 맞으면 앞보다 크다.
export function nextManifestRevision(
  previous: number | null,
  nowMs: number,
): number {
  return Math.max((previous ?? 0) + 1, nowMs);
}

const encoder = new TextEncoder();

function message(bodyText: string): Uint8Array {
  return encoder.encode(`${MANIFEST_SIGN_CONTEXT}\n${bodyText}`);
}

// base64url(패딩 없음) 글자를 bytes로. 꼴은 schema가 이미 보았다.
function signatureBytes(text: string): Uint8Array {
  const base64 = text.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** manifest file의 글(`manifest.json`)을 만든다. secretKey는 그 기계의 명단 서명 key다. 틀린 body는 부르는 쪽 실수라 던진다. */
export function signManifest(
  body: z.input<typeof manifestBodySchema>,
  secretKey: Uint8Array,
): string {
  const checked = manifestBodySchema.parse(body);
  const signature = remoteKeyText(
    ed25519.sign(message(canonicalize(checked)), secretKey),
  );
  return `${JSON.stringify({ body: checked, signature })}\n`;
}

/**
 * 받은 manifest 글에서 믿을 body. `signingKeyOf(machine)`은 받는 기계의 명단 view에서 `machine`이 그 값인 컴퓨터 항목의
 * 서명 key이고 없으면 null이다. 크기, 꼴, 서명 하나라도 틀리거나 서명자를 모르면 null이다. 서명은 받은 body 그대로의
 * canonical 글에 대해 본다(schema가 모르는 칸을 버리기 전).
 */
export function verifyManifest(
  text: string,
  signingKeyOf: (machine: Id<"mch">) => string | null,
): ManifestBody | null {
  if (encoder.encode(text).byteLength > MANIFEST_MAX_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const envelope = manifestEnvelopeSchema.safeParse(json);
  if (!envelope.success) return null;
  const body = manifestBodySchema.safeParse(envelope.data.body);
  if (!body.success) return null;
  const key = signingKeyOf(body.data.machine as Id<"mch">);
  const keyBytes = key === null ? undefined : remoteKeyBytes(key);
  if (keyBytes === undefined) return null;
  try {
    return ed25519.verify(
      signatureBytes(envelope.data.signature),
      message(canonicalize(envelope.data.body)),
      keyBytes,
    )
      ? body.data
      : null;
  } catch {
    // 곡선 위의 점이 아닌 key 같은 틀린 입력은 던진다. 서명이 맞지 않는 것과 같다.
    return null;
  }
}

/** 든 manifest를 incoming으로 바꾸는가. revision이 엄격히 클 때만이다(옛 목록으로 돌아가지 않는다). */
export function newerManifest(
  held: ManifestBody | null,
  incoming: ManifestBody,
): boolean {
  return held === null || incoming.revision > held.revision;
}

type Expected = { size: number; sha256: string };
// 받는 쪽이 든 file의 bytes. 없으면 null.
type HeldBytes = (path: string) => Uint8Array | null;

// 목록 file `cover`(manifest가 싣는 `release.json`·`source/<n>.json`)가 덮는 file. 받는 쪽이 든 그 목록 file이 manifest의
// 크기·sha256과 같을 때만 믿는다.
function covered(
  machine: Id<"mch">,
  cover: CarryFileEntry,
  held: HeldBytes,
): CarryFileEntry[] {
  const bytes = held(cover.path);
  if (
    bytes === null ||
    bytes.byteLength !== cover.size ||
    bytesToHex(sha256(bytes)) !== cover.sha256
  ) {
    return [];
  }
  const parts = cover.path.split("/");
  const app = parts[3]!;
  const base = parts.slice(0, 5).join("/");
  if (parts[4] === "releases") {
    const record = decodeRecord(
      releaseRecordSchema,
      bytes,
      RELEASE_RECORD_MAX_BYTES,
    );
    if (
      !record.ok ||
      record.value.machine !== machine ||
      record.value.app !== app ||
      record.value.bundle_hash !== parts[5]
    ) {
      return [];
    }
    return record.value.files.map((file) => ({
      path: `${base}/${parts[5]}/files/${file.path}`,
      size: file.size,
      sha256: file.sha256,
    }));
  }
  if (parts[4] !== "source") return [];
  const meta = decodeRecord(sourceMetaSchema, bytes);
  const entry = parseSourceEntry(parts[5]!);
  if (
    !meta.ok ||
    entry === null ||
    meta.value.machine !== machine ||
    meta.value.app !== app ||
    meta.value.n !== entry.n
  ) {
    return [];
  }
  return [
    {
      path: cover.path.replace(/\.json$/, ".bundle"),
      size: meta.value.size,
      sha256: meta.value.sha256,
    },
  ];
}

/**
 * 믿는 manifest가 path에 기대하는 크기와 sha256. manifest가 싣는 path이거나, 받는 쪽이 이미 든 맞는 `release.json`·
 * `source/<n>.json`이 덮는 path일 때만 값이 있다. 덮는 file을 볼 때마다 그 목록 file을 hash하고 읽으므로 file 여럿은
 * `expectedFiles`를 한 번 쓴다.
 */
export function expectedFile(
  body: ManifestBody,
  path: string,
  heldBytes: HeldBytes,
): Expected | null {
  const parsed = parseCarryPath(path);
  if (parsed === null || parsed.machine !== body.machine) return null;
  const pick = (entry: CarryFileEntry | undefined) =>
    entry === undefined ? null : { size: entry.size, sha256: entry.sha256 };
  if (parsed.coveredBy === null) {
    return pick(body.files.find((file) => file.path === path));
  }
  const cover = body.files.find((file) => file.path === parsed.coveredBy);
  if (cover === undefined) return null;
  return pick(
    covered(body.machine as Id<"mch">, cover, heldBytes).find(
      (file) => file.path === path,
    ),
  );
}

/** 믿는 manifest가 싣거나(받는 쪽이 든 맞는 목록 file이) 덮는 file 모두. path마다 처음 것이다. */
export function expectedFiles(
  body: ManifestBody,
  heldBytes: HeldBytes,
): Map<string, Expected> {
  const out = new Map<string, Expected>();
  const add = (file: CarryFileEntry) => {
    if (!out.has(file.path)) {
      out.set(file.path, { size: file.size, sha256: file.sha256 });
    }
  };
  for (const file of body.files) {
    add(file);
    // 목록 file만 읽는다(data snapshot 같은 큰 file을 읽지 않는다).
    if (COVER_FILE.test(file.path)) {
      for (const each of covered(body.machine as Id<"mch">, file, heldBytes)) {
        add(each);
      }
    }
  }
  return out;
}

// `machines/<mch>/roster.json`: 그 기계의 명단 사본. 읽은 쪽은 명단에 넘기기만 한다(서명은 명단 규칙이 본다).
export const rosterFileSchema = z.object({
  format: z.literal(1),
  machine: machineIdSchema,
  written_at: atSchema,
  roster: rosterSnapshotSchema,
});
export type RosterFile = z.infer<typeof rosterFileSchema>;

// `machines/<mch>/apps/<app>/events/<id>.json`: 앱이 다른 기계에도 알리겠다고 낸 event 하나. 도착한 기계가 한 번 낸다.
export const eventFileSchema = z.object({
  format: z.literal(1),
  machine: machineIdSchema,
  app: appIdSchema,
  id: z.string().regex(ULID),
  bundle_hash: sha256Schema,
  name: toolNameSchema,
  payload: jsonValueSchema,
  at: atSchema,
});
export type EventFile = z.infer<typeof eventFileSchema>;

// 받은 file이 어느 길로 왔나.
export const carryViaSchema = z.enum(["link", "phone", "folder"]);
export type CarryVia = z.infer<typeof carryViaSchema>;

export const carryPutStatusSchema = z.enum([
  "partial",
  "accepted",
  "have",
  "rejected",
]);
export type CarryPutStatus = z.infer<typeof carryPutStatusSchema>;

const offsetSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const base64Schema = z
  .string()
  .max(Math.ceil(CARRY_CHUNK_MAX_BYTES / 3) * 4)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/);

// path가 그 machine의 옮기는 file인가(put은 `manifest.json`도).
const pathOf = (machine: string, path: string) =>
  parseCarryPath(path)?.machine === machine;

// 이 기계가 든 manifest: 이 기계 것과 받아 들인 다른 기계 것.
export const carryManifests = defineRead({
  resource: "carry",
  method: "manifests",
  name: "carry.manifests",
  input: z.strictObject({}),
  output: z.object({
    manifests: z.array(
      z.object({
        machine: machineIdSchema,
        revision: z.number().int().min(1),
        text: z.string(),
      }),
    ),
  }),
  actors: ["user"],
  errors: ["unauthorized", "forbidden", "unavailable"],
});

// 믿는 manifest가 싣거나 덮는데 이 기계에 아직 없는 file.
export const carryWants = defineRead({
  resource: "carry",
  method: "wants",
  name: "carry.wants",
  input: z.strictObject({
    limit: z.number().int().min(1).max(CARRY_WANTS_MAX).optional(),
  }),
  output: z.object({
    files: z.array(
      z.object({
        machine: machineIdSchema,
        path: z.string(),
        size: count,
        sha256: sha256Schema,
      }),
    ),
  }),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

// 이 기계가 들고 믿는 manifest가 싣거나 덮는 file의 한 구간. 아니면 not_found다.
export const carryFile = defineFile({
  resource: "carry",
  method: "file",
  name: "carry.file",
  input: z
    .strictObject({
      machine: machineIdSchema,
      path: z.string().min(1).max(2048),
      offset: offsetSchema,
      length: z.number().int().min(1).max(CARRY_CHUNK_MAX_BYTES),
    })
    .refine((input) => pathOf(input.machine, input.path), {
      message: "path is not a carried file of that machine",
    }),
  contentType: "application/octet-stream",
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "not_found"],
});

// file 하나를 조각으로 넘긴다. 첫 조각(offset 0)에서 받는 쪽에 맞는 entry가 없으면 `rejected`이고 아무것도 쓰지 않는다.
// path가 `manifest.json`이면 그 machine의 manifest 글이다.
export const carryPut = defineMemory({
  resource: "carry",
  method: "put",
  name: "carry.put",
  input: z
    .strictObject({
      machine: machineIdSchema,
      path: z.string().min(1).max(2048),
      size: count,
      sha256: sha256Schema,
      offset: offsetSchema,
      bytes: base64Schema,
    })
    .refine(
      (input) =>
        input.path === MANIFEST_PUT_PATH || pathOf(input.machine, input.path),
      { message: "path is not a carried file of that machine" },
    ),
  output: z.object({ status: carryPutStatusSchema }),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

// 등록과 handler는 folder wiring이 단다.
export const CARRY_ROUTES = [
  carryManifests,
  carryWants,
  carryFile,
  carryPut,
] as const;
