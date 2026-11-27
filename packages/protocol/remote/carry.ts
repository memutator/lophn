// 폴더 꼴을 기계 사이의 꼴로 쓰는 약속: 갈 곳 "내 컴퓨터들", 낸 기계가 서명하는 file 목록(manifest)과 그 검증, file을 주고받는
// route, 폴더의 명단 file, 기계를 건너는 event file. 폰도 이 file을 읽어 Node 내장 module과 Buffer를 쓰지 않는다(roster.ts와
// 같다). 설계는 architecture `folder-sync.md`의 "내 컴퓨터들(`computers`)과 옮기는 길".
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
import { remoteKeyBytes, remoteKeyText } from "./noise.ts";
import {
  ROSTER_STATEMENTS_MAX,
  type RosterView,
  rosterStatementSchema,
  signatureTextSchema,
} from "./roster.ts";
import {
  appDir,
  isAppDirName,
  isMachineDirName,
  MACHINES_DIR,
  machineDir,
  parseDataEntry,
  parsePackageEntry,
  parsePackagePath,
  parseSourceEntry,
} from "../folder/layout.ts";
import { CLOCK_AHEAD_MAX_MS } from "../folder/limits.ts";
import {
  commitSchema,
  decodeRecord,
  sourceMetaSchema,
} from "../folder/records.ts";
import { destinationStateSchema } from "../folder/status.ts";

const KIB = 1024;
const MIB = 1024 * KIB;
const DAY = 24 * 60 * 60 * 1000;

// 앱 선언의 `sync`가 table의 값으로 고르는 갈 곳 `"computers"`("내 컴퓨터들"). 그 폴더는 data root 안 `computers/`이고 배치와 file 꼴은
// 이름 붙인 폴더와 같다. 사람은 `folder.destinations`에 이 이름을 쓰지 못한다.
export const COMPUTERS_DESTINATION = "computers";
export const COMPUTERS_DIR = "computers";
// 사람이 고른 "내 컴퓨터들이 같이 보는 폴더"(`{path} | null`). `computers` 폴더의 거울이다.
export const SHARED_FOLDER_KEY = "folder.shared";

export const MANIFEST_MAX_BYTES = 8 * MIB;
export const MANIFEST_SIGN_CONTEXT = "lophn-folder-manifest/1";
// 앱 하나의 file 목록 `apps/<app>/files.json`.
export const APP_FILES_MAX_BYTES = 8 * MIB;
// 앱 목록은 그 앱의 마지막 snapshot과 그 뒤의 data file만 싣는다. 그 뒤 data file이 이보다 많으면 내보내기가 `computers`에
// 새 snapshot을 쓴다(목록이 한도에 닿지 않게).
export const CARRY_DATA_FILES_MAX = 2000;
export const ROSTER_FILE_MAX_BYTES = 8 * MIB;
export const EVENT_FILE_MAX_BYTES = 64 * KIB;
// 쓴 기계는 이보다 옛 자기 event file을 지우고, 읽는 기계는 이보다 옛 event를 내지 않는다.
export const CROSS_EVENT_MAX_AGE_MS = 7 * DAY;
// 이미 낸 event의 기록(`folder_events_seen`)을 두는 때. 나이 한도의 두 배라 기록이 지워진 뒤 같은 event가 아직 한도 안일 수 없다.
export const CROSS_EVENT_SEEN_KEEP_MS = 2 * CROSS_EVENT_MAX_AGE_MS;
// 기계 사이 mail 하나의 file(`machines/<mch>/mail/<mal id>.json`).
export const MAIL_FILE_MAX_BYTES = 128 * KIB;
// 받은 mail의 id 목록 file(`machines/<mch>/mail/acks.json`)이 싣는 id 수와 그 크기의 한도.
export const MAIL_ACKS_MAX = 8000;
export const MAIL_ACKS_MAX_BYTES = 512 * KIB;
// session 하나의 handoff note file(`machines/<mch>/notes/<ses id>.json`).
export const NOTE_FILE_MAX_BYTES = 64 * KIB;
export const CARRY_CHUNK_MAX_BYTES = 8 * MIB;
export const CARRY_WANTS_MAX = 1000;

const machineIdSchema = idSchema("mch");
const appIdSchema = idSchema("app");
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ULID = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const EVENT_FILE_NAME = /^([0-7][0-9a-hjkmnp-tv-z]{25})\.json$/;
const MAIL_FILE_NAME = /^(mal_[0-7][0-9a-hjkmnp-tv-z]{25})\.json$/;
const MAIL_ACKS_NAME = "acks.json";
const NOTE_FILE_NAME = /^(ses_[0-7][0-9a-hjkmnp-tv-z]{25})\.json$/;

export const manifestPath = (machine: Id<"mch">) =>
  `${machineDir(machine)}/manifest.json`;
export const rosterFilePath = (machine: Id<"mch">) =>
  `${machineDir(machine)}/roster.json`;
export const appFilesPath = (machine: Id<"mch">, app: Id<"app">) =>
  `${appDir(machine, app)}/files.json`;
export const eventsDir = (machine: Id<"mch">, app: Id<"app">) =>
  `${appDir(machine, app)}/events`;
export const eventFilePath = (machine: Id<"mch">, app: Id<"app">, id: string) =>
  `${eventsDir(machine, app)}/${id}.json`;

// 그 기계의 outbox에 남은 mail(받는 기계가 아직 받았다고 알리지 않은 것)과 그 기계가 받은 mail의 id 목록을 두는 폴더.
export const mailDir = (machine: Id<"mch">) => `${machineDir(machine)}/mail`;
export const mailFilePath = (machine: Id<"mch">, id: Id<"mal">) =>
  `${mailDir(machine)}/${id}.json`;
export const mailAcksPath = (machine: Id<"mch">) =>
  `${mailDir(machine)}/${MAIL_ACKS_NAME}`;

/** mail 폴더 안 이름이 mail file이면 그 mail id. */
export function mailFileId(name: string): Id<"mal"> | null {
  const match = MAIL_FILE_NAME.exec(name);
  return match === null ? null : (match[1] as Id<"mal">);
}

const isMailName = (name: string) =>
  name === MAIL_ACKS_NAME || MAIL_FILE_NAME.test(name);

/** `machines/<mch>/mail/` 아래의 mail file이나 받은 id 목록이면 그 기계. */
function mailPathMachine(path: string): string | null {
  const parts = path.split("/");
  return parts.length === 4 &&
    parts[0] === MACHINES_DIR &&
    isMachineDirName(parts[1]!) &&
    parts[2] === "mail" &&
    isMailName(parts[3]!)
    ? parts[1]
    : null;
}

// 그 기계의 session이 남긴 handoff note를 두는 폴더. session마다 file 하나다.
export const notesDir = (machine: Id<"mch">) => `${machineDir(machine)}/notes`;
export const noteFilePath = (machine: Id<"mch">, session: Id<"ses">) =>
  `${notesDir(machine)}/${session}.json`;

/** notes 폴더 안 이름이 note file이면 그 session id. */
export function noteFileSession(name: string): Id<"ses"> | null {
  const match = NOTE_FILE_NAME.exec(name);
  return match === null ? null : (match[1] as Id<"ses">);
}

/** `machines/<mch>/notes/` 아래의 note file이면 그 기계. */
function notePathMachine(path: string): string | null {
  const parts = path.split("/");
  return parts.length === 4 &&
    parts[0] === MACHINES_DIR &&
    isMachineDirName(parts[1]!) &&
    parts[2] === "notes" &&
    NOTE_FILE_NAME.test(parts[3]!)
    ? parts[1]
    : null;
}

const CUSTODY_FILE_NAME = /^pcs_[0-9A-HJKMNP-TV-Z]{26}\.json$/;
const STAGED_SETTINGS_FILE_NAME = /^stg_[0-9A-HJKMNP-TV-Z]{26}\.json$/;
const TRANSFER_DIR_NAME = /^trf_[0-9A-HJKMNP-TV-Z]{26}$/;
const TRANSFER_BIN_FILE_NAME = /^[0-9]{4}\.bin$/;
const ACKS_FILE_NAME = "acks.json";

/** `machines/<mch>/transfers/` 아래 file이면 그 기계. */
function transferPathMachine(path: string): string | null {
  const parts = path.split("/");
  if (
    parts[0] !== MACHINES_DIR ||
    !isMachineDirName(parts[1] ?? "") ||
    parts[2] !== "transfers"
  ) {
    return null;
  }
  if (parts.length === 4 && parts[3] === ACKS_FILE_NAME) return parts[1]!;
  if (
    parts.length === 5 &&
    TRANSFER_DIR_NAME.test(parts[3] ?? "") &&
    parts[4] === "meta.json"
  ) {
    return parts[1]!;
  }
  if (
    parts.length === 6 &&
    TRANSFER_DIR_NAME.test(parts[3] ?? "") &&
    parts[4] === "files" &&
    TRANSFER_BIN_FILE_NAME.test(parts[5] ?? "")
  ) {
    return parts[1]!;
  }
  return null;
}

/** `machines/<mch>/custody/` 아래 file이면 그 기계. */
function custodyPathMachine(path: string): string | null {
  const parts = path.split("/");
  return parts.length === 4 &&
    parts[0] === MACHINES_DIR &&
    isMachineDirName(parts[1]!) &&
    parts[2] === "custody" &&
    (parts[3] === ACKS_FILE_NAME || CUSTODY_FILE_NAME.test(parts[3]!))
    ? parts[1]!
    : null;
}

/** `machines/<mch>/staged-settings/` 아래 file이면 그 기계. */
function stagedSettingsPathMachine(path: string): string | null {
  const parts = path.split("/");
  return parts.length === 4 &&
    parts[0] === MACHINES_DIR &&
    isMachineDirName(parts[1]!) &&
    parts[2] === "staged-settings" &&
    (parts[3] === ACKS_FILE_NAME || STAGED_SETTINGS_FILE_NAME.test(parts[3]!))
    ? parts[1]!
    : null;
}

/** `machines/<mch>/manifest.json`이면 그 기계. */
export function manifestPathMachine(path: string): Id<"mch"> | null {
  const parts = path.split("/");
  return parts.length === 3 &&
    parts[0] === MACHINES_DIR &&
    isMachineDirName(parts[1]!) &&
    parts[2] === "manifest.json"
    ? parts[1]
    : null;
}

/**
 * 기계 사이로 옮기는 file의 path(destination 기준)와 그 file의 크기·sha256을 싣는 목록 file. 덮는 사슬은 셋이다.
 * - manifest가 싣는다(`coveredBy` null): `record.json`, `roster.json`, `apps/<app>/files.json`,
 *   `packages/<part>@<version>.json`, `mail/<mal id>.json`, `mail/acks.json`, `notes/<ses id>.json`.
 * - 앱 목록 `apps/<app>/files.json`이 싣는다: `app.json`, `data/<n>.*`, `source/<n>.json`, `events/<id>.json`.
 * - `source/<n>.json`이 `source/<n>.bundle`을 싣는다.
 * 그 밖의 path(`manifest.json` 포함)는 null이다.
 */
export function parseCarryPath(
  path: string,
): { machine: Id<"mch">; coveredBy: string | null } | null {
  const parts = path.split("/");
  if (parts[0] !== MACHINES_DIR || parts.length < 3) return null;
  const machine = parts[1]!;
  if (!isMachineDirName(machine)) return null;
  const top = { machine, coveredBy: null };
  if (parts.length === 3) {
    return parts[2] === "record.json" || parts[2] === "roster.json"
      ? top
      : null;
  }
  if (parts[2] === "packages") {
    return parts.length === 4 && parsePackageEntry(parts[3]!) !== null
      ? top
      : null;
  }
  if (parts[2] === "mail") {
    return parts.length === 4 && isMailName(parts[3]!) ? top : null;
  }
  if (parts[2] === "notes") {
    return parts.length === 4 && NOTE_FILE_NAME.test(parts[3]!) ? top : null;
  }
  if (parts[2] === "transfers") {
    return transferPathMachine(path) === machine ? top : null;
  }
  if (parts[2] === "custody") {
    return custodyPathMachine(path) === machine ? top : null;
  }
  if (parts[2] === "staged-settings") {
    return stagedSettingsPathMachine(path) === machine ? top : null;
  }
  if (parts[2] !== "apps" || !isAppDirName(parts[3]!) || parts.length < 5) {
    return null;
  }
  const app = parts.slice(0, 4).join("/");
  const inApp = { machine, coveredBy: `${app}/files.json` };
  if (parts.length === 5) {
    if (parts[4] === "files.json") return top;
    return parts[4] === "app.json" ? inApp : null;
  }
  const name = parts[5]!;
  switch (parts[4]) {
    case "data":
      return parts.length === 6 && parseDataEntry(name) !== null ? inApp : null;
    case "events":
      return parts.length === 6 && EVENT_FILE_NAME.test(name) ? inApp : null;
    case "source": {
      const entry = parts.length === 6 ? parseSourceEntry(name) : null;
      if (entry === null) return null;
      if (entry.kind === "json") return inApp;
      return {
        machine,
        coveredBy: `${app}/source/${name.replace(/\.bundle$/, ".json")}`,
      };
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

const distinctPaths = (files: readonly CarryFileEntry[]) =>
  new Set(files.map((file) => file.path)).size === files.length;

// `files`는 기존 최상위 file(`record.json`, `roster.json`, 앱마다 `files.json`)만 싣고, `@me/*` package file은 선택 칸
// `packages`로, mail 폴더의 file은 선택 칸 `mail`로, handoff note는 선택 칸 `notes`로 싣는다: 옛 판은 모르는 칸을 버리고 원본
// canonical body로 서명을 검증해 호환이 유지된다.
export const manifestBodySchema = z
  .object({
    format: z.literal(1),
    machine: machineIdSchema,
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    written_at: atSchema,
    files: z.array(fileEntrySchema),
    packages: z.array(fileEntrySchema).optional(),
    mail: z.array(fileEntrySchema).optional(),
    notes: z.array(fileEntrySchema).optional(),
    transfers: z.array(fileEntrySchema).optional(),
    custody: z.array(fileEntrySchema).optional(),
    staged_settings: z.array(fileEntrySchema).optional(),
  })
  .refine(
    (body) =>
      distinctPaths(body.files) &&
      body.files.every((file) => {
        const parsed = parseCarryPath(file.path);
        return (
          parsed !== null &&
          parsed.machine === body.machine &&
          parsed.coveredBy === null &&
          parsePackagePath(file.path) === null &&
          mailPathMachine(file.path) === null &&
          notePathMachine(file.path) === null &&
          transferPathMachine(file.path) === null &&
          custodyPathMachine(file.path) === null &&
          stagedSettingsPathMachine(file.path) === null
        );
      }) &&
      (body.packages === undefined ||
        (distinctPaths(body.packages) &&
          body.packages.every(
            (file) => parsePackagePath(file.path)?.machine === body.machine,
          ))) &&
      (body.mail === undefined ||
        (distinctPaths(body.mail) &&
          body.mail.every(
            (file) => mailPathMachine(file.path) === body.machine,
          ))) &&
      (body.notes === undefined ||
        (distinctPaths(body.notes) &&
          body.notes.every(
            (file) => notePathMachine(file.path) === body.machine,
          ))) &&
      (body.transfers === undefined ||
        (distinctPaths(body.transfers) &&
          body.transfers.every(
            (file) => transferPathMachine(file.path) === body.machine,
          ))) &&
      (body.custody === undefined ||
        (distinctPaths(body.custody) &&
          body.custody.every(
            (file) => custodyPathMachine(file.path) === body.machine,
          ))) &&
      (body.staged_settings === undefined ||
        (distinctPaths(body.staged_settings) &&
          body.staged_settings.every(
            (file) => stagedSettingsPathMachine(file.path) === body.machine,
          ))),
    { message: "manifest files must be distinct top paths of its machine" },
  );
export type ManifestBody = z.infer<typeof manifestBodySchema>;

/** manifest가 직접 싣는 file 모두(`files`와 선택 칸 `packages`·`mail`·`notes`·`transfers`·`custody`·`staged_settings`). */
export function manifestEntries(body: ManifestBody): CarryFileEntry[] {
  return [
    ...body.files,
    ...(body.packages ?? []),
    ...(body.mail ?? []),
    ...(body.notes ?? []),
    ...(body.transfers ?? []),
    ...(body.custody ?? []),
    ...(body.staged_settings ?? []),
  ];
}

// `machines/<mch>/apps/<app>/files.json`: 그 앱의 file 목록. 서명하지 않는다(manifest가 크기·sha256을 싣는다).
export const appFilesSchema = z.object({
  format: z.literal(1),
  machine: machineIdSchema,
  app: appIdSchema,
  written_at: atSchema,
  files: z.array(fileEntrySchema),
});
export type AppFiles = z.infer<typeof appFilesSchema>;

const manifestEnvelopeSchema = z.object({
  body: z.unknown(),
  signature: signatureTextSchema,
});

// 늘기만 한다. previous는 자기 manifest file의 revision과 다른 기계가 되돌려 준 자기 manifest의 revision(표시) 가운데 큰 것이다.
// data root를 되살려 지난 file을 잃어도 시계가 맞거나 표시가 남았으면 앞보다 크다.
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
 * manifest를 서명할 수 있는 key: 명단 view에서 `machine`이 그 값인 컴퓨터 항목이 하나뿐일 때 그 서명 key. 없거나 둘
 * 이상이면 null이다(믿는 컴퓨터가 다른 기계 이름을 단 새 key의 항목에 서명해 그 기계의 file을 대신 내지 못한다).
 */
export function machineSigningKey(
  view: RosterView,
  machine: string,
): string | null {
  const found = view.devices.filter(
    (each) => each.body.kind === "computer" && each.body.machine === machine,
  );
  return found.length === 1 ? found[0]!.body.signing_key : null;
}

/**
 * 그 기계가 명단에서 정해진 빼기로 빠졌고, 지금 그 기계 이름의 컴퓨터가 없고, 그 이름의 정해지지 않은 빼기도 없다. 그때만
 * 받는 쪽이 그 하위 폴더를 지운다. 옛 key를 정해진 빼기로 뺀 뒤 새 key로 돌아온 기계가 빼기 다툼에 걸려 있으면 지우지 않는다.
 */
export function machineRemoved(view: RosterView, machine: string): boolean {
  const named = (each: {
    entry: { kind: string; machine: string | null } | null;
  }) => each.entry?.kind === "computer" && each.entry.machine === machine;
  return (
    view.removed.some((each) => each.settled && named(each)) &&
    !view.removed.some((each) => !each.settled && named(each)) &&
    !view.devices.some(
      (each) => each.body.kind === "computer" && each.body.machine === machine,
    )
  );
}

// 그 기계의 컴퓨터가 이 컴퓨터의 명단에 더 없다: 정해진 빼기로 빠졌거나, 명단에 그 기계의 항목도 정해지지 않은 빼기도 없다(이
// 컴퓨터가 명단에서 빠져 옛 명단을 버린 뒤가 이렇다). 이 컴퓨터의 항목(`self`, 기기 id)이 명단에 없으면 명단을 아직 읽지 못한 것이라
// 아무것도 빠지지 않았다.
export function machineGone(
  view: RosterView,
  self: string | undefined,
  machine: string,
): boolean {
  if (machineRemoved(view, machine)) return true;
  if (
    self === undefined ||
    !view.devices.some((each) => each.body.id === self)
  ) {
    return false;
  }
  return (
    !view.devices.some(
      (each) => each.body.kind === "computer" && each.body.machine === machine,
    ) &&
    !view.removed.some(
      (each) =>
        !each.settled &&
        each.entry?.kind === "computer" &&
        each.entry.machine === machine,
    )
  );
}

/**
 * 받은 manifest 글에서 믿을 body와 맞춘 서명 key. `signingKeyOf(machine)`은 받는 기계의 `machineSigningKey`다. 크기, 꼴,
 * 서명 하나라도 틀리거나 서명 key가 없으면 null이다. 서명은 받은 body 그대로의 canonical 글에 대해 본다(schema가 모르는
 * 칸을 버리기 전). 자기 기계의 manifest도 검증한다(받는 자리가 자기 것은 두지 않고 revision만 본다).
 */
export function verifyManifest(
  text: string,
  signingKeyOf: (machine: Id<"mch">) => string | null,
): { body: ManifestBody; signingKey: string } | null {
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
  if (key === null || keyBytes === undefined) return null;
  try {
    return ed25519.verify(
      signatureBytes(envelope.data.signature),
      message(canonicalize(envelope.data.body)),
      keyBytes,
    )
      ? { body: body.data, signingKey: key }
      : null;
  } catch {
    // 곡선 위의 점이 아닌 key 같은 틀린 입력은 던진다. 서명이 맞지 않는 것과 같다.
    return null;
  }
}

/**
 * 믿는 manifest를 받아 들이는가. `mark`는 받는 쪽이 (그 기계, 그 서명 key)로 받아 들인 가장 큰 revision이다(하위 폴더
 * 밖에 두고 지우지 않는다). revision이 그보다 엄격히 클 때만이다(옛 목록으로 돌아가지 않는다).
 */
export function newerManifest(
  mark: number | null,
  incoming: ManifestBody,
): boolean {
  return mark === null || incoming.revision > mark;
}

type Expected = { size: number; sha256: string };
// 받는 쪽이 든 file의 bytes. 없으면 null.
type HeldBytes = (path: string) => Uint8Array | null;

const pick = (entry: CarryFileEntry | undefined): Expected | null =>
  entry === undefined ? null : { size: entry.size, sha256: entry.sha256 };

// 목록 file `coverPath`가 싣는 file. 받는 쪽이 든 그 목록 file이 기대한 크기·sha256과 같을 때만 믿는다.
function coverEntries(
  machine: string,
  coverPath: string,
  expected: Expected,
  held: HeldBytes,
): CarryFileEntry[] {
  const bytes = held(coverPath);
  if (
    bytes === null ||
    bytes.byteLength !== expected.size ||
    bytesToHex(sha256(bytes)) !== expected.sha256
  ) {
    return [];
  }
  const parts = coverPath.split("/");
  const app = parts[3]!;
  if (parts.length === 5 && parts[4] === "files.json") {
    const list = decodeRecord(appFilesSchema, bytes, APP_FILES_MAX_BYTES);
    if (
      !list.ok ||
      list.value.machine !== machine ||
      list.value.app !== app ||
      !distinctPaths(list.value.files) ||
      !list.value.files.every(
        (file) => parseCarryPath(file.path)?.coveredBy === coverPath,
      )
    ) {
      return [];
    }
    return list.value.files;
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
      path: coverPath.replace(/\.json$/, ".bundle"),
      size: meta.value.size,
      sha256: meta.value.sha256,
    },
  ];
}

export const isCover = (path: string) =>
  /\/(apps\/[^/]+\/files|source\/[0-9]{12})\.json$/.test(path);

/**
 * 믿는 manifest가 path에 기대하는 크기와 sha256. manifest가 싣는 path이거나, 사슬의 목록 file(앱 목록,
 * `source/<n>.json`)이 모두 받는 쪽에 기대한 그대로 들어 있고 그것이 싣는 path일 때만 값이 있다. 볼 때마다 사슬의 목록
 * file을 hash하고 읽으므로 file 여럿은 `expectedFiles`를 한 번 쓴다.
 */
export function expectedFile(
  body: ManifestBody,
  path: string,
  heldBytes: HeldBytes,
): Expected | null {
  const parsed = parseCarryPath(path);
  if (parsed === null || parsed.machine !== body.machine) return null;
  if (parsed.coveredBy === null) {
    return pick(manifestEntries(body).find((file) => file.path === path));
  }
  const cover = expectedFile(body, parsed.coveredBy, heldBytes);
  if (cover === null) return null;
  return pick(
    coverEntries(body.machine, parsed.coveredBy, cover, heldBytes).find(
      (file) => file.path === path,
    ),
  );
}

/** 믿는 manifest가 싣거나 (받는 쪽이 든 맞는 목록 file의 사슬이) 덮는 file 모두. path마다 처음 것이다. */
export function expectedFiles(
  body: ManifestBody,
  heldBytes: HeldBytes,
): Map<string, Expected> {
  const out = new Map<string, Expected>();
  const queue: CarryFileEntry[] = [...manifestEntries(body)];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (out.has(file.path)) continue;
    const expected = { size: file.size, sha256: file.sha256 };
    out.set(file.path, expected);
    // 목록 file만 읽는다(data snapshot 같은 큰 file을 읽지 않는다).
    if (isCover(file.path)) {
      queue.push(...coverEntries(body.machine, file.path, expected, heldBytes));
    }
  }
  return out;
}

// `machines/<mch>/roster.json`: 그 기계가 든 명단 statement. 읽은 쪽은 명단에 넘기기만 한다(서명은 명단 규칙이 본다).
// 주소(reach)는 싣지 않는다: 폴더는 아무나 쓸 수 있어 서명 없는 주소가 기기들이 거는 곳을 바꾸게 하면 안 된다.
export const rosterFileSchema = z.object({
  format: z.literal(1),
  machine: machineIdSchema,
  written_at: atSchema,
  statements: z.array(rosterStatementSchema).max(ROSTER_STATEMENTS_MAX),
});
export type RosterFile = z.infer<typeof rosterFileSchema>;

// `machines/<mch>/apps/<app>/events/<id>.json`: 앱이 다른 기계에도 알리겠다고 낸 event 하나. 도착한 기계가 한 번 낸다.
export const eventFileSchema = z.object({
  format: z.literal(2),
  machine: machineIdSchema,
  app: appIdSchema,
  id: z.string().regex(ULID),
  code_commit: commitSchema,
  name: toolNameSchema,
  payload: jsonValueSchema,
  at: atSchema,
});
export type EventFile = z.infer<typeof eventFileSchema>;

/**
 * 받은 event file을 낼 수 있는가. 난 기계·앱·id는 path에서 얻고(manifest가 서명한 것은 path다) 내용이 다르면 거절한다.
 * `at`이 지금보다 `CLOCK_AHEAD_MAX_MS`를 넘게 앞서거나 `CROSS_EVENT_MAX_AGE_MS`보다 옛 것도 거절한다. 이 기계 활성
 * release와 `code_commit`을 견주는 것과 한 번만 내는 것은 부르는 쪽이 한다.
 */
export function readEventFile(
  path: string,
  bytes: Uint8Array,
  nowMs: number,
): EventFile | null {
  const parts = path.split("/");
  const name = EVENT_FILE_NAME.exec(parts[5] ?? "");
  if (
    name === null ||
    parts.length !== 6 ||
    parts[0] !== MACHINES_DIR ||
    parts[2] !== "apps" ||
    parts[4] !== "events"
  ) {
    return null;
  }
  const file = decodeRecord(eventFileSchema, bytes, EVENT_FILE_MAX_BYTES);
  if (
    !file.ok ||
    file.value.machine !== parts[1] ||
    file.value.app !== parts[3] ||
    file.value.id !== name[1]
  ) {
    return null;
  }
  const at = Date.parse(file.value.at);
  return at <= nowMs + CLOCK_AHEAD_MAX_MS &&
    nowMs - at <= CROSS_EVENT_MAX_AGE_MS
    ? file.value
    : null;
}

// `machines/<mch>/mail/acks.json`: 그 기계가 폴더 길로 받아 적용한(다시 적용하지 않는) mail의 id. 그 mail을 낸 기계는 자기
// outbox에서 이 기계로 가는 줄 가운데 여기 있는 것을 받았다고 적고 지운다. 낸 기계의 file이 사라지면 여기서도 빠진다.
export const mailAcksSchema = z.object({
  format: z.literal(1),
  machine: machineIdSchema,
  mails: z.array(idSchema("mal")).max(MAIL_ACKS_MAX),
});
export type MailAcks = z.infer<typeof mailAcksSchema>;

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
const pathSchema = z.string().min(1).max(2048);

// path가 그 machine의 옮기는 file이거나 그 manifest인가.
const pathOf = (input: { machine: string; path: string }) =>
  parseCarryPath(input.path)?.machine === input.machine ||
  manifestPathMachine(input.path) === input.machine;
const pathMessage = { message: "path is not a carried file of that machine" };

// 이 기계가 든 manifest의 목록: 이 기계 것과 받아 들인 다른 기계 것. 글은 `carry/file`로 `machines/<mch>/manifest.json`을
// 읽는다(든 revision보다 새 것만).
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
        size: count,
        sha256: sha256Schema,
      }),
    ),
  }),
  actors: ["user"],
  reads: ["carry_files"],
  errors: ["unauthorized", "forbidden", "unavailable"],
});

const wantSchema = z.object({
  machine: machineIdSchema,
  path: pathSchema,
});

// 믿는 manifest가 싣거나 덮는데 이 기계에 아직 없는 file. (machine, 우선순위 path: mail → record/roster → 나머지) 순서이고 `after` 뒤부터다. 앞 page를 들지
// 않은 상대도 다음 page로 간다.
export const carryWants = defineRead({
  resource: "carry",
  method: "wants",
  name: "carry.wants",
  input: z.strictObject({
    limit: z.number().int().min(1).max(CARRY_WANTS_MAX).optional(),
    after: wantSchema.optional(),
  }),
  output: z.object({
    files: z.array(wantSchema.extend({ size: count, sha256: sha256Schema })),
  }),
  actors: ["user"],
  reads: ["carry_files"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

// 이 기계가 들고 믿는 manifest가 싣거나 덮는 file(과 든 manifest 글)의 한 구간. 아니면 not_found다.
export const carryFile = defineFile({
  resource: "carry",
  method: "file",
  name: "carry.file",
  input: z
    .strictObject({
      machine: machineIdSchema,
      path: pathSchema,
      offset: offsetSchema,
      length: z.number().int().min(1).max(CARRY_CHUNK_MAX_BYTES),
    })
    .refine(pathOf, pathMessage),
  contentType: "application/octet-stream",
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "not_found"],
});

// file 하나를 조각으로 넘긴다. 첫 조각(offset 0)에서 받는 쪽에 맞는 entry가 없으면 `rejected`이고 아무것도 쓰지 않는다.
// path가 `machines/<mch>/manifest.json`이면 그 글을 manifest로 본다(machine·size·sha256이 글과 같아야 한다).
export const carryPut = defineMemory({
  resource: "carry",
  method: "put",
  name: "carry.put",
  input: z
    .strictObject({
      machine: machineIdSchema,
      path: pathSchema,
      size: count,
      sha256: sha256Schema,
      offset: offsetSchema,
      bytes: base64Schema,
    })
    .refine(pathOf, pathMessage),
  output: z.object({ status: carryPutStatusSchema }),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

// Settings › Sync가 읽는 지금 길: 컴퓨터마다 마지막으로 받은 manifest의 때와 길(이 기계가 든 것만. 다시 뜬 뒤에는 비어 있다), 앱마다
// 다른 기계의 변경을 마지막으로 읽은 때. 기기가 부를 수 없어 `CARRY_ROUTES`에 넣지 않는다.
export const carryStatus = defineRead({
  resource: "carry",
  method: "status",
  name: "carry.status",
  input: z.strictObject({}),
  output: z.object({
    machines: z.array(
      z.object({
        machine: machineIdSchema,
        revision: z.number().int().min(1),
        received_at: atSchema.nullable(),
        via: carryViaSchema.nullable(),
        hub: z.boolean().optional(),
      }),
    ),
    apps: z.array(
      z.object({
        app: appIdSchema,
        name: z.string(),
        // 선언의 `sync`가 그 앱의 table을 보내는 destination(글자 순서).
        destinations: z.array(z.string()),
        read_at: atSchema.nullable(),
      }),
    ),
    // 쓸 수 있는 같이 보는 폴더(`folder.shared`)와 그 상태. 정하지 않았거나 쓰지 못하는 값이면 null이다.
    shared: z
      .object({ path: z.string(), state: destinationStateSchema })
      .nullable(),
  }),
  actors: ["user"],
  reads: ["carry_files", "app_runtime", "settings"],
  errors: ["unauthorized", "forbidden", "unavailable"],
});

// 등록과 handler는 folder wiring이 단다. 이 route가 없는 상대(옛 판)는 `not_found`로 답하고, 나르는 쪽은 그것을 "이 상대는
// 나르지 않는다"로 본다.
export const CARRY_ROUTES = [
  carryManifests,
  carryWants,
  carryFile,
  carryPut,
] as const;
