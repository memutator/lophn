import { ERROR_CODES, type ErrorCode } from "../../base/mod.ts";
import { z } from "zod";
import type { ChangeName, RouteChange } from "../events/changes.ts";

export const ACTOR_KINDS = ["user", "agent", "app", "machine"] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];

const ROUTE_KINDS = ["command", "read", "file", "memory", "upload"] as const;

type RouteKind = (typeof ROUTE_KINDS)[number];

const NAME = /^[a-z][a-z0-9_-]*$/;

// confirmation이 받는 것이 사람의 결정인지 secret 입력인지.
const CONFIRMATION_KINDS = ["decision", "secret_input"] as const;

type ConfirmationKind = (typeof CONFIRMATION_KINDS)[number];

// 사람 결정 handle이 필요한 route만 선언한다. read는 결정을 제출하지 않는다.
// confirmation_kind를 적지 않으면 decision이다.
type ConfirmationDeclaration<I extends z.ZodType> = {
  confirmation: "required";
  binding: readonly (keyof z.infer<I> & string)[];
  confirmation_kind?: ConfirmationKind;
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
  confirmation_kind?: ConfirmationKind;
  // 이 route가 성공하면 바꾸는 것. command·upload는 반드시 적고 memory는 상태를 바꾸는 것만 적는다.
  // core가 commit 뒤(memory·upload는 handler 성공 뒤) `StateChanged`로 낸다.
  changes?: readonly RouteChange[];
  // read·memory route가 기대는 것. 화면은 이 이름의 `StateChanged`가 오면 다시 읽는다.
  reads?: readonly RouteRead[];
};

// read route의 `reads` 항목. 이름만 적으면 그 이름 전체에 기댄다. id는 입력에서 뽑고 null이면 전체다.
// method 꼴이라 입력 type이 다른 route 정의도 한 목록(Route)에 든다.
export type RouteRead<I = unknown> =
  | ChangeName
  | { name: ChangeName; id(input: I): string | null };

type Reads<I extends z.ZodType> = readonly RouteRead<z.output<I>>[];

// 선언하는 쪽의 입력·결과 type으로 id를 뽑는다.
type Changes<I extends z.ZodType, O extends z.ZodType> = readonly RouteChange<
  z.output<I>,
  z.output<O>
>[];

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

// core 메모리 route. ledger queue를 거치지 않고 입력·출력을 그대로 JSON으로 주고받는다.
export type MemoryRoute<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> = RouteBase<"memory", I, O> & {
  // JSON body 한도를 기본(`RPC_JSON_MAX_BYTES`)보다 키운다. bytes를 base64로 싣는 route만 쓴다(한 조각이 기본 한도보다 큰 것).
  // 어느 길(HTTP, 기기 link)이든 dispatch가 이 값으로 body를 읽는다.
  body_max_bytes?: number;
};

// 요청 body가 JSON이 아니라 바이트 stream인 route다. 입력(JSON)은 header로 오고, core는
// 바이트를 해석하거나 모으지 않고 등록된 handler로 흘려 보낸다. 상한은 route가 정한다.
export type UploadRoute<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> = RouteBase<"upload", I, O> & { max_bytes: number };

export type Route =
  | CommandRoute
  | ReadRoute
  | FileRoute
  | MemoryRoute
  | UploadRoute;

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
  if (
    options.confirmation_kind !== undefined &&
    options.confirmation !== "required"
  ) {
    throw new Error("confirmation_kind needs confirmation: required");
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
    const shape =
      options.input instanceof z.ZodObject
        ? (options.input.shape as Record<string, z.ZodType>)
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
  options: Omit<DefineOptions<I, O>, "compare"> & {
    compare?: C;
    changes: Changes<I, O>;
  },
): Omit<
  CommandRoute<I, O>,
  "compare" | "confirmation" | "binding" | "confirmation_kind"
> & { compare?: C } & Partial<ConfirmationDeclaration<I>> {
  return define("command", options) as Omit<
    CommandRoute<I, O>,
    "compare" | "confirmation" | "binding" | "confirmation_kind"
  > & { compare?: C } & Partial<ConfirmationDeclaration<I>>;
}

export function defineRead<I extends z.ZodType, O extends z.ZodType>(
  options: Omit<
    DefineOptions<I, O>,
    "confirmation" | "binding" | "confirmation_kind"
  > & { reads?: Reads<I> },
): ReadRoute<I, O> {
  return define("read", options);
}

// 성공은 원본 바이트와 Content-Type이다. 실패는 JSON 오류.
export function defineFile<I extends z.ZodType>(
  options: Omit<DefineOptions<I, { contentType: string }>, "output"> & {
    contentType: string;
  } & Partial<ConfirmationDeclaration<I>>,
): FileRoute<I> & Partial<ConfirmationDeclaration<I>> {
  const { contentType, ...rest } = options;
  return define("file", { ...rest, output: { contentType } }) as FileRoute<I> &
    Partial<ConfirmationDeclaration<I>>;
}

// ledger를 쓰지 않는 core 메모리 route(shell/workspace 현재 보기 relay).
// 사람 결정 handle을 받지 않는다. 사람 결정 확인은 confirmation 선언 route에서 처리한다.
export function defineMemory<I extends z.ZodType, O extends z.ZodType>(
  options: Omit<
    DefineOptions<I, O>,
    "confirmation" | "binding" | "confirmation_kind"
  > & {
    changes?: Changes<I, O>;
    reads?: Reads<I>;
    body_max_bytes?: number;
  },
): MemoryRoute<I, O> {
  if (
    options.body_max_bytes !== undefined &&
    (!Number.isSafeInteger(options.body_max_bytes) ||
      options.body_max_bytes < 1)
  ) {
    throw new Error("memory route needs a positive body_max_bytes");
  }
  const given = options as DefineOptions<I, O>;
  if (
    given.confirmation !== undefined ||
    given.binding !== undefined ||
    given.confirmation_kind !== undefined
  ) {
    throw new Error("memory route cannot require a confirmation handle");
  }
  return define("memory", options);
}

// 바이트 body를 받는 route. 사람 결정 handle·CAS는 받지 않는다(바이트는 쓰기 ledger를
// 거치지 않는다). 입력 JSON은 `x-lophn-input` header의 base64url이다.
export function defineUpload<I extends z.ZodType, O extends z.ZodType>(
  options: Omit<
    DefineOptions<I, O>,
    "compare" | "confirmation" | "binding" | "confirmation_kind"
  > & { max_bytes: number; changes: Changes<I, O> },
): UploadRoute<I, O> {
  const { max_bytes, ...rest } = options;
  const given = options as DefineOptions<I, O>;
  if (
    given.confirmation !== undefined ||
    given.binding !== undefined ||
    given.confirmation_kind !== undefined ||
    given.compare !== undefined
  ) {
    throw new Error("upload route cannot require a confirmation handle or CAS");
  }
  if (!Number.isSafeInteger(max_bytes) || max_bytes < 1) {
    throw new Error("upload route needs a positive max_bytes");
  }
  return { ...define("upload", rest), max_bytes };
}

// upload route의 입력 header 이름이다.
export const UPLOAD_INPUT_HEADER = "x-lophn-input";

export function routePath(route: { resource: string; method: string }): string {
  return `/${route.resource}/${route.method}`;
}
