// 문서 worker route를 core가 서빙하는 길의 공용 정의. core(forward)와 reader Worker
// (handler)가 같은 내부 read route 이름을 쓴다. 이 파일은 contracts만 import한다:
// derived store(node:sqlite)는 reader Worker 쪽 모듈만 연다(core_imports_test).
import { z } from "zod";
import {
  documentExport,
  documentRead,
  outlineDocument,
  outlinePlace,
  searchQuery,
  searchStatus,
  viewOpen,
} from "../../packages/contracts/documents/mod.ts";
import type {
  ReadRoute,
  WorkerRoute,
} from "../../packages/contracts/platform/mod.ts";

// 제품 core가 서빙하는 문서 worker route. `documents/prepare`는 다른 길(준비 조립)이다.
export const SERVED_ROUTES: readonly WorkerRoute[] = [
  outlinePlace,
  outlineDocument,
  documentRead,
  searchQuery,
  searchStatus,
  viewOpen,
  documentExport,
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
