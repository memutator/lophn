// `app:call`의 main service(shell/app-frame#R15). 앱 preload가 보낸 `{command, input}`만 받고,
// 앱·release·mode·연결은 IPC를 보낸 실제 view에서 정한다(R12). command는 그 view의 고정
// blueprint로 검사하고 default를 적용한 뒤 view 연결의 앱 socket `/_lophn/commands/invoke`로
// 보낸다(apps/invocations 직접 호출). 응답은 앱 handler의 결과이고 ledger 기록을 기다리지 않는다.
// confirm command는 사람 approval을 거쳐 받은 proof를 붙여야만 보낸다(platform/approvals).
// socket 경로·Authorization·proof는 main에만 있고 페이지로 가지 않는다(R9, R13).
import type { AppBinding, ConnectTarget, Outcome } from "./app-connection.ts";
import type { Invoker, InvokeResponse } from "./app-invoke.ts";
import type { BoundView } from "./registry.ts";
import { CONNECTION_RENEW_MS } from "./registry.ts";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** blueprint의 command 선언 중 main이 쓰는 것(contracts/apps blueprint CommandDeclaration). */
export interface CommandDeclaration {
  key: string;
  label: string;
  effect: "read" | "write" | "external";
  confirm: boolean;
  input: unknown;
}

export interface Blueprint {
  commands: readonly CommandDeclaration[];
}

type Checked<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: "invalid_input"; message: string } };

/**
 * contracts/apps blueprint의 `validateInput`·`canonicalInputHash`. 앱 runtime이 쓰는 것과 같은
 * 정본을 main 조립이 넘긴다(shell tsc는 contracts 원본을 type 검사하지 않는다).
 */
export interface InputRules {
  validate(schema: never, value?: unknown): Checked<JsonValue | undefined>;
  hash(schema: never, value?: unknown): Promise<Checked<string>>;
}

export type CallErrorCode =
  | "invalid_input"
  | "forbidden"
  | "conflict"
  | "unavailable";

export type CallOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: CallErrorCode; message: string } };

function fail(code: CallErrorCode, message: string): CallOutcome<never> {
  return { ok: false, error: { code, message } };
}

// IPC 입력 상한. contracts의 IPC 상한(64 KiB)과 같다.
export const CALL_INPUT_MAX_BYTES = 64 * 1024;

/** 고정 bundle의 blueprint를 읽는다. 같은 bundle은 같은 blueprint다. */
export type BlueprintSource = (view: {
  app: string;
  release: string | null;
  mode: ConnectTarget["mode"];
  bundleHash: string;
}) => Promise<Outcome<Blueprint>>;

/** core가 서명한 confirm proof envelope. 그대로 invoke 본문에 싣는다. */
export interface SignedProof {
  payload: unknown;
  signature: string;
}

/** confirm command 하나의 사람 결정 요청. main이 검사·default 적용한 정규 입력이다. */
export interface ConfirmRequest {
  view_session: string;
  app: string;
  release: string | null;
  mode: ConnectTarget["mode"];
  processNonce: string;
  command: CommandDeclaration;
  input: JsonValue | undefined;
  inputHash: string;
}

/** approval·confirmation window·accept_confirm을 거쳐 proof를 받는다. 거절·만료는 실패다. */
export type ConfirmGate = (
  request: ConfirmRequest,
) => Promise<CallOutcome<SignedProof>>;

export interface AppCallDeps {
  connector: {
    connectCommands(
      target: ConnectTarget,
      commands: readonly string[],
    ): Promise<Outcome<{ binding: AppBinding; commands: string[] }>>;
  };
  blueprint: BlueprintSource;
  rules: InputRules;
  confirm: ConfirmGate;
  invoke: Invoker;
  ids: { requestKey(): string };
  clock: { nowMs(): number };
}

// 오래 남는 view가 많아도 연결·blueprint cache가 끝없이 자라지 않게 한다.
const CACHE_LIMIT = 64;

interface CallBinding {
  identity: string;
  binding: AppBinding;
  commands: readonly string[];
}

function remember<K, V>(cache: Map<K, V>, key: K, value: V): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
}

function identityOf(binding: AppBinding): string {
  return `${binding.processNonce} ${binding.bundleHash} ${binding.release}`;
}

/** contracts appCallSchema와 같은 검사. 모르는 field·빈 command·wildcard는 거절한다. */
export function checkCall(
  value: unknown,
): { command: string; input: JsonValue } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const call = value as Record<string, unknown>;
  if (Object.keys(call).sort().join(",") !== "command,input") return undefined;
  const command = call.command;
  if (
    typeof command !== "string" || command.trim().length === 0 ||
    /\p{Cc}/u.test(command) || command.includes("*")
  ) {
    return undefined;
  }
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(call.input);
  } catch {
    return undefined;
  }
  if (
    encoded === undefined ||
    new TextEncoder().encode(encoded).byteLength > CALL_INPUT_MAX_BYTES
  ) {
    return undefined;
  }
  // JSON 왕복과 같은 값만 받는다(undefined·함수·NaN 같은 비 JSON 값은 빠지거나 바뀐다).
  const input = JSON.parse(encoded) as JsonValue;
  if (JSON.stringify(input) !== encoded) return undefined;
  return { command, input };
}

const PASSED: readonly string[] = [
  "invalid_input",
  "forbidden",
  "conflict",
  "unavailable",
];

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

// 선언되지 않은 command와 이 view 연결 밖 command는 같은 답이다(있는지 새지 않는다).
const NOT_AVAILABLE = fail("invalid_input", "command is not available");

export function createAppCall(deps: AppCallDeps) {
  const blueprints = new Map<string, Blueprint>();
  const bindings = new Map<string, CallBinding>();
  const pending = new Map<string, Promise<Outcome<CallBinding>>>();

  async function blueprintOf(view: BoundView): Promise<Outcome<Blueprint>> {
    const key = view.binding.bundleHash;
    const known = blueprints.get(key);
    if (known !== undefined) return { ok: true, value: known };
    const read = await deps.blueprint({
      app: view.target.app,
      release: view.binding.release,
      mode: view.target.mode,
      bundleHash: key,
    });
    if (read.ok) remember(blueprints, key, read.value);
    return read;
  }

  function fresh(found: CallBinding | undefined, view: BoundView): boolean {
    if (found === undefined || found.identity !== identityOf(view.binding)) {
      return false;
    }
    const expires = found.binding.expiresAtMs;
    return expires === null ||
      expires - deps.clock.nowMs() > CONNECTION_RENEW_MS;
  }

  // view 하나에 blueprint의 모든 command를 범위로 한 연결 하나다. 같은 view의 동시 호출은 한
  // 번만 연결을 얻는다. 화면 연결과 다른 프로세스·bundle·release면 받지 않는다.
  function callBinding(
    view: BoundView,
    blueprint: Blueprint,
    renew: boolean,
  ): Promise<Outcome<CallBinding>> {
    const found = bindings.get(view.view_session);
    if (!renew && fresh(found, view)) {
      return Promise.resolve({ ok: true, value: found! });
    }
    const inflight = pending.get(view.view_session);
    if (inflight !== undefined) return inflight;
    const target: ConnectTarget = {
      ...view.target,
      release: view.binding.release,
    };
    const keys = blueprint.commands.map((command) => command.key);
    const started = deps.connector.connectCommands(target, keys).then(
      (opened): Outcome<CallBinding> => {
        if (!opened.ok) return opened;
        if (
          identityOf(opened.value.binding) !== identityOf(view.binding)
        ) {
          bindings.delete(view.view_session);
          return {
            ok: false,
            error: { code: "conflict", message: "the app view changed" },
          };
        }
        const next: CallBinding = {
          identity: identityOf(view.binding),
          binding: opened.value.binding,
          commands: opened.value.commands,
        };
        remember(bindings, view.view_session, next);
        return { ok: true, value: next };
      },
    ).finally(() => pending.delete(view.view_session));
    pending.set(view.view_session, started);
    return started;
  }

  async function send(
    bound: CallBinding,
    body: Record<string, unknown>,
  ): Promise<InvokeResponse | undefined> {
    try {
      return await deps.invoke({
        endpoint: bound.binding.endpoint,
        authorization: bound.binding.authorization,
        body,
      });
    } catch {
      return undefined;
    }
  }

  return {
    /** `app:call` 하나. view는 IPC sender에서 registry가 정한 값이다. */
    async call(view: BoundView, value: unknown): Promise<CallOutcome<unknown>> {
      const call = checkCall(value);
      if (call === undefined) return fail("invalid_input", "call is invalid");
      const blueprint = await blueprintOf(view);
      if (!blueprint.ok) return fail("unavailable", "app is not available");
      const declared = blueprint.value.commands.find((command) =>
        command.key === call.command
      );
      if (declared === undefined) return NOT_AVAILABLE;
      // 입력이 없는 command는 페이지가 null로 부른다. 앱에는 입력 없이 보낸다.
      const supplied = declared.input === null && call.input === null
        ? undefined
        : call.input;
      const validated = deps.rules.validate(declared.input as never, supplied);
      if (!validated.ok) return fail("invalid_input", validated.error.message);
      const input = validated.value;

      let bound = await callBinding(view, blueprint.value, false);
      if (!bound.ok) return fail(bound.error.code, bound.error.message);
      if (!bound.value.commands.includes(declared.key)) return NOT_AVAILABLE;

      let proof: SignedProof | undefined;
      if (declared.confirm) {
        const hash = await deps.rules.hash(declared.input as never, input);
        if (!hash.ok) return fail("invalid_input", hash.error.message);
        const decided = await deps.confirm({
          view_session: view.view_session,
          app: view.target.app,
          release: view.binding.release,
          mode: view.target.mode,
          processNonce: view.binding.processNonce,
          command: declared,
          input,
          inputHash: hash.value,
        });
        if (!decided.ok) return decided;
        proof = decided.value;
      }

      const body: Record<string, unknown> = {
        request_key: deps.ids.requestKey(),
        command: declared.key,
        ...(view.binding.release === null
          ? {}
          : { release: view.binding.release }),
        ...(input === undefined ? {} : { input }),
        ...(proof === undefined ? {} : { proof }),
      };
      let response = await send(bound.value, body);
      // 401은 handler 전에 연결 검증에서 거절된 것이다. 연결을 한 번 다시 얻어 같은 요청을 보낸다.
      if (response?.status === 401) {
        bound = await callBinding(view, blueprint.value, true);
        if (!bound.ok) return fail(bound.error.code, bound.error.message);
        if (!bound.value.commands.includes(declared.key)) return NOT_AVAILABLE;
        response = await send(bound.value, body);
      }
      if (response === undefined) {
        // 보낸 뒤 끊기면 결과를 모른다. 쓰기를 자동으로 다시 부르지 않는다.
        return fail(
          "unavailable",
          declared.effect === "read"
            ? "app is not available"
            : "command result is unknown",
        );
      }
      return outcomeOf(response);
    },
  };
}

/** 앱 invoke 응답을 페이지에 보일 결과로 바꾼다. 화면 검사 host도 같은 판정을 쓴다. */
export function outcomeOf(response: InvokeResponse): CallOutcome<unknown> {
  const body = record(response.body);
  if (response.status === 200) {
    if (record(body?.result) === undefined) {
      return fail("unavailable", "app response did not match");
    }
    return { ok: true, value: body };
  }
  const error = record(body?.error);
  const code = error?.code;
  if (
    typeof code === "string" && PASSED.includes(code) &&
    typeof error?.message === "string"
  ) {
    return fail(code as CallErrorCode, error.message);
  }
  return fail("unavailable", "command failed");
}
