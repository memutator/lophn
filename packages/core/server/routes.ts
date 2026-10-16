import {
  type CommandRoute,
  type FileRoute,
  type MemoryRoute,
  type ReadRoute,
  type Route,
  routePath,
  type UploadRoute,
  type WorkerRoute,
} from "../../protocol/base/mod.ts";
import { GATEWAY_PATH } from "../../protocol/events/mod.ts";
import { ROUTES } from "../../protocol/registry.ts";

// route registry: resource/method → kind, schema, handler, actor 상한, 한도.
// 경로는 /resource/method의 정확히 두 구간이다.
export type RouteEntry = {
  route: Route;
  path: string;
};

export class RouteRegistry {
  readonly #byPath = new Map<string, RouteEntry>();

  constructor(routes: readonly Route[] = ROUTES) {
    for (const route of routes) {
      const path = routePath(route);
      if (this.#byPath.has(path)) {
        throw new Error(`duplicate route: ${path}`);
      }
      this.#byPath.set(path, { route, path });
    }
  }

  // 대소문자·누락·추가 구간·미등록 resource/method·옛 별칭은 추정하지 않는다.
  lookup(pathname: string): RouteEntry | undefined {
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

// Gateway WS는 RPC 세 구간이 아니다. 정확한 경로 하나만 받는다.
export function isSubscribePath(pathname: string): boolean {
  return pathname === GATEWAY_PATH;
}

export function isUploadRoute(route: Route): route is UploadRoute {
  return route.kind === "upload";
}
