// 문서 worker route를 core가 서빙하는 길의 공용 정의. core(forward)와 reader Worker
// (handler)가 같은 내부 read route 이름을 쓴다. 이 파일은 contracts만 import한다:
// derived store(node:sqlite)는 reader Worker 쪽 모듈만 연다(core_imports_test).
import { z } from "zod";
import {
  documentDiff,
  documentExport,
  documentFile,
  documentRead,
  documentSectionHistory,
  guideGet,
  guideList,
  guideOutline,
  guideRead,
  outlineDocument,
  outlinePlace,
  searchQuery,
  searchStatus,
  storedDocumentFileInputSchema,
} from "../../packages/protocol/projects/mod.ts";
import type {
  ReadRoute,
  WorkerRoute,
} from "../../packages/protocol/platform/mod.ts";

// 제품 core가 서빙하는 문서 worker route. `documents/prepare`는 다른 길(준비 조립)이다.
export const SERVED_ROUTES: readonly WorkerRoute[] = [
  outlinePlace,
  outlineDocument,
  documentRead,
  documentSectionHistory,
  documentDiff,
  searchQuery,
  searchStatus,
  documentExport,
  guideList,
  guideGet,
  guideOutline,
  guideRead,
];

// worker route의 core 쪽 key. `workers` map이 쓰는 key와 같다.
export function servedKey(route: WorkerRoute): string {
  return `${route.resource}/${route.method}`;
}

// reader pool이 실행하는 내부 read. 공개 route가 아니다(registry에 오르지 않는다).
// 출력은 느슨하게 둔다: 공개 출력 검사는 HTTP dispatch가 route 등록 schema로 한다.
export function internalRoute(route: WorkerRoute): ReadRoute {
  return {
    kind: "read",
    resource: "documents-worker",
    method: `${route.resource}_${route.method}`,
    name: route.name,
    input: route.input,
    output: z.looseObject({}),
    actors: route.actors,
    errors: route.errors,
  };
}

// `GET /v1/documents/file`의 판정 read. 요청 자격으로 문서 접근(`document.file`)을 판정하고
// 고정 판의 경로별 파일 행(blob hash·바이트 수·MIME)을 돌려준다. 범위 밖·없는 판·없는
// 경로는 같은 not_found다. 바이트는 core가 I/O worker의 blob.read로 읽는다. 공개 route가 아니다.
export const STORED_FILE_ROUTE: ReadRoute = {
  kind: "read",
  resource: "documents-worker",
  method: "stored_file",
  name: documentFile.name,
  input: storedDocumentFileInputSchema,
  output: z.looseObject({}),
  actors: documentFile.actors,
  errors: documentFile.errors,
};

// 직접 추출(documents/outline-and-search#R15)을 받는 worker route. 읽기 handler는 동기·snapshot
// 전용이라 바이트가 없다. 추출 안 된 고정 판에는 core가 두 단계로 부른다: 계획(어느 판의 어느
// 파일을 읽을지, 요청 자격으로 같은 읽기를 다시 돌려 권한을 판정)과 답(core가 blob 인가·hash
// 검사 뒤 읽은 바이트로 이번 응답에만 추출해 같은 handler로 답). 공개 route가 아니다.
export const DIRECT_EXTRACT_ROUTES: readonly WorkerRoute[] = [
  outlineDocument,
  documentRead,
];

const DIRECT_ROUTE_NAMES = DIRECT_EXTRACT_ROUTES.map(servedKey) as [
  string,
  ...string[],
];

export const DIRECT_PLAN_ROUTE: ReadRoute = {
  kind: "read",
  resource: "documents-worker",
  method: "direct_plan",
  name: "document.direct_plan",
  input: z.strictObject({
    route: z.enum(DIRECT_ROUTE_NAMES),
    request: z.unknown(),
  }),
  output: z.looseObject({}),
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: [
    "invalid_input",
    "not_found",
    "forbidden",
    "unavailable",
    "internal",
  ],
};

export const DIRECT_ANSWER_ROUTE: ReadRoute = {
  kind: "read",
  resource: "documents-worker",
  method: "direct_answer",
  name: "document.direct_answer",
  input: z.strictObject({
    route: z.enum(DIRECT_ROUTE_NAMES),
    request: z.unknown(),
    // 계획이 가리킨 대표 파일의 바이트.
    path: z.string().min(1),
    content: z.instanceof(Uint8Array),
  }),
  output: z.looseObject({}),
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: [
    "invalid_input",
    "not_found",
    "forbidden",
    "unavailable",
    "internal",
  ],
};

// 준비 route의 기준 판 읽기. 요청 자격으로 문서 접근을 판정하고, 권한 밖이나 없는 판은
// 같은 null이다(존재를 새지 않는다). 공개 route가 아니라 core 안에서만 쓴다.
export const PREPARE_BASE_ROUTE: ReadRoute = {
  kind: "read",
  resource: "documents-worker",
  method: "prepare_base",
  name: "document.prepare",
  input: z.strictObject({
    document: z.string().min(1),
    version: z.string().min(1),
  }),
  output: z.looseObject({}),
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: ["invalid_input", "unavailable", "internal"],
};

// working copy 근거의 판정 read. 요청 자격으로 원본 없는 활성 문서인지와 연 판의 대표 파일을
// 읽는다(core가 사본을 읽고 쓰기 전에 부른다). 범위 밖·없는 문서는 같은 `eligible: false`다.
// 공개 route가 아니라 core 안에서만 쓴다.
export const WORKING_COPY_ROUTE: ReadRoute = {
  kind: "read",
  resource: "documents-worker",
  method: "working_copy",
  name: "document.working_copy",
  input: z.strictObject({
    document: z.string().min(1),
    base_version: z.string().min(1).nullable(),
    // 사람이 부른 route 이름. 문서 접근은 그 route의 operation 범위로 판정한다.
    operation: z.string().min(1),
  }),
  output: z.looseObject({}),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable", "internal"],
};

// 두기·빼기가 core 안에서 쓰는 읽기. 요청 자격으로 문서 접근을 판정하고 문서·프로젝트·최신 판의
// 파일 목록·경로에 연결된 문서·쓸 수 있는 이름을 한 snapshot에서 돌려준다. 범위 밖·없는 문서는
// 같은 null이다. 공개 route가 아니라 core 안에서만 쓴다.
export const FILE_PLACEMENT_ROUTE: ReadRoute = {
  kind: "read",
  resource: "documents-worker",
  method: "file_placement",
  name: "document.file_placement",
  input: z.strictObject({
    document: z.string().min(1),
    operation: z.string().min(1),
    project: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    suggest_name: z.boolean().optional(),
  }),
  output: z.looseObject({}),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable", "internal"],
};

// coordinator에 넘길 관측 근거의 core 쪽 읽기(Q15). 공개 route가 아니라 core가 소유자로
// 읽는 내부 read다. 응답 한도(500행)가 있어 root·규칙과 경로→문서 연결을 따로, 연결은
// 경로 순서의 page로 읽는다.
export const OBSERVATION_BASIS_ROUTE: ReadRoute = {
  kind: "read",
  resource: "documents-worker",
  method: "observation_basis",
  name: "document.observation_basis",
  input: z.strictObject({
    part: z.enum(["roots", "links"]),
    after: z.string().min(1).optional(),
  }),
  output: z.looseObject({}),
  actors: ["machine"],
  errors: ["invalid_input", "unavailable", "internal"],
};

// 연결 page 크기. 응답 한도(행 500·1MiB) 안이다.
export const OBSERVATION_LINK_PAGE = 400;

// search consumer가 저장 판을 추출하려고 묻는 판 정보. 판의 내용 hash·format·파일 목록(경로별
// blob hash·바이트 수·MIME)이다. 공개 route가 아니라 core가 소유자로 읽는 내부 read다.
// 판이 없으면 null이다.
export const SEARCH_VERSION_ROUTE: ReadRoute = {
  kind: "read",
  resource: "documents-worker",
  method: "search_version",
  name: "document.search_version",
  input: z.strictObject({ version: z.string().min(1) }),
  output: z.looseObject({}),
  actors: ["machine"],
  errors: ["invalid_input", "unavailable", "internal"],
};
