// 아직 판이 없는 새 문서의 첫 판(flow write-series 2·5). series 새 멤버는 원본 파일도 working
// copy도 없어서 파일 통로로 쓸 곳이 없다. 편집 종료에서 글 바이트를 core blob 준비로 올리고
// `documents/prepare`(base_version null)·`document.save`로 첫 판을 만든다. 준비·업로드는
// renderer allowlist 밖이라 main만 부른다. 그 문서가 가족 draft의 예정 문서이면 documents가
// 같은 저장 transaction에서 멤버로 넣고 draft를 비운다(documents/series join). 첫 판 뒤의
// 고침은 그 문서의 working copy로 파일 통로를 탄다. 응답을 잃은 저장은 다시 저장하지 않고
// 문서 조회로 결과를 정한다.
import type {
  CreateReport,
  EditorCreate,
  EditorReply,
} from "../../ipc/editor.ts";
import {
  type PortError,
  type PortResult,
  type PreparedBlob,
  sha256,
} from "./file-adapter.ts";

// shell tsc는 contracts를 보지 않는다. contract output에서 이 통로가 읽는 field만 옮긴다.

/** 준비 결과. 그대로 `document.save` 입력에 싣는다. */
export interface PreparedNew {
  preparation_ref: string;
  idempotency_key: string;
  [field: string]: unknown;
}

export interface CreatePort {
  upload(bytes: Uint8Array, hash: string): Promise<PortResult<PreparedBlob>>;
  prepare(input: unknown): Promise<PortResult<PreparedNew>>;
  save(request: unknown): Promise<PortResult<{ version: string }>>;
  /** `documents/get`. 응답을 잃은 저장의 결과 조회다. */
  latest(document: string): Promise<PortResult<{ version: string }>>;
}

export interface CreatorOptions {
  /** 연결된 core가 없으면 null이다. 그때 저장은 offline이다. */
  port: () => CreatePort | null;
  hash?: (bytes: Uint8Array) => string;
}

export interface DocumentCreator {
  create(input: EditorCreate): Promise<EditorReply<CreateReport>>;
}

/** 편집기가 쓰는 Markdown 글의 형식. 생략한 format은 이 MIME의 기본 형식(document)이다. */
const MEDIA_TYPE = "text/markdown";

function report(
  outcome: CreateReport["outcome"],
  over: Partial<CreateReport> = {},
): CreateReport {
  return { outcome, version: null, failure: null, ...over };
}

function failedWith(error: PortError): CreateReport {
  if (error.code === "conflict") return report("conflict");
  return report("failed", {
    failure: error.code === "unauthorized" ? "forbidden" : error.code,
  });
}

/** 응답이 오지 않은 실패. 저장이 일어났는지 모른다. */
function transportLost(error: PortError): boolean {
  return error.code === "unavailable" &&
    error.details?.["reason"] === "transport_failed";
}

export function createDocumentCreator(
  options: CreatorOptions,
): DocumentCreator {
  const hash = options.hash ?? sha256;
  return {
    async create(input) {
      const port = options.port();
      if (port === null) {
        return { ok: true, value: report("failed", { failure: "offline" }) };
      }
      const written = hash(input.bytes);
      const blob = await port.upload(input.bytes, written);
      if (!blob.ok) return { ok: true, value: failedWith(blob.error) };
      const prepared = await port.prepare({
        document: input.document,
        base_version: null,
        metadata: { title: input.title, place: input.place, name: input.name },
        files: [{
          path: `${input.name}.md`,
          blob_hash: written,
          bytes: input.bytes.byteLength,
          media_type: MEDIA_TYPE,
          primary: true,
          content: { kind: "prepared", blob: blob.value },
        }],
        source: null,
        idempotency_key: input.request_key,
      });
      if (!prepared.ok) return { ok: true, value: failedWith(prepared.error) };
      const saved = await port.save({
        input: prepared.value,
        idempotency_key: prepared.value.idempotency_key,
        compare: { base_version: null },
        prepared: [prepared.value.preparation_ref],
      });
      if (saved.ok) {
        return {
          ok: true,
          value: report("saved", { version: saved.value.version }),
        };
      }
      if (!transportLost(saved.error)) {
        return { ok: true, value: failedWith(saved.error) };
      }
      // 저장했는지 모른다. 다시 저장하지 않고 그 예정 문서가 생겼는지 본다. 아직 없으면 저장이
      // 늦게 끝날 수도 있어 모른다고 답한다(사람이 다시 확인한다).
      const found = await port.latest(input.document);
      return {
        ok: true,
        value: found.ok
          ? report("saved", { version: found.value.version })
          : report("unknown", { failure: "unknown" }),
      };
    },
  };
}
