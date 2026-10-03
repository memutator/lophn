import { ERROR_CODES, type ErrorCode } from "../../base/mod.ts";
import { z } from "zod";
import { API_MAJOR } from "./limits.ts";

export const ACTOR_KINDS = [
  "user",
  "coding_agent",
  "agent",
  "app",
  "machine",
] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];

export const ROUTE_KINDS = ["command", "read", "file", "worker"] as const;

export type RouteKind = (typeof ROUTE_KINDS)[number];

const NAME = /^[a-z][a-z0-9_-]*$/;

const errorCodeSchema = z.enum(ERROR_CODES);

type RouteBase<K extends RouteKind, I extends z.ZodType, O> = {
  kind: K;
  resource: string;
  method: string;
  name: string;
  input: I;
  output: O;
  compare?: z.ZodType;
  actors: readonly ActorKind[];
  errors: readonly ErrorCode[];
  display_read?: string;
};

export type CommandRoute<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> = RouteBase<"command", I, O>;

export type ReadRoute<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> = RouteBase<"read", I, O>;

export type FileRoute<I extends z.ZodType = z.ZodType> = RouteBase<
  "file",
  I,
  { contentType: string }
>;

export type WorkerRoute<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> = RouteBase<"worker", I, O>;

export type Route = CommandRoute | ReadRoute | FileRoute | WorkerRoute;

type DefineOptions<I extends z.ZodType, O> = {
  resource: string;
  method: string;
  name: string;
  input: I;
  output: O;
  compare?: z.ZodType;
  actors: readonly ActorKind[];
  errors: readonly ErrorCode[];
  display_read?: string;
};

function define<K extends RouteKind, I extends z.ZodType, O>(
  kind: K,
  options: DefineOptions<I, O>,
): RouteBase<K, I, O> {
  if (!NAME.test(options.resource) || !NAME.test(options.method)) {
    throw new Error("route resource and method must match ^[a-z][a-z0-9_-]*$");
  }
  const known = new Set<string>(ERROR_CODES);
  for (const code of options.errors) {
    if (!known.has(code)) {
      throw new Error("route error code is outside the common seven");
    }
  }
  return { kind, ...options };
}

export function defineCommand<I extends z.ZodType, O extends z.ZodType>(
  options: DefineOptions<I, O>,
): CommandRoute<I, O> {
  return define("command", options);
}

export function defineRead<I extends z.ZodType, O extends z.ZodType>(
  options: DefineOptions<I, O>,
): ReadRoute<I, O> {
  return define("read", options);
}

// 성공은 원본 바이트와 Content-Type이다(platform/api#R3). 실패는 JSON 오류.
export function defineFile<I extends z.ZodType>(
  options: Omit<DefineOptions<I, { contentType: string }>, "output"> & {
    contentType: string;
  },
): FileRoute<I> {
  const { contentType, ...rest } = options;
  return define("file", { ...rest, output: { contentType } });
}

export function defineWorker<I extends z.ZodType, O extends z.ZodType>(
  options: DefineOptions<I, O>,
): WorkerRoute<I, O> {
  return define("worker", options);
}

export function routePath(route: { resource: string; method: string }): string {
  return `/v${API_MAJOR}/${route.resource}/${route.method}`;
}

export const routeErrorsSchema = z.array(errorCodeSchema);
