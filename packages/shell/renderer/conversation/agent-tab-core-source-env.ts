// Agent 탭 core source의 모듈들이 같이 쓰는 환경: 이 source가 묶인 agent, `CoreSource.call` 한 겹, 오류 code 바꾸기,
// 짧게 기억하는 메모. route 입력·출력의 type은 protocol의 route 정의에서 오므로 이름이나 모양이 어긋나면 여기서
// type 오류가 난다. 응답은 main의 contract client가 route output schema로 이미 검사했다.
//
// core reader는 한 사람(principal)의 동시 읽기를 제한하고 넘으면 unavailable로 답한다. 화면은 agent·session 목록·
// thread·안내를 한꺼번에 읽고 창에 탭이 여럿일 수 있어, 같은 core 통로로 가는 호출은 한 번에 몇 개만 보낸다.
import type { z } from "zod";

import type { CommandRoute } from "../../../protocol/base/route.ts";
import type {
  AgentId,
  Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";
import type { CoreReply } from "../../ipc/core-api.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { type CommandBody, commandBody } from "../command-call.ts";
import type { SourceResult } from "./agent-tab-source.ts";

/** 이 source가 묶인 agent. factory가 받는 인자 그대로다. */
export interface AgentTarget {
  /** agent id(lophn 또는 `agt_…`). */
  readonly assignment: string;
  readonly workspace: {
    readonly kind: "global" | "project" | "app";
    readonly id: string;
  };
}

/** factory 인자의 workspace를 session의 workspace로 읽는다. `global`은 home이다. */
function workspaceOf(target: AgentTarget): Workspace | null {
  const { workspace } = target;
  return workspace.kind === "global"
    ? null
    : { kind: workspace.kind, id: workspace.id };
}

// ---- route 호출 ----

interface CallableRoute {
  readonly kind: string;
  readonly resource: string;
  readonly method: string;
  readonly input: z.ZodType;
  readonly output: z.ZodType;
}

type In<R extends CallableRoute> = z.input<R["input"]>;
type Out<R extends CallableRoute> = z.output<R["output"]>;

/** 읽기와 memory route. */
type PlainRoute = CallableRoute & { readonly kind: "read" | "memory" };
type ListRoute = PlainRoute & {
  readonly output: z.ZodType<{ next_cursor: string | null }>;
};

/** 같은 core 통로에서 동시에 진행하는 호출 수. */
const MAX_IN_FLIGHT = 4;

export class Gate {
  #open = MAX_IN_FLIGHT;
  readonly #waiting: (() => void)[] = [];

  async enter(): Promise<void> {
    if (this.#open > 0) {
      this.#open -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.#waiting.push(resolve));
  }

  leave(): void {
    const next = this.#waiting.shift();
    if (next === undefined) this.#open += 1;
    else next();
  }
}

/** core 통로 하나마다 하나를 만들어 그 통로로 가는 모든 Env에 넘긴다. */
export function createGate(): Gate {
  return new Gate();
}

/** 화면이 구별하는 오류 code는 공통 일곱과 보내기의 `changed_elsewhere`다. 그 밖은 internal이다. */
const ERROR_CODES: ReadonlySet<string> = new Set([
  "invalid_input",
  "not_found",
  "forbidden",
  "unauthorized",
  "conflict",
  "unavailable",
  "internal",
]);

function errorCodeOf(error: CoreReply["error"]): string {
  // 다른 기기가 먼저 보낸 말이 있어 core가 보내기를 거절했다. 화면은 대화를 다시 읽고 쓴 글을 남긴다.
  if (
    error?.code === "conflict" &&
    error.details?.["reason"] === "changed_elsewhere"
  ) {
    return "changed_elsewhere";
  }
  return error !== undefined && ERROR_CODES.has(error.code)
    ? error.code
    : "internal";
}

export interface Env {
  readonly target: AgentTarget;
  readonly agent: AgentId;
  /** 이 source의 session이 열리는 workspace. home은 null이다. */
  readonly workspace: Workspace | null;
  readonly now: () => number;
  /** 읽기 또는 memory route 하나. */
  read<R extends PlainRoute>(
    route: R,
    input: In<R>,
  ): Promise<SourceResult<Out<R>>>;
  /** command 하나. 성공 응답은 route output 그대로다. */
  command<R extends CommandRoute>(
    route: R,
    body: CommandBody<R>,
  ): Promise<SourceResult<Out<R>>>;
  /** cursor로 이어지는 목록을 끝까지 모은다. */
  pages<R extends ListRoute, T>(
    route: R,
    input: Omit<In<R>, "cursor">,
    pick: (output: Out<R>) => readonly T[],
  ): Promise<SourceResult<T[]>>;
  nowIso(): string;
}

export function createEnv(
  core: CoreSource,
  target: AgentTarget,
  now: () => number,
  gate: Gate,
): Env {
  async function call<T>(
    kind: "read" | "memory" | "command",
    route: CallableRoute,
    body: unknown,
  ): Promise<SourceResult<T>> {
    await gate.enter();
    try {
      const reply = await core.call({
        kind,
        resource: route.resource,
        method: route.method,
        body,
      });
      if (!reply.ok) {
        return { ok: false, code: errorCodeOf(reply.error) };
      }
      return { ok: true, value: reply.value as T };
    } catch {
      // 통로가 끊겨 결과를 모른다. 보낸 말은 접수 조회로 확인한다.
      return { ok: false, code: "unavailable" };
    } finally {
      gate.leave();
    }
  }

  const env: Env = {
    target,
    agent: target.assignment,
    workspace: workspaceOf(target),
    now,
    read: (route, input) => call(route.kind as "read" | "memory", route, input),
    command: (route, body) => call("command", route, commandBody(route, body)),
    async pages<R extends ListRoute, T>(
      route: R,
      input: Omit<In<R>, "cursor">,
      pick: (output: Out<R>) => readonly T[],
    ): Promise<SourceResult<T[]>> {
      const found: T[] = [];
      let cursor: string | null = null;
      for (;;) {
        const result: SourceResult<Out<R>> = await call(
          "read",
          route,
          cursor === null ? input : { ...input, cursor },
        );
        if (!result.ok) return result;
        found.push(...pick(result.value));
        cursor = result.value.next_cursor;
        if (cursor === null) return { ok: true, value: found };
      }
    },
    nowIso: () => new Date(now()).toISOString(),
  };
  return env;
}

// ---- 값 ----

export const done: SourceResult<void> = { ok: true, value: undefined };

export const dropValue = <T>(result: SourceResult<T>): SourceResult<void> =>
  result.ok ? done : result;

/** 같은 입력이 같은 key가 되도록 줄인 값. core로 가는 글이 아니라 idempotency key의 꼬리일 뿐이다. */
export async function keyTag(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** 짧은 시간 안의 같은 읽기를 한 번만 하게 하는 한 칸 메모. */
export interface Memo<T> {
  get(): T | undefined;
  set(value: T): void;
  clear(): void;
}

export function memo<T>(now: () => number, ttlMs: number): Memo<T> {
  let entry: { at: number; value: T } | null = null;
  return {
    get: () =>
      entry !== null && now() - entry.at < ttlMs ? entry.value : undefined,
    set: (value) => {
      entry = { at: now(), value };
    },
    clear: () => {
      entry = null;
    },
  };
}
