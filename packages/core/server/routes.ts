import {
  API_MAJOR,
  type CommandRoute,
  type FileRoute,
  type MemoryRoute,
  type ReadRoute,
  type Route,
  type UploadRoute,
  type WorkerRoute,
} from "../../protocol/base/mod.ts";
import { EVENT_SUBSCRIBE_PATH } from "../../protocol/events/mod.ts";
import { ROUTES } from "../../protocol/registry.ts";

// route registry: resource/method → kind, schema, handler, actor 상한, 한도.
// 경로는 v + major, resource, method의 정확히 세 구간이다(platform/api#R2, R6).
export type RouteEntry = {
  route: Route;
  path: string;
};

const PATH = new RegExp(
  `^/v${API_MAJOR}/([a-z][a-z0-9_-]*)/([a-z][a-z0-9_-]*)$`,
);

function pathOf(route: { resource: string; method: string }): string {
  return `/v${API_MAJOR}/${route.resource}/${route.method}`;
}

export class RouteRegistry {
  readonly #byPath = new Map<string, RouteEntry>();

  constructor(routes: readonly Route[] = ROUTES) {
    for (const route of routes) {
      const path = pathOf(route);
      if (this.#byPath.has(path)) {
        throw new Error(`duplicate route: ${path}`);
      }
      this.#byPath.set(path, { route, path });
    }
  }

  // 대소문자·누락·추가 구간·미등록 resource/method·옛 별칭은 추정하지 않는다.
  lookup(pathname: string): RouteEntry | undefined {
    const match = PATH.exec(pathname);
    if (!match) return undefined;
    return this.#byPath.get(pathname);
  }

  get size(): number {
    return this.#byPath.size;
  }
}

export function isCommandRoute(route: Route): route is CommandRoute {
  return route.kind === "command";
}

export function isReadRoute(route: Route): route is ReadRoute {
  return route.kind === "read";
}

export function isFileRoute(route: Route): route is FileRoute {
  return route.kind === "file";
}

export function isMemoryRoute(route: Route): route is MemoryRoute {
  return route.kind === "memory";
}

export function isWorkerRoute(route: Route): route is WorkerRoute {
  return route.kind === "worker";
}

// WS 구독은 RPC 세 구간이 아니다. 정확한 경로 하나만 받는다.
export function isSubscribePath(pathname: string): boolean {
  return pathname === EVENT_SUBSCRIBE_PATH;
}

export function isUploadRoute(route: Route): route is UploadRoute {
  return route.kind === "upload";
}
