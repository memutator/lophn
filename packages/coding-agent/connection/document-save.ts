// 문서 저장 통로다(mcp#R13–R15, cli#R15). MCP `lophn_save`와 CLI `save`가 같은 흐름을
// 쓴다: 자리·series 검사 → document.prepare(worker) → document.save(command, CAS와
// 준비 참조를 묶어서) → 허용된 series 가입. 문서·판은 documents가 만들고 이 통로는
// 순서와 입력을 이을 뿐이다. 추측으로 성공을 만들지 않는다: 어느 단계가 실패해도 그
// 단계의 오류 그대로 돌려주고, 저장 뒤 가입이 실패하면 저장된 고정 주소를 함께 남긴다.
import {
  err,
  type LophnError,
  ok,
  type Result,
  sha256Hex,
} from "../../base/mod.ts";
import {
  type DocumentFileInput,
  documentList,
  documentPrepare,
  documentSave,
  type FormatRef,
  type PlaceRef,
  seriesAddInstance,
  seriesGet,
} from "../../contracts/documents/mod.ts";
import type { CommandRoute, Route } from "../../contracts/platform/mod.ts";
import {
  type PrepareBytes,
  type SubmissionScope,
  submitPaths,
} from "./submission.ts";

// core client 중 이 흐름이 쓰는 두 호출이다. CoreClient가 구조로 맞는다.
export type FlowClient = {
  command(
    route: CommandRoute,
    body: {
      input: unknown;
      idempotency_key: string;
      compare?: unknown;
      prepared?: readonly string[];
    },
  ): Promise<Result<unknown, LophnError>>;
  read(route: Route, input: unknown): Promise<Result<unknown, LophnError>>;
};

export type SeriesSelector =
  | { series: string }
  | { place: PlaceRef; name: string };

export type SaveInput = {
  files: readonly DocumentFileInput[];
  // null은 자리 없음이다. 생략과 같다.
  place?: PlaceRef | null;
  slug?: string | null;
  title?: string;
  format?: FormatRef;
  series?: SeriesSelector;
  key?: string;
  // 기존 문서의 기준 판이다. 생략하면 현재 최신 판, null이면 새 문서다.
  base_revision?: string | null;
  idempotency_key?: string;
};

export type SavedDocument = {
  status: "saved" | "unchanged";
  document: string;
  version: string;
  reference: unknown;
  warnings: unknown[];
  event_seq: string | null;
};

export type SaveOutcome = {
  saved: SavedDocument;
  placed: boolean;
  // 새 문서였는지. 기존 문서의 판을 더한 것이면 false다.
  created: boolean;
  series: { series: string; key: string; joined: boolean } | null;
  notes: string[];
};

type Normalized = Omit<SaveInput, "place" | "slug"> & {
  place?: PlaceRef;
  slug?: string;
};

const PAGE_CAP = 40;
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function reject(
  code: LophnError["code"],
  message: string,
  details?: Record<string, unknown>,
): Result<never, LophnError> {
  return err({ code, message, ...(details ? { details } : {}) });
}

// 새 문서 ID는 idempotency key에서 정한다. 같은 key의 재전달이 같은 문서를 가리켜
// 새 문서가 하나 더 생기지 않는다(documents/versions#R8). ULID 모양(128bit)이다.
export async function documentIdForKey(key: string): Promise<string> {
  const hex = await sha256Hex(`lophn:document:${key}`);
  let value = 0n;
  for (let index = 0; index < 32; index += 2) {
    value = (value << 8n) | BigInt(parseInt(hex.slice(index, index + 2), 16));
  }
  let id = "";
  for (let position = 25; position >= 0; position -= 1) {
    id += ALPHABET[Number((value >> BigInt(position * 5)) & 31n)];
  }
  return `doc_${id}`;
}

// key를 주지 않은 요청의 key다. 같은 요청의 재전송은 같은 key라 새 판·새 문서가
// 생기지 않는다. 기준 판이 바뀐 뒤의 재전송은 다른 key라 unchanged로 닿는다.
async function derivedKey(
  input: Normalized,
  baseVersion: string | null,
): Promise<string> {
  const files = input.files.map((file) => ({
    path: file.path,
    blob_hash: file.blob_hash,
    bytes: file.bytes,
    media_type: file.media_type,
    primary: file.primary,
  }));
  const hash = await sha256Hex(JSON.stringify([
    files,
    input.place ?? null,
    input.slug ?? null,
    input.title ?? null,
    input.format ?? null,
    input.series ?? null,
    input.key ?? null,
    baseVersion,
  ]));
  return `save-${hash.slice(0, 40)}`;
}

function titleOf(input: Normalized): string {
  if (input.title !== undefined) return input.title;
  const primary = input.files.find((file) => file.primary)!;
  const name = primary.path.slice(primary.path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

type Listed = {
  documents: { document: { id: string; name: string | null } }[];
};

type Existing = { id: string; latest: string };

// (place, slug)로 이미 있는 문서를 찾는다. 자리 있는 저장은 이 이름으로 같은 문서를
// 가리켜야 재전송이 새 문서를 만들지 않는다.
async function findExisting(
  client: FlowClient,
  place: PlaceRef,
  slug: string,
): Promise<Result<Existing | null, LophnError>> {
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const read = await client.read(documentList, {
      place,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!read.ok) return read;
    const body = read.value as Listed & { next_cursor?: string | null };
    for (const entry of body.documents) {
      if (entry.document.name === slug) {
        const latest = (entry as unknown as {
          latest_version: { id: string };
        }).latest_version.id;
        return ok({ id: entry.document.id, latest });
      }
    }
    if (body.next_cursor === null || body.next_cursor === undefined) {
      return ok(null);
    }
    cursor = body.next_cursor;
  }
  return reject("unavailable", "문서 목록이 너무 길어 이름을 찾지 못했다");
}

type SeriesView = {
  series: { id: string; revision: string };
  entries: { key: string; document: string }[];
  next_cursor?: string | null;
};

async function readSeries(
  client: FlowClient,
  selector: SeriesSelector,
): Promise<Result<SeriesView, LophnError>> {
  let cursor: string | undefined;
  let found: SeriesView | undefined;
  const entries: SeriesView["entries"] = [];
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const read = await client.read(seriesGet, {
      selector,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!read.ok) return read;
    const body = read.value as SeriesView;
    found = body;
    entries.push(...body.entries);
    if (body.next_cursor === null || body.next_cursor === undefined) {
      return ok({ series: found.series, entries });
    }
    cursor = body.next_cursor;
  }
  return reject("unavailable", "series 목록이 너무 길어 끝까지 읽지 못했다");
}

export async function saveDocument(
  client: FlowClient,
  raw: SaveInput,
): Promise<Result<SaveOutcome, LophnError>> {
  const { place, slug, ...rest } = raw;
  const input: Normalized = {
    ...rest,
    ...(place === null || place === undefined ? {} : { place }),
    ...(slug === null || slug === undefined ? {} : { slug }),
  };
  if (input.series !== undefined && input.key === undefined) {
    return reject("invalid_input", "series를 쓰면 key가 필요하다");
  }
  if (input.key !== undefined && input.series === undefined) {
    return reject("invalid_input", "key는 series와 함께만 쓴다");
  }
  if (input.place !== undefined && input.slug === undefined) {
    return reject("invalid_input", "자리를 고르면 slug(문서 이름)가 필요하다");
  }
  if (input.place === undefined && input.slug !== undefined) {
    return reject("invalid_input", "slug는 자리와 함께만 쓴다");
  }

  // series는 쓰기 전에 읽는다: 없는 series·이미 쓴 key는 저장하지 않고 거절한다.
  let family: SeriesView | undefined;
  if (input.series !== undefined) {
    const read = await readSeries(client, input.series);
    if (!read.ok) return read;
    family = read.value;
  }

  const notes: string[] = [];
  let existing: Existing | null = null;
  if (input.place !== undefined && input.slug !== undefined) {
    const found = await findExisting(client, input.place, input.slug);
    if (!found.ok) return found;
    existing = found.value;
  }
  if (existing === null) {
    if (typeof input.base_revision === "string") {
      return reject("conflict", "기준 판을 줬지만 그 이름의 문서가 없다");
    }
  } else {
    if (input.base_revision === null) {
      return reject("conflict", "이미 있는 문서다. 기준 판을 주거나 생략한다");
    }
    if (input.title !== undefined) {
      notes.push("기존 문서라 title은 바뀌지 않는다");
    }
  }
  const baseVersion = existing === null
    ? null
    : (input.base_revision ?? existing.latest);
  const idempotencyKey = input.idempotency_key ??
    await derivedKey(input, baseVersion);
  const document = existing?.id ?? await documentIdForKey(idempotencyKey);

  if (family !== undefined && input.key !== undefined) {
    const member = family.entries.find((entry) => entry.document === document);
    const taken = family.entries.find((entry) => entry.key === input.key);
    if (taken !== undefined && taken.document !== document) {
      return reject("conflict", "이미 사용한 key다", { key: input.key });
    }
    if (member !== undefined && member.key !== input.key) {
      return reject("conflict", "이 문서는 이미 다른 key로 가입돼 있다", {
        key: member.key,
      });
    }
  }

  const prepared = await client.read(documentPrepare, {
    document,
    base_version: baseVersion,
    ...(baseVersion === null
      ? {
        metadata: {
          title: titleOf(input),
          place: input.place ?? null,
          name: input.slug ?? null,
        },
      }
      : {}),
    files: input.files,
    ...(input.format === undefined ? {} : { format: input.format }),
    source: null,
    idempotency_key: idempotencyKey,
  });
  // 명시 format 부적합은 준비 단계의 invalid_input이다. 저장은 시작하지 않는다.
  if (!prepared.ok) return prepared;
  const version = prepared.value as { preparation_ref: string };

  const sent = await client.command(documentSave, {
    input: prepared.value,
    idempotency_key: idempotencyKey,
    compare: { base_version: baseVersion },
    prepared: [version.preparation_ref],
  });
  if (!sent.ok) return sent;
  const saved = sent.value as SavedDocument;

  let joined: SaveOutcome["series"] = null;
  if (family !== undefined && input.key !== undefined) {
    const already = family.entries.some((entry) =>
      entry.document === saved.document && entry.key === input.key
    );
    joined = { series: family.series.id, key: input.key, joined: already };
    if (!already) {
      const added = await client.command(seriesAddInstance, {
        input: {
          series: family.series.id,
          document: saved.document,
          key: input.key,
        },
        idempotency_key: `${idempotencyKey}-join`.slice(0, 128),
        compare: { base_revision: family.series.revision },
      });
      if (!added.ok) {
        // 문서는 이미 저장됐다. 저장 사실과 고정 주소를 오류에 남긴다.
        return err({
          ...added.error,
          message:
            `문서는 저장했지만 series에 가입하지 못했다: ${added.error.message}`,
          details: {
            ...(added.error.details ?? {}),
            saved: {
              document: saved.document,
              version: saved.version,
              reference: saved.reference,
            },
            series: family.series.id,
            key: input.key,
          },
        });
      }
      joined.joined = true;
    }
  }

  return ok({
    saved,
    placed: input.place !== undefined,
    created: existing === null,
    series: joined,
    notes,
  });
}

export type PathSaveDeps = {
  client: FlowClient;
  scope: SubmissionScope;
  prepareBytes: PrepareBytes;
};

// MCP·CLI가 같이 쓰는 입구다. 경로를 제출 root 안에서 다시 검사해 bytes를 core로 보낸 뒤
// 같은 저장 흐름을 탄다. 검사에 걸린 파일이 하나라도 있으면 어떤 bytes도 보내지 않는다.
export async function saveFromPaths(
  deps: PathSaveDeps,
  input: Omit<SaveInput, "files"> & { paths: readonly string[] },
): Promise<Result<SaveOutcome, LophnError>> {
  const { paths, ...rest } = input;
  const files = await submitPaths(paths, deps.scope, deps.prepareBytes);
  if (!files.ok) return files;
  return await saveDocument(deps.client, { ...rest, files: files.value });
}
