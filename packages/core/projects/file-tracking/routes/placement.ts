// 문서를 파일로 두기와 빼기의 core 조립(documents#T19). `files.write`의 `place`와 `files.delete`의
// `unlink`는 같은 route 안의 동작이다: 파일 쓰기·삭제는 기존 coordinator 경로가 하고, 연결 확정
// (원본 연결, 추적 규칙, 자리)은 요청한 사람의 자격으로 core가 command를 직접 부른다.
// 순서와 단계별 실패 보고는 file-tracking의 placement.ts가 한다. 이 파일은 그 port를 core의
// 읽기·command·coordinator 요청에 잇고, 쓰기 전부터 원본 연결까지 경로를 잡는 메모리 예약과
// 그 예약을 보는 writer 앞단을 둔다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type Document,
  type FileOperationResult,
  type PlaceRef,
  type Project,
  type Slug,
  type TrackingPreview,
  trackingPreviewSchema,
} from "../../../../protocol/projects/mod.ts";
import type { CommandEnvelope, Writer } from "../../../storage/ledger/mod.ts";
import type { FileDone } from "../files.ts";
import type { PlacementDeps, PlacementFileDone } from "../placement.ts";
import type { PlacementRead, PlacementReadInput } from "../placement-read.ts";

// ── 경로 예약 ──────────────────────────────────────────────────────────

// 두기가 파일을 쓰기 전부터 원본 연결이 확정될 때까지 잡는 경로의 메모리 집합. 같은 경로를 여러 번
// 잡을 수 있어 세어 둔다. 재시작하면 사라지지만 그때는 진행 중 요청도 함께 끝난다.
export type PlacementReservations = {
  reserve(path: string): () => void;
  has(path: string): boolean;
};

export function createPlacementReservations(): PlacementReservations {
  const held = new Map<string, number>();
  return {
    reserve(path) {
      held.set(path, (held.get(path) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (held.get(path) ?? 1) - 1;
        if (left <= 0) held.delete(path);
        else held.set(path, left);
      };
    },
    has: (path) => held.has(path),
  };
}

// 파일 관측이 만든 `document.save`가 가리키는 파일 경로. 관측이 아니면 undefined다.
function observedPath(input: unknown): string | undefined {
  const value = input as {
    source?: { kind?: unknown; path?: unknown } | null;
    file_basis?: { path?: unknown } | null;
  } | null;
  const source = value?.source;
  if (source?.kind === "file" && typeof source.path === "string") {
    return source.path;
  }
  const basis = value?.file_basis;
  return typeof basis?.path === "string" ? basis.path : undefined;
}

// writer.command 앞에서, 두기가 잡은 경로를 가리키는 파일 관측 저장을 conflict로 돌린다. 관측 loop는
// 그 후보를 다시 관측하고, 그때는 문서가 이미 그 파일에 연결돼 있어 새 문서를 만들지 않는다.
// 두기 자신의 command는 이 앞단을 거치지 않는다(core가 runtime.writer를 직접 부른다).
export function withPlacementReservation(
  writer: Writer,
  reservations: Pick<PlacementReservations, "has">,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope: CommandEnvelope) {
      if (envelope.command === "document.save") {
        const path = observedPath(envelope.input);
        if (path !== undefined && reservations.has(path)) {
          return err({
            code: "conflict",
            message: "file is being placed as a document",
          });
        }
      }
      return await writer.command(ctx, envelope);
    },
  };
}

// ── port 조립 ──────────────────────────────────────────────────────────

// core가 한 요청을 위해 가진 수단. 읽기와 command는 모두 요청 credential의 현재 자격이다.
export type PlacementHost = {
  read(input: PlacementReadInput): Promise<Result<PlacementRead>>;
  command(envelope: CommandEnvelope): Promise<Result<unknown>>;
  // coordinator 요청(폴더 미리보기).
  preview(
    payload: unknown,
  ): Promise<Result<unknown>>;
  // 이미 검사한 요청 하나를 coordinator 경로로 쓰거나 지우거나 헤더만 본다.
  write(): Promise<Result<FileOperationResult>>;
  remove(): Promise<Result<FileOperationResult>>;
  exists(): Promise<Result<boolean>>;
  reserve(path: string): () => void;
};

export type PlacementContext = {
  requestKey: string;
  // 요청이 다루는 문서. 프로젝트·연결 읽기도 이 문서의 접근 범위로 판정한다.
  document: string;
  // 두기·빼기의 operation 이름. 문서 접근은 이 route의 범위로 판정한다.
  operation: string;
  // 두기가 새 문서 이름을 정할 때 쓰는 파일 경로.
  path: string;
};

// FileOperationResult의 파일 쪽 사실을 알고리즘의 값으로 되돌린다(본문은 없고 경로와 hash뿐이다).
function doneOf(result: FileOperationResult): FileDone {
  return {
    outcome: result.outcome,
    beforePath: result.before_path,
    afterPath: result.after_path,
    beforeHash: result.before_hash,
    writtenHash: result.written_hash,
    observedHash: result.observed_hash,
    observedAt: result.observed_at,
    changedAgain: result.changed_again,
  };
}

function fileDone(result: FileOperationResult): PlacementFileDone {
  return {
    done: doneOf(result),
    recording: result.recording === "recorded" ? "recorded" : "unverified",
  };
}

// writer.command의 성공값에서 command 결과를 꺼낸다.
function resultOf<T>(done: Result<unknown>): Result<T> {
  if (!done.ok) return done;
  return ok((done.value as { result: T }).result);
}

const PREVIEW_PAGES = 5000;

export function createPlacementDeps(
  host: PlacementHost,
  context: PlacementContext,
): {
  deps: PlacementDeps;
  // 쓰기·삭제가 만든 파일 결과. 호출 응답의 바탕이다.
  written(): FileOperationResult | undefined;
  removed(): FileOperationResult | undefined;
} {
  let wrote: FileOperationResult | undefined;
  let deleted: FileOperationResult | undefined;
  const key = (step: string) => `${context.requestKey}:${step}`;
  const read = (extra: Partial<PlacementReadInput>, document: string) =>
    host.read({ document, operation: context.operation, ...extra });
  const command = <T>(
    name: string,
    step: string,
    input: unknown,
    base_revision: string,
  ) =>
    host.command({
      command: name,
      input,
      idempotency_key: key(step),
      compare: { base_revision },
      prepared: [],
    }).then((done) => resultOf<T>(done));

  const deps: PlacementDeps = {
    files: {
      async writeNew() {
        const result = await host.write();
        if (!result.ok) return result;
        wrote = result.value;
        return ok(fileDone(result.value));
      },
      exists: () => host.exists(),
      async remove() {
        const result = await host.remove();
        if (!result.ok) return result;
        deleted = result.value;
        return ok(fileDone(result.value));
      },
    },
    ledger: {
      async document(id) {
        const found = await read({}, id);
        return found.ok ? ok(found.value.document) : found;
      },
      async project(id) {
        // 프로젝트는 문서 접근으로 판정한 읽기에 실려 온다. 문서를 먼저 정해 둔 호출이다.
        const found = await read({ project: id }, context.document);
        return found.ok ? ok(found.value.project) : found;
      },
      async latest(document) {
        const found = await read({}, document);
        if (!found.ok) return found;
        return ok(found.value.latest);
      },
      async linked(path) {
        const found = await read({ path }, context.document);
        return found.ok ? ok(found.value.linked) : found;
      },
      async placeName(place: PlaceRef, document: Document) {
        const found = await read({
          project: place.id,
          path: context.path,
          suggest_name: true,
        }, document.id);
        if (!found.ok) return found;
        return found.value.name === null
          ? err({ code: "conflict", message: "no free document name" })
          : ok(found.value.name as Slug);
      },
      async previewTracking(request) {
        // 적용은 미리 본 규칙과 같은 마지막 page를 받으므로 complete까지 page를 이어 읽는다.
        let cursor: string | undefined;
        for (let page = 0; page < PREVIEW_PAGES; page++) {
          const answered = await host.preview({
            project: request.project,
            base_revision: request.baseRevision,
            folders: request.folders,
            tracking: request.tracking,
            ...(cursor === undefined ? {} : { cursor }),
          });
          if (!answered.ok) return answered;
          const parsed = trackingPreviewSchema.safeParse(answered.value);
          if (!parsed.success) {
            return err({
              code: "unavailable",
              message: "tracking preview is invalid",
            });
          }
          const preview: TrackingPreview = parsed.data;
          if (preview.complete) return ok(preview);
          if (preview.next_cursor === null) break;
          cursor = preview.next_cursor;
        }
        return err({
          code: "unavailable",
          message: "tracking preview did not finish",
        });
      },
    },
    commands: {
      setTracking: (input, compare) =>
        command<Project>(
          "project.set_tracking",
          "tracking",
          input,
          compare.base_revision,
        ),
      move: (input, compare) =>
        command<Document>(
          "document.move",
          `move:${input.place === null ? "out" : "in"}`,
          input,
          compare.base_revision,
        ),
      setSource: (input, compare) =>
        command<Document>(
          "document.set_source",
          `source:${input.file_source === null ? "unlink" : "link"}`,
          input,
          compare.base_revision,
        ),
    },
    reserve: (path) => host.reserve(path),
  };
  return { deps, written: () => wrote, removed: () => deleted };
}
