// route 이름과 입력·비교 기준·응답을 contract schema(ALL_ROUTES)로 검사하는 fake core. renderer core source
// test는 이것으로 source가 보낸 입력이 실제 core가 받을 모양인지, fake의 응답이 실제 core가 낼 모양인지
// 확인한다. 어긋남은 호출을 막지 않고 violations에 모은다(source가 오류로 삼켜 가리지 않게). test 끝에서
// `verify()`로 한 번에 단언한다.
import { z } from "zod";
import { ALL_ROUTES } from "../../../../packages/protocol/mod.ts";
import type { CoreCall } from "../../ipc/core.ts";
import type { CoreReply } from "../../ipc/core-api.ts";
import type {
  ConnectionState,
  CoreSource,
} from "../desktop/connection/connection.ts";

export type Handler = (
  // deno-lint-ignore no-explicit-any
  body: any,
  call: CoreCall,
) => CoreReply | Promise<CoreReply>;

/** `read:sessions/list`처럼 kind:resource/method를 key로 하는 응답 표. */
export type Handlers = Readonly<Record<string, Handler>>;

export const ok = (value: unknown): CoreReply => ({ ok: true, value });

export const fail = (code: string): CoreReply => ({
  ok: false,
  error: { code, message: `${code} message` },
});

/** 읽기 응답의 공통 칸(withReadCommon). */
export const META = { as_of_seq: "100", next_cursor: null } as const;

export interface ContractCore {
  readonly core: CoreSource;
  /** 지금까지 부른 호출 전부. */
  readonly calls: CoreCall[];
  /** 지금 진행 중인 호출 수의 최댓값. */
  readonly peak: () => number;
  /** 연결 상태를 듣는 쪽에 알린다. */
  readonly connect: (state: ConnectionState) => void;
  /** 입력·응답이 contract에 어긋나거나 handler가 없는 호출이 있으면 던진다. */
  readonly verify: () => void;
}

type Route = (typeof ALL_ROUTES)[number];

const ROUTES = new Map<string, Route>(
  ALL_ROUTES.map((route) => [
    `${route.kind}:${route.resource}/${route.method}`,
    route,
  ]),
);

/**
 * `checked`에 든 route의 응답만 output schema로 검사한다. 그 밖의 응답은 test가 읽는 칸만 채운 모양이어도
 * 된다. 입력은 모든 route를 검사한다.
 */
export function contractCore(
  handlers: Handlers,
  checked: readonly string[] = [],
  options: { delayMs?: number } = {},
): ContractCore {
  const calls: CoreCall[] = [];
  const violations: string[] = [];
  const listeners = new Set<(state: ConnectionState) => void>();
  let inFlight = 0;
  let peak = 0;

  const parse = (label: string, schema: unknown, value: unknown) => {
    const result = (schema as {
      safeParse: (v: unknown) => {
        success: boolean;
        error?: { message: string };
      };
    }).safeParse(value);
    if (!result.success) {
      violations.push(`${label}: ${result.error?.message ?? "invalid"}`);
    }
  };

  const core: CoreSource = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async call(input) {
      calls.push(input);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        if (options.delayMs !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        }
        const key = `${input.kind}:${input.resource}/${input.method}`;
        const route = ROUTES.get(key);
        if (route === undefined) {
          violations.push(`${key}: not a contract route`);
        } else if (input.kind === "command") {
          const body = input.body as {
            input?: unknown;
            compare?: unknown;
            idempotency_key?: unknown;
            prepared?: unknown;
          };
          parse(`${key} input`, route.input, body.input);
          // 비교 기준을 선언하지 않은 route의 기본은 빈 객체다(commandRequestSchema).
          parse(
            `${key} compare`,
            route.compare ?? z.strictObject({}),
            body.compare,
          );
          if (
            typeof body.idempotency_key !== "string" ||
            body.idempotency_key === ""
          ) {
            violations.push(`${key}: idempotency_key is missing`);
          }
          if (!Array.isArray(body.prepared)) {
            violations.push(`${key}: prepared is missing`);
          }
        } else {
          parse(`${key} input`, route.input, input.body);
        }
        const handler = handlers[key];
        if (handler === undefined) {
          violations.push(`${key}: no handler`);
          return fail("not_found");
        }
        const body = input.kind === "command"
          ? (input.body as { input: unknown }).input
          : input.body;
        const reply = await handler(body, input);
        if (reply.ok && route !== undefined && checked.includes(key)) {
          parse(`${key} output`, route.output, reply.value);
        }
        return reply;
      } finally {
        inFlight -= 1;
      }
    },
  };

  return {
    core,
    calls,
    peak: () => peak,
    connect(state) {
      for (const listener of listeners) listener(state);
    },
    verify() {
      if (violations.length > 0) {
        throw new Error(`contract violations:\n${violations.join("\n")}`);
      }
    },
  };
}
