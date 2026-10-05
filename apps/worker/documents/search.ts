// documents coordinator의 search consumer 조립(documents#T21). derived store를 열고
// (유일한 writer), core가 event 구독에서 읽어 보낸 event와 저장 판의 원문으로 section 추출 →
// 결과·FTS·cursor를 한 derived transaction에 쓴다. 원문 바이트는 요청 앞에 byte chunk
// frame으로 와서 inbox에 있고, 추출은 권한 없는 format runner가 한다.
// ledger에는 아무것도 쓰지 않고 model·agent run을 시작하지 않는다.
import { err, ok, type Result, sha256Hex } from "../../../packages/base/mod.ts";
import type { LophnError } from "../../../packages/base/mod.ts";
import {
  BUILTIN_FORMAT_NAMES,
  type BuiltinFormatName,
} from "../../../packages/contracts/documents/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../../packages/contracts/platform/mod.ts";
import type { FormatCall } from "../../../packages/documents/formats/reads.ts";
import {
  derivedPath,
  type DerivedStore,
  openDerived,
} from "../../../packages/documents/outline-and-search/adapters/store.ts";
import {
  advanceSearchCursor,
  applySearchStep,
  searchCursorOf,
} from "../../../packages/documents/outline-and-search/consumer.ts";
import type { ExtractionRecord } from "../../../packages/documents/outline-and-search/extraction.ts";
import {
  parseSearchAdvance,
  parseSearchApply,
  SEARCH_OPS,
  type SearchExtractionRequest,
} from "../../../packages/documents/outline-and-search/mod.ts";
import type { ByteInbox } from "./validation.ts";

// 같은 event의 추출이 이만큼 연달아 끝나지 않으면 판을 failed로 남기고 cursor를 진행한다.
// 끝나지 않는 판 하나가 뒤의 모든 문서를 막지 않게 한다. 실패는 omissions로 보인다.
export const EXTRACTION_ATTEMPTS = 3;

export type SearchServing = {
  // 이 요청이 search op가 아니면 undefined다.
  handle(request: WorkerRequest): Promise<WorkerResponse> | undefined;
  close(): void;
};

export type SearchDeps = {
  store: DerivedStore;
  inbox: ByteInbox;
  // format runner 호출. 제품은 `createFormatHandlers().call`이다.
  call(input: FormatCall): Promise<Result<unknown, LophnError>>;
};

// 데이터 root의 derived 폴더에서 store를 연다. 못 열면 consumer를 올리지 않는다(요청은
// unavailable): 빈 index로 꾸미지 않는다.
export function openSearchStore(root: string): Result<DerivedStore> {
  const directory = `${root}/derived`;
  try {
    Deno.mkdirSync(directory, { recursive: true });
  } catch {
    return err({ code: "unavailable", message: "derived 폴더를 만들 수 없다" });
  }
  return openDerived(derivedPath(directory));
}

function isBuiltin(name: string): name is BuiltinFormatName {
  return (BUILTIN_FORMAT_NAMES as readonly string[]).includes(name);
}

function respond(
  request: WorkerRequest,
  result: Result<unknown>,
): WorkerResponse {
  return result.ok
    ? {
      type: "worker_response",
      request_id: request.request_id,
      ok: true,
      payload: result.value,
    }
    : {
      type: "worker_response",
      request_id: request.request_id,
      ok: false,
      error: {
        code: result.error.code === "invalid_input"
          ? "invalid_input"
          : "unavailable",
        message: "search consumer request failed",
      },
    };
}

async function extract(
  request: SearchExtractionRequest,
  deps: SearchDeps,
): Promise<Result<ExtractionRecord["extraction"]>> {
  // core가 원문을 읽어 보내지 못한 판은 확인할 수 없는 판이다. 있는 척하지 않는다.
  if (request.unreadable === true) return ok({ status: "unverified" });
  const files: {
    path: string;
    media_type: string;
    primary: boolean;
    content: readonly number[];
  }[] = [];
  let primary: Uint8Array | undefined;
  for (const file of request.files) {
    const taken = deps.inbox.take(file.channel, file.bytes);
    if (!taken.ok) return taken;
    if (file.primary) primary = taken.value;
    files.push({
      path: file.path,
      media_type: file.media_type,
      primary: file.primary,
      content: Array.from(taken.value),
    });
  }
  // 우리가 실행할 수 없는 format은 미지원이다. 읽을 수 있는 척하지 않는다.
  if (!isBuiltin(request.format.name)) return ok({ status: "unsupported" });
  const ran = await deps.call({
    operation: "extract",
    name: request.format.name,
    module_hash: request.format.module_hash,
    input: {
      input_hash: await sha256Hex(primary ?? new Uint8Array()),
      module_hash: request.format.module_hash,
      files,
    },
  });
  if (!ran.ok) {
    // 보존된 module이 없으면 이 판은 확인할 수 없다. 최신 module로 대신하지 않는다.
    if (ran.error.code === "not_found") return ok({ status: "unverified" });
    return err({
      code: "unavailable",
      message: "section extraction did not complete",
    });
  }
  return ok(ran.value as ExtractionRecord["extraction"]);
}

export function createSearchServing(deps: SearchDeps): SearchServing {
  const attempts = new Map<string, number>();

  async function apply(request: WorkerRequest): Promise<WorkerResponse> {
    const parsed = parseSearchApply(request.payload);
    if (parsed === undefined) {
      return respond(request, err({ code: "invalid_input", message: "bad" }));
    }
    let record: ExtractionRecord | undefined;
    if (parsed.extraction !== undefined) {
      const target = parsed.extraction;
      const result = await extract(target, deps);
      if (result.ok) {
        record = {
          document: target.document,
          version: target.version,
          content_hash: target.content_hash,
          module_hash: target.format.module_hash,
          extraction: result.value,
        };
        attempts.delete(parsed.event.seq);
      } else {
        const failed = (attempts.get(parsed.event.seq) ?? 0) + 1;
        if (failed < EXTRACTION_ATTEMPTS) {
          attempts.set(parsed.event.seq, failed);
          return respond(request, result);
        }
        attempts.delete(parsed.event.seq);
        record = {
          document: target.document,
          version: target.version,
          content_hash: target.content_hash,
          module_hash: target.format.module_hash,
          extraction: {
            status: "failed",
            failure_reason: "extraction did not complete",
          },
        };
      }
    }
    const stepped = applySearchStep(deps.store, {
      event: parsed.event,
      ...(record === undefined ? {} : { extraction: record }),
    });
    return respond(
      request,
      stepped.ok ? ok({ processed_seq: stepped.value.processed_seq }) : stepped,
    );
  }

  return {
    handle(request) {
      if (request.op === SEARCH_OPS.cursor) {
        return Promise.resolve(
          respond(
            request,
            ok({ processed_seq: searchCursorOf(deps.store.read) }),
          ),
        );
      }
      if (request.op === SEARCH_OPS.advance) {
        const to = parseSearchAdvance(request.payload);
        if (to === undefined) {
          return Promise.resolve(
            respond(request, err({ code: "invalid_input", message: "bad" })),
          );
        }
        return Promise.resolve(
          respond(request, advanceSearchCursor(deps.store, to)),
        );
      }
      if (request.op === SEARCH_OPS.apply) return apply(request);
      return undefined;
    },
    close() {
      deps.store.close();
    },
  };
}
