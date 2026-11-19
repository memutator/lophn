// 변경·snapshot file(`.changes`, `.snapshot`)의 꼴. 폴더든 API든 같은 bytes다.
//   1행  "lophn-folder <판> <changes|snapshot> <2행 bytes(끝 \n 포함)의 sha256 hex>\n"
//   2행  header JSON 한 줄 + "\n"
//   나머지  payload, 정확히 header.payload.size bytes, sha256 = header.payload.sha256
// 1행이 2행의 hash를 싣고 2행이 payload의 크기와 hash를 실어, 끝까지 쓰기 전에 payload hash만 알면 큰 snapshot도
// 한 번에 이어 쓰고, 잘리거나 덧붙은 file은 크기와 hash로 알아본다.
// 큰 file의 payload hash는 부르는 쪽이 stream으로 계산해 `verifyContainer`에 넘긴다(protocol은 incremental hasher가 없다).
import { z } from "zod";
import { ok, type Result, sha256Hex } from "../../base/mod.ts";
import { type Id, idSchema } from "../base/ids.ts";
import { atSchema, sha256Schema } from "../base/values.ts";
import { parseDataPath } from "./layout.ts";
import {
  CHANGES_FILE_MAX_COUNT,
  CHANGES_PAYLOAD_MAX_BYTES,
  FOLDER_CHANGE_MAX_BYTES,
  HEADER_MAX_BYTES,
  SNAPSHOT_PAYLOAD_MAX_BYTES,
} from "./limits.ts";
import {
  commitSchema,
  FOLDER_FORMAT,
  fileError,
  type FolderFileError,
  hlcSchema,
} from "./records.ts";

const MAGIC = "lophn-folder";
// "lophn-folder <판> snapshot <64 hex>\n"가 넉넉히 들어가는 길이. 이 안에 \n이 없으면 1행이 아니다.
const LINE1_MAX_BYTES = 128;
/** 2행 끝까지 읽는 데 필요한 앞부분의 최대 길이. 큰 file은 이만큼만 읽어 `readContainerHead`에 넘긴다. */
export const CONTAINER_HEAD_MAX_BYTES = LINE1_MAX_BYTES + HEADER_MAX_BYTES;

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const changeMetaSchema = z.object({
  // 주인 sync log의 seq. 주인 기계 안에서 다시 쓰지 않는다.
  id: z.string().regex(/^[1-9][0-9]{0,18}$/),
  hlc: hlcSchema,
  origin: z.enum(["computer", "device", "rewind"]),
  // 그 변경을 낸 invocation의 operation과 시작 시각. 없으면 null.
  operation: z.string().nullable(),
  started_at: atSchema.nullable(),
});
export type ChangeMeta = z.infer<typeof changeMetaSchema>;

const changeEntrySchema = changeMetaSchema.extend({
  offset: count,
  size: count,
});

const headerFields = {
  machine: idSchema("mch"),
  app: idSchema("app"),
  n: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  release: z.object({ code_commit: commitSchema, data_schema: count }),
  created_at: atSchema,
  payload: z.object({ size: count, sha256: sha256Schema }),
};

// 모르는 칸은 버린다. changes file은 payload를 겹치지 않고 빈틈없이 덮는 변경 목록을 싣고, snapshot은 싣지 않는다.
export const containerHeaderSchema = z
  .discriminatedUnion("kind", [
    z.object({
      ...headerFields,
      kind: z.literal("changes"),
      changes: z.array(changeEntrySchema).min(1),
    }),
    z.object({ ...headerFields, kind: z.literal("snapshot") }),
  ])
  .superRefine((header, ctx) => {
    if (header.kind !== "changes") return;
    let next = 0;
    for (const change of header.changes) {
      if (change.offset !== next) {
        ctx.addIssue({
          code: "custom",
          message: "changes do not cover the payload in order",
        });
        return;
      }
      next += change.size;
    }
    if (next !== header.payload.size) {
      ctx.addIssue({
        code: "custom",
        message: "changes do not cover the whole payload",
      });
    }
  });
export type ContainerHeader = z.infer<typeof containerHeaderSchema>;

export type ContainerHead = { header: ContainerHeader; payloadOffset: number };

/** header의 machine·app·n·kind가 file path(destination 기준)에서 읽은 것과 같은가. */
export function matchesPath(header: ContainerHeader, rel: string): boolean {
  const place = parseDataPath(rel);
  return (
    place !== null &&
    place.machine === header.machine &&
    place.app === header.app &&
    place.n === header.n &&
    place.kind === header.kind
  );
}

function limitError(
  header: ContainerHeader,
): Result<never, FolderFileError> | null {
  if (header.kind === "snapshot") {
    return header.payload.size > SNAPSHOT_PAYLOAD_MAX_BYTES
      ? fileError("too_large", "snapshot payload is over the limit")
      : null;
  }
  if (header.payload.size > CHANGES_PAYLOAD_MAX_BYTES) {
    return fileError("too_large", "changes payload is over the limit");
  }
  if (header.changes.length > CHANGES_FILE_MAX_COUNT) {
    return fileError("too_large", "changes file has too many changes");
  }
  if (header.changes.some((change) => change.size > FOLDER_CHANGE_MAX_BYTES)) {
    return fileError("too_large", "a change is over the limit");
  }
  return null;
}

/** 1행과 2행. 큰 snapshot은 부르는 쪽이 payload hash를 먼저 계산해 header에 싣고 payload를 이 뒤에 이어 쓴다. */
export async function containerPrefix(
  header: z.input<typeof containerHeaderSchema>,
): Promise<Result<Uint8Array, FolderFileError>> {
  const parsed = containerHeaderSchema.safeParse(header);
  if (!parsed.success) {
    return fileError("invalid_file", "container header is not valid");
  }
  const limited = limitError(parsed.data);
  if (limited !== null) return limited;
  const line2 = new TextEncoder().encode(`${JSON.stringify(parsed.data)}\n`);
  if (line2.byteLength > HEADER_MAX_BYTES) {
    return fileError("too_large", "container header is over the limit");
  }
  const line1 = new TextEncoder().encode(
    `${MAGIC} ${FOLDER_FORMAT.version} ${header.kind} ${await sha256Hex(line2)}\n`,
  );
  const head = new Uint8Array(line1.byteLength + line2.byteLength);
  head.set(line1);
  head.set(line2, line1.byteLength);
  return ok(head);
}

/** 작은 changes file을 메모리에서 만든다. 변경은 순서대로 payload에 이어 붙는다. */
export async function encodeChanges(input: {
  machine: Id<"mch">;
  app: Id<"app">;
  n: number;
  release: { code_commit: string; data_schema: number };
  created_at: string;
  changes: readonly { meta: ChangeMeta; bytes: Uint8Array }[];
}): Promise<Result<Uint8Array, FolderFileError>> {
  const size = input.changes.reduce(
    (sum, one) => sum + one.bytes.byteLength,
    0,
  );
  const payload = new Uint8Array(size);
  const changes: z.input<typeof changeEntrySchema>[] = [];
  let offset = 0;
  for (const { meta, bytes } of input.changes) {
    payload.set(bytes, offset);
    changes.push({ ...meta, offset, size: bytes.byteLength });
    offset += bytes.byteLength;
  }
  const head = await containerPrefix({
    machine: input.machine,
    app: input.app,
    n: input.n,
    kind: "changes",
    release: input.release,
    created_at: input.created_at,
    payload: { size, sha256: await sha256Hex(payload) },
    changes,
  });
  if (!head.ok) return head;
  const file = new Uint8Array(head.value.byteLength + size);
  file.set(head.value);
  file.set(payload, head.value.byteLength);
  return ok(file);
}

function indexOfNewline(bytes: Uint8Array, from: number, to: number): number {
  const end = Math.min(bytes.byteLength, to);
  for (let i = from; i < end; i++) if (bytes[i] === 0x0a) return i;
  return -1;
}

/**
 * file 앞부분(최대 `CONTAINER_HEAD_MAX_BYTES`, file이 그보다 짧으면 전부)에서 1행과 2행을 읽고 판, 1행 hash, header
 * schema와 한도, path와 같은지를 본다. payload의 크기와 hash는 `verifyContainer`가 본다.
 */
export async function readContainerHead(
  bytes: Uint8Array,
  rel: string,
): Promise<Result<ContainerHead, FolderFileError>> {
  const end1 = indexOfNewline(bytes, 0, LINE1_MAX_BYTES);
  const line1 = new TextDecoder().decode(
    bytes.subarray(
      0,
      end1 === -1 ? Math.min(bytes.byteLength, LINE1_MAX_BYTES) : end1,
    ),
  );
  // 판을 먼저 본다: 더 새 판은 1행의 나머지 꼴도 다를 수 있다.
  const version = /^lophn-folder ([1-9][0-9]{0,8})(?: |$)/.exec(line1);
  if (version === null) {
    return fileError("invalid_file", "not a lophn folder file");
  }
  if (Number(version[1]) > FOLDER_FORMAT.version) {
    return fileError(
      "newer_format",
      `folder file format ${version[1]} is newer than this lophn reads`,
    );
  }
  const line =
    /^lophn-folder [1-9][0-9]{0,8} (changes|snapshot) ([0-9a-f]{64})$/.exec(
      line1,
    );
  if (end1 === -1 || line === null) {
    return fileError("invalid_file", "first line is not valid");
  }
  const start2 = end1 + 1;
  const end2 = indexOfNewline(bytes, start2, start2 + HEADER_MAX_BYTES);
  if (end2 === -1) {
    return bytes.byteLength - start2 >= HEADER_MAX_BYTES
      ? fileError("too_large", "container header is over the limit")
      : fileError("invalid_file", "file ends inside the header");
  }
  const line2 = bytes.subarray(start2, end2 + 1);
  if ((await sha256Hex(line2)) !== line[2]) {
    return fileError("invalid_file", "header does not match its hash");
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line2));
  } catch {
    return fileError("invalid_file", "header is not JSON");
  }
  const parsed = containerHeaderSchema.safeParse(json);
  if (!parsed.success || parsed.data.kind !== line[1]) {
    return fileError("invalid_file", "header is not valid");
  }
  const limited = limitError(parsed.data);
  if (limited !== null) return limited;
  if (!matchesPath(parsed.data, rel)) {
    return fileError("invalid_file", "header does not match the file path");
  }
  return ok({ header: parsed.data, payloadOffset: end2 + 1 });
}

/** 전체 file 크기가 정확히 맞고 payload hash가 header와 같은가. */
export function verifyContainer(
  head: ContainerHead,
  file: { size: number; payloadSha256: string },
): Result<void, FolderFileError> {
  const expected = head.payloadOffset + head.header.payload.size;
  if (file.size < expected) {
    return fileError("invalid_file", "file is shorter than its header says");
  }
  if (file.size > expected) {
    return fileError("invalid_file", "file is longer than its header says");
  }
  if (file.payloadSha256 !== head.header.payload.sha256) {
    return fileError("invalid_file", "payload does not match its hash");
  }
  return ok(undefined);
}

/** 메모리에 다 읽은 file을 검사한다. 하나라도 어기면 아무것도 돌려주지 않는다. */
export async function decodeContainer(
  bytes: Uint8Array,
  rel: string,
): Promise<
  Result<{ header: ContainerHeader; payload: Uint8Array }, FolderFileError>
> {
  const head = await readContainerHead(bytes, rel);
  if (!head.ok) return head;
  const payload = bytes.subarray(head.value.payloadOffset);
  const verified = verifyContainer(head.value, {
    size: bytes.byteLength,
    payloadSha256: await sha256Hex(payload),
  });
  if (!verified.ok) return verified;
  return ok({ header: head.value.header, payload });
}

/** 검사를 마친 changes file의 변경을 순서대로. snapshot이면 빈 목록이다. */
export function changesOf(
  header: ContainerHeader,
  payload: Uint8Array,
): { meta: ChangeMeta; bytes: Uint8Array }[] {
  if (header.kind !== "changes") return [];
  return header.changes.map(({ offset, size, ...meta }) => ({
    meta,
    bytes: payload.slice(offset, offset + size),
  }));
}
