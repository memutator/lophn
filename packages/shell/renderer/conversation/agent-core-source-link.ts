// Agent view core source가 core를 부르는 통로. 응답은 main의 contract client가 route output schema로 이미
// 검사했으므로 여기서는 이 화면이 읽는 field만 타입으로 옮긴다. renderer는 contracts 값을 bundle에 들이지
// 않는다(zod와 core 쪽 graph가 따라 들어온다).
//
// core reader는 한 사람(principal)의 동시 읽기를 제한하고 넘으면 unavailable로 답한다. 화면은 agent·
// session 목록·thread·안내를 한꺼번에 읽고 창에 탭이 여럿일 수 있어, 같은 core 통로로 가는 호출은 한
// 번에 몇 개만 보낸다.
import type { CoreCall } from "../../ipc/core.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { SourceResult } from "./agent-source.ts";

export interface Page {
  readonly next_cursor: string | null;
}

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 50;

/** 같은 core 통로에서 동시에 진행하는 호출 수. */
export const MAX_IN_FLIGHT = 4;

class Gate {
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

const gates = new WeakMap<CoreSource, Gate>();

function gateOf(core: CoreSource): Gate {
  let gate = gates.get(core);
  if (gate === undefined) {
    gate = new Gate();
    gates.set(core, gate);
  }
  return gate;
}

export interface CoreLink {
  /** read(또는 worker 읽기) 하나. */
  read<T>(
    resource: string,
    method: string,
    body: unknown,
    kind?: "read" | "worker" | "memory",
  ): Promise<SourceResult<T>>;
  /** command 하나. 성공 응답은 route output 그대로다. */
  command<T>(
    resource: string,
    method: string,
    body: { input: unknown; compare: unknown; key: string },
  ): Promise<SourceResult<T>>;
  /** cursor로 이어지는 page를 끝까지(또는 상한까지) 그대로 모은다. */
  walk<V extends Page>(
    resource: string,
    method: string,
    input: Record<string, unknown>,
    kind?: "read" | "worker",
  ): Promise<SourceResult<V[]>>;
  /** cursor로 이어지는 목록을 끝까지(또는 상한까지) 모은다. */
  pages<T>(
    resource: string,
    method: string,
    input: Record<string, unknown>,
    /** 응답에서 목록이 든 칸의 이름(`sessions`, `messages`…). */
    key: string,
    kind?: "read" | "worker",
  ): Promise<SourceResult<T[]>>;
}

export function linkOf(core: CoreSource): CoreLink {
  const gate = gateOf(core);

  async function call<T>(
    kind: CoreCall["kind"],
    resource: string,
    method: string,
    body: unknown,
  ): Promise<SourceResult<T>> {
    await gate.enter();
    try {
      const reply = await core.call({ kind, resource, method, body });
      if (!reply.ok) {
        return { ok: false, code: reply.error?.code ?? "internal" };
      }
      return { ok: true, value: reply.value as T };
    } catch {
      // 통로가 끊겨 결과를 모른다. 보낸 말은 접수 조회로 확인한다.
      return { ok: false, code: "unavailable" };
    } finally {
      gate.leave();
    }
  }

  return {
    read: (resource, method, body, kind = "read") =>
      call(kind, resource, method, body),

    command: (resource, method, body) =>
      call("command", resource, method, {
        input: body.input,
        idempotency_key: body.key,
        compare: body.compare,
        prepared: [],
      }),

    async walk<V extends Page>(
      resource: string,
      method: string,
      input: Record<string, unknown>,
      kind: "read" | "worker" = "read",
    ): Promise<SourceResult<V[]>> {
      const found: V[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const result: SourceResult<V> = await call<V>(
          kind,
          resource,
          method,
          cursor === null ? input : { ...input, cursor },
        );
        if (!result.ok) return result;
        found.push(result.value);
        cursor = result.value.next_cursor;
        if (cursor === null) break;
      }
      return { ok: true, value: found };
    },

    async pages<T>(
      resource: string,
      method: string,
      input: Record<string, unknown>,
      key: string,
      kind: "read" | "worker" = "read",
    ): Promise<SourceResult<T[]>> {
      const walked = await this.walk<Page>(resource, method, input, kind);
      if (!walked.ok) return walked;
      return {
        ok: true,
        value: walked.value.flatMap((page) =>
          (page as unknown as Record<string, T[]>)[key]!
        ),
      };
    },
  };
}

/** 같은 입력이 같은 key가 되도록 줄인 값. core로 가는 글이나 blob hash가 아니라 idempotency key의 꼬리일 뿐이다. */
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
