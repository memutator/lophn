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

// 사람 결정 handle이 필요한 route만 선언한다. read는 결정을 제출하지 않는다.
export type ConfirmationDeclaration<I extends z.ZodType> = {
  confirmation: "required";
  binding: readonly (keyof z.infer<I> & string)[];
};

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
  confirmation?: "required";
  binding?: readonly string[];
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
} & Partial<ConfirmationDeclaration<I>>;

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
  if (options.confirmation !== undefined || options.binding !== undefined) {
    // 사람 결정은 제출이다. read가 결정을 받으면 표시와 제출이 한 통로로 섞인다.
    if (kind === "read") {
      throw new Error("read route cannot require a confirmation handle");
    }
    if (options.confirmation !== "required" || !options.binding?.length) {
      throw new Error(
        "confirmation requires both confirmation and a binding field list",
      );
    }
    const shape = options.input instanceof z.ZodObject
      ? options.input.shape as Record<string, z.ZodType>
      : undefined;
    for (const field of options.binding) {
      if (!shape || !(field in shape)) {
        throw new Error(`confirmation binding field is not in input: ${field}`);
      }
    }
  }
  return { kind, ...options };
}

export function defineCommand<
  I extends z.ZodType,
  O extends z.ZodType,
  C extends z.ZodType = z.ZodObject<Record<string, never>>,
>(
  options: Omit<DefineOptions<I, O>, "compare"> & { compare?: C },
):
  & Omit<CommandRoute<I, O>, "compare" | "confirmation" | "binding">
  & { compare?: C }
  & Partial<ConfirmationDeclaration<I>> {
  return define("command", options) as
    & Omit<CommandRoute<I, O>, "compare" | "confirmation" | "binding">
    & { compare?: C }
    & Partial<ConfirmationDeclaration<I>>;
}

export function defineRead<I extends z.ZodType, O extends z.ZodType>(
  options: Omit<DefineOptions<I, O>, "confirmation" | "binding">,
): ReadRoute<I, O> {
  return define("read", options);
}

// 성공은 원본 바이트와 Content-Type이다(platform/api#R3). 실패는 JSON 오류.
export function defineFile<I extends z.ZodType>(
  options:
    & Omit<DefineOptions<I, { contentType: string }>, "output">
    & { contentType: string }
    & Partial<ConfirmationDeclaration<I>>,
): FileRoute<I> & Partial<ConfirmationDeclaration<I>> {
  const { contentType, ...rest } = options;
  return define("file", { ...rest, output: { contentType } }) as
    & FileRoute<I>
    & Partial<ConfirmationDeclaration<I>>;
}

export function defineWorker<I extends z.ZodType, O extends z.ZodType>(
  options: DefineOptions<I, O> & Partial<ConfirmationDeclaration<I>>,
): WorkerRoute<I, O> & Partial<ConfirmationDeclaration<I>> {
  return define("worker", options) as
    & WorkerRoute<I, O>
    & Partial<ConfirmationDeclaration<I>>;
}

export function routePath(route: { resource: string; method: string }): string {
  return `/v${API_MAJOR}/${route.resource}/${route.method}`;
}

export const routeErrorsSchema = z.array(errorCodeSchema);
