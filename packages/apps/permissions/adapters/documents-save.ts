// broker의 `DocumentsSave` port를 실제 앱 자격의 문서 저장에 잇는 어댑터(documents#T31).
// broker는 선언한 key와 정확한 grant를 이미 확인했고 늘 자식의 앱 자리와 같은 재전송 key로
// 부른다. 여기서는 documents의 일반 저장 통로를 그 자식의 app credential로 지난다:
//   앱 자리의 (앱 place, 출력 이름) 문서 찾기 → bytes를 core `documents/upload`로 준비 →
//   `document.prepare` → `document.save`(기준 판 CAS, 준비 참조와 재전송 key를 묶음).
// 문서·판·hash·blob은 documents와 core가 만든다. 이 어댑터는 순서와 입력만 잇고 hash를
// 꾸미지 않는다: core가 실제 bytes와 선언한 hash·크기가 같을 때만 준비를 끝낸다.
// 앱 자리 밖으로 가는 길은 없다. place는 늘 `{kind: "app", id: 자식의 app}`이고 본문이
// 정하지 못하며, 앱 자격이 다른 자리에 쓰는 일은 documents가 거절한다(versions#R14).
import { err, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import type { LophnError } from "../../../base/mod.ts";
import {
  type DocumentFileInput,
  documentList,
  documentPrepare,
  documentSave,
  documentUpload,
  type FormatRef,
  slugSchema,
} from "../../../contracts/documents/mod.ts";
import {
  type CommandRoute,
  preparedBlobSchema,
  type Route,
  type UploadRoute,
} from "../../../contracts/platform/mod.ts";
import type {
  DocumentSaveOutput,
  DocumentsSave,
  DocumentsSaveRequest,
} from "../broker/documents.ts";

// 앱이 남기려는 출력 파일 하나. bytes는 realpath 검사를 마친 것만 연다. hash와 크기는 읽어서
// 잰 값이고 core가 업로드한 bytes와 다시 맞춰 본다.
export type AppOutputFile = {
  // 문서 안의 상대 경로.
  path: string;
  media_type: string;
  bytes: number;
  blob_hash: string;
  primary: boolean;
  open(): ReadableStream<Uint8Array>;
};

export type AppOutputRead = { app: string; release: string; key: string };

// 앱이 선언한 출력 key의 파일을 내놓는 근원이다. 어디서 읽는지(앱 data의 파일 영역 등)는
// 이 port의 구현이 정한다. 읽을 파일이 없으면 not_found, 읽지 못하면 unavailable이다.
export interface AppOutputSource {
  files(request: AppOutputRead): Promise<Result<readonly AppOutputFile[]>>;
}

// 현재 release가 고정한 출력 선언(blueprint documents[]).
export type AppOutputDeclaration = {
  // 문서 제목으로 쓰는 선언 이름.
  name: string;
  // 문서의 저장 계약. 새 문서의 첫 판에만 명시 format으로 건다.
  format: FormatRef;
  // 이미 있는 자기 앱 place의 문서를 가리키면 그 문서 id.
  document?: string;
};

export interface AppOutputDeclarations {
  // 선언이 없으면 null이다.
  get(request: AppOutputRead): Promise<Result<AppOutputDeclaration | null>>;
}

// core의 HTTP API를 그 자식의 app credential로 부르는 client다. token은 이 client 안에만
// 있고 앱 코드와 SDK는 보지 못한다(platform/identity의 app credential 발급이 근원이다).
export type DocumentsClient = {
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
  upload(
    route: UploadRoute,
    input: unknown,
    bytes: ReadableStream<Uint8Array>,
  ): Promise<Result<unknown, LophnError>>;
};

export type AppDocumentsSaveDeps = {
  // 이 자식의 app credential로 묶인 client. 자격을 못 받으면 err(unavailable)다.
  client(
    child: { app: string; release: string },
  ): Promise<Result<DocumentsClient, LophnError>>;
  output: AppOutputSource;
  declarations: AppOutputDeclarations;
};

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const PAGE_CAP = 40;

function reject(
  code: LophnError["code"],
  message: string,
): Result<never, LophnError> {
  return err({ code, message });
}

// 새 문서 id는 (앱, 출력 key, 재전송 key)에서 정한다. 같은 저장의 재전송이 같은 문서를 가리켜
// 새 문서가 하나 더 생기지 않고(versions#R8), 다른 앱의 같은 재전송 key와 겹치지 않는다.
// ULID 모양(128bit)이다.
export async function appDocumentId(
  app: string,
  key: string,
  idempotencyKey: string,
): Promise<string> {
  const hex = await sha256Hex(
    `lophn:app-document:${app}:${key}:${idempotencyKey}`,
  );
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

type Listed = {
  documents: {
    document: { id: string; name: string | null };
    latest_version: { id: string };
  }[];
  next_cursor?: string | null;
};

type Existing = { id: string; latest: string };

// 앱 place의 문서를 이름(없으면 선언한 문서 id)으로 찾는다.
async function findExisting(
  client: DocumentsClient,
  app: string,
  match: { name: string; document?: string },
): Promise<Result<Existing | null, LophnError>> {
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const read = await client.read(documentList, {
      place: { kind: "app", id: app },
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!read.ok) return read;
    const body = read.value as Listed;
    for (const entry of body.documents) {
      const found = match.document === undefined
        ? entry.document.name === match.name
        : entry.document.id === match.document;
      if (found) {
        return ok({
          id: entry.document.id,
          latest: entry.latest_version.id,
        });
      }
    }
    if (body.next_cursor === null || body.next_cursor === undefined) {
      return ok(null);
    }
    cursor = body.next_cursor;
  }
  return reject("unavailable", "app document list is too long to search");
}

// 앱 출력 파일의 bytes를 core의 blob 준비로 보내 문서 파일 입력으로 만든다. 준비된 blob의
// hash·크기가 잰 값과 다르면 읽는 사이 파일이 바뀐 것이라 저장하지 않는다.
async function toFileInputs(
  client: DocumentsClient,
  files: readonly AppOutputFile[],
): Promise<Result<DocumentFileInput[], LophnError>> {
  const inputs: DocumentFileInput[] = [];
  for (const file of files) {
    const sent = await client.upload(
      documentUpload,
      { blob_hash: file.blob_hash, bytes: file.bytes },
      file.open(),
    );
    if (!sent.ok) return sent;
    const parsed = preparedBlobSchema.safeParse(sent.value);
    if (!parsed.success) return reject("internal", "internal error");
    const blob = parsed.data;
    if (blob.hash !== file.blob_hash || blob.size_bytes !== file.bytes) {
      return reject("conflict", "output file changed while it was read");
    }
    inputs.push({
      path: file.path,
      media_type: file.media_type,
      bytes: file.bytes,
      blob_hash: file.blob_hash,
      primary: file.primary,
      content: { kind: "prepared", blob },
    });
  }
  return ok(inputs);
}

type SaveBody = { status: "saved" | "unchanged"; version: string };

export function createAppDocumentsSave(
  deps: AppDocumentsSaveDeps,
): DocumentsSave {
  return {
    async save(
      request: DocumentsSaveRequest,
    ): Promise<Result<DocumentSaveOutput, LophnError>> {
      const { app, release, key, baseVersion, idempotencyKey } = request;
      // 출력 key는 앱 place 안의 문서 이름이다. 주소 이름 문법이 아니면 문서를 만들 수 없다.
      if (!slugSchema.safeParse(key).success) {
        return reject("invalid_input", "document key is not a document name");
      }
      const where = { app, release, key };
      const declared = await deps.declarations.get(where);
      if (!declared.ok) return declared;
      if (declared.value === null) {
        return reject("invalid_input", "document is not declared");
      }
      const declaration = declared.value;
      const listed = await deps.output.files(where);
      if (!listed.ok) return listed;
      if (listed.value.length === 0) {
        return reject("not_found", "app output has no files");
      }
      const opened = await deps.client({ app, release });
      if (!opened.ok) return opened;
      const client = opened.value;

      const found = await findExisting(client, app, {
        name: key,
        ...(declaration.document === undefined
          ? {}
          : { document: declaration.document }),
      });
      if (!found.ok) return found;
      const existing = found.value;
      if (declaration.document !== undefined && existing === null) {
        return reject(
          "invalid_input",
          "declared document is not in this app place",
        );
      }
      const minted = await appDocumentId(app, key, idempotencyKey);
      let document: string;
      if (existing === null) {
        if (baseVersion !== null) {
          return reject("conflict", "base version given but no such document");
        }
        document = minted;
      } else if (baseVersion === null) {
        // 첫 저장의 재전송은 같은 문서·같은 재전송 key라 저장된 결과를 돌려받는다.
        // 다른 key로 이미 있는 문서에 기준 없이 쓰는 것은 기존 판을 덮을 수 있어 거절한다.
        if (existing.id !== minted) {
          return reject(
            "conflict",
            "document already exists; give its version",
          );
        }
        document = existing.id;
      } else {
        document = existing.id;
      }
      const isNew = baseVersion === null;

      const inputs = await toFileInputs(client, listed.value);
      if (!inputs.ok) return inputs;
      const prepared = await client.read(documentPrepare, {
        document,
        base_version: baseVersion,
        ...(isNew
          ? {
            metadata: {
              title: declaration.name,
              place: { kind: "app", id: app },
              name: key,
            },
            // 새 문서의 첫 판에만 선언한 저장 계약을 명시한다. 기존 문서는 기준 판의
            // 정확한 계약을 잇고 계약 변경은 사람의 명시 변경만 한다.
            format: declaration.format,
          }
          : {}),
        files: inputs.value,
        source: { kind: "app", app, release },
        idempotency_key: idempotencyKey,
      });
      if (!prepared.ok) return prepared;
      const preparation = (prepared.value as { preparation_ref?: unknown })
        .preparation_ref;
      if (typeof preparation !== "string") {
        return reject("internal", "internal error");
      }
      const sent = await client.command(documentSave, {
        input: prepared.value,
        idempotency_key: idempotencyKey,
        compare: { base_version: baseVersion },
        prepared: [preparation],
      });
      if (!sent.ok) return sent;
      const saved = sent.value as SaveBody;
      // unchanged는 같은 내용이라 새 판이 없었다는 사실이고 version은 지금 최신 판이다.
      return ok({ saved: saved.status === "saved", version: saved.version });
    },
  };
}
