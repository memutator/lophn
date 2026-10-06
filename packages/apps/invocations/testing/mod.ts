/**
 * apps/invocations의 test fixture다. mod.ts에서 내보내지 않는다.
 *
 * 실제 앱 runtime entrypoint(handleInvoke)와 supervisor 쪽 broker·전달 목록을 잇고, 실제 core로
 * 가는 sender만 시험이 넣는다. core harness(apps/core/testing)는 `*_test.ts`만 import할 수 있어 여기서
 * 띄우지 않는다.
 */
import {
  createIdSource,
  type ManualClock,
  seededRandom,
} from "../../../base/mod.ts";
import { validateBlueprint } from "../../blueprint/mod.ts";
import type { Blueprint } from "../../blueprint/mod.ts";
import {
  createCoreSender,
  createSupervisorDelivery,
  type SupervisorDelivery,
} from "../../../../apps/app-supervisor/delivery.ts";
import type { BrokerChild } from "../../permissions/broker/invocations.ts";
import type {
  DeliveryLimits,
  DeliveryMessage,
  DeliveryOutcome,
} from "../delivery/queue.ts";
import type { BrokerTransport } from "../../runtime/entrypoint/broker-client.ts";
import { handleInvoke } from "../../runtime/entrypoint/invoke.ts";
import { startRuntime } from "../../runtime/entrypoint/startup.ts";
import {
  APP,
  connection,
  installHandlers,
  NONCE,
  REL,
  shaKey,
  startLine,
} from "../../runtime/entrypoint/testing.ts";
import type { AppConnection } from "../../runtime/entrypoint/wire.ts";

export { APP, connection, installHandlers, NONCE, REL };

const ALL_COMMANDS = ["usage.read", "usage.save", "usage.sync", "usage.purge"];

function command(
  key: string,
  effect: "read" | "write" | "external",
  extra: Record<string, unknown> = {},
) {
  return {
    key,
    label: key,
    description: `${key} purpose`,
    effect,
    confirm: false,
    input: null,
    revert: { supported: false },
    ...extra,
  };
}

// 읽기·쓰기·외부 전송·확인이 필요한 명령을 하나씩 가진 blueprint.
export function fixtureBlueprint(): Blueprint {
  const parsed = validateBlueprint({
    name: "Usage",
    description: "Reads and writes usage",
    screens: [{
      key: "usage",
      label: "Usage",
      path: "/usage",
      sizes: ["full", "panel"],
    }],
    commands: [
      command("usage.read", "read"),
      command("usage.save", "write"),
      command("usage.sync", "external"),
      command("usage.purge", "write", {
        confirm: true,
        input: {
          type: "object",
          properties: { amount: { type: "integer", minimum: 1 } },
          required: ["amount"],
          additionalProperties: false,
        },
      }),
    ],
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [],
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

// 앱 runtime이 broker socket으로 보내는 요청을 supervisor 쪽 broker가 받게 잇는다.
export function brokerTransport(
  delivery: SupervisorDelivery,
  child: BrokerChild,
): BrokerTransport {
  return (request) => {
    const result = delivery.broker.submit(child, request.body);
    return Promise.resolve(
      result.ok
        ? { status: 200, body: result.value }
        : { status: 400, body: { error: result.error } },
    );
  };
}

export type Gate = {
  // 열기 전까지 core로 가는 전송은 멈춰 있다.
  open(): void;
  sends: DeliveryMessage[];
};

// 전송 앞에 문을 단다. 문이 닫혀 있는 동안 core의 저장이 느린 상황을 만든다.
export function gatedSend(
  send: (message: DeliveryMessage) => Promise<DeliveryOutcome>,
  initiallyOpen: boolean,
): {
  send: (message: DeliveryMessage) => Promise<DeliveryOutcome>;
  gate: Gate;
} {
  let release: () => void = () => {};
  let opened = initiallyOpen;
  let waiting: Promise<void> = opened
    ? Promise.resolve()
    : new Promise((resolve) => {
      release = resolve;
    });
  const sends: DeliveryMessage[] = [];
  return {
    gate: {
      sends,
      open() {
        opened = true;
        release();
        waiting = Promise.resolve();
      },
    },
    async send(message) {
      await waiting;
      sends.push(message);
      return await send(message);
    },
  };
}

export type RuntimeWorld = {
  delivery: SupervisorDelivery;
  state: ReturnType<typeof startRuntime>["state"];
  frames: Uint8Array[];
  invoke(
    body: Record<string, unknown>,
    over?: Record<string, unknown>,
  ): ReturnType<typeof handleInvoke>;
  // direct socket의 cancel·status 같은 다른 경로를 같은 연결로 부른다.
  call(
    path: string,
    body: Record<string, unknown>,
    over?: Record<string, unknown>,
  ): ReturnType<typeof handleInvoke>;
};

// 앱 runtime 하나와 그 broker·전달 목록. 응답은 전달을 기다리지 않는다.
export function openRuntimeWorld(deps: {
  clock: ManualClock;
  send: (message: DeliveryMessage) => Promise<DeliveryOutcome>;
  blueprint?: Blueprint;
  limits?: DeliveryLimits;
  mode?: "live";
}): RuntimeWorld {
  const frames: Uint8Array[] = [];
  const delivery = createSupervisorDelivery({
    clock: deps.clock,
    send: deps.send,
    write: (frame) => frames.push(frame),
    limits: deps.limits,
    // 시험이 clock과 pump를 직접 다룬다.
    setTimer: () => 0,
    clearTimer: () => {},
  });
  const child: BrokerChild = {
    app: APP,
    release: REL,
    mode: "live",
    processNonce: NONCE,
  };
  const started = startRuntime({
    line: startLine(),
    blueprint: deps.blueprint ?? fixtureBlueprint(),
    key: shaKey(),
    clock: deps.clock,
    ids: createIdSource({ clock: deps.clock, random: seededRandom(11) }),
    broker: brokerTransport(delivery, child),
    dataSchema: 0,
  });
  started.state.accepting = true;
  return {
    delivery,
    state: started.state,
    frames,
    invoke(body, over = {}) {
      return this.call("/_lophn/commands/invoke", body, over);
    },
    call(path, body, over = {}) {
      return handleInvoke(
        started.state,
        path,
        new TextEncoder().encode(JSON.stringify(body)),
        connection({ commands: ALL_COMMANDS, ...over }) as AppConnection,
      );
    },
  };
}

// core harness(apps/core/testing)의 구조만 본다. harness는 `*_test.ts`가 띄워 넘긴다.
export type CoreLike = {
  port: number;
  credential(input: {
    actor: "machine" | "user";
    principal: string;
    scope: { operations: string[]; targets: Record<string, never> };
    conditions: Record<string, never>;
  }): Promise<
    { ok: true; value: { token: string } } | {
      ok: false;
      error: { message: string };
    }
  >;
};

const MACHINE_OPERATIONS = [
  "invocation.record_started",
  "invocation.record_finished",
  "invocation.record_denied",
  "invocation.accept_confirm",
  "invocations.get",
  "invocations.list",
];

export type CoreAccess = {
  token: string;
  // 실제 core의 `/v1/invocations/<method>`로 보내는 sender. 응답은 core가 판단한다.
  send: (message: DeliveryMessage) => Promise<DeliveryOutcome>;
  post(
    path: string,
    input: unknown,
    options?: { token?: string },
  ): Promise<{ status: number; body: Record<string, unknown> }>;
  // core에 남은 invocation. 기록이 없으면 null이다.
  invocation(id: string): Promise<Record<string, unknown> | null>;
  invocations(): Promise<Record<string, unknown>[]>;
};

export async function coreAccess(harness: CoreLike): Promise<CoreAccess> {
  const issued = await harness.credential({
    actor: "machine",
    principal: "task:invocations-test",
    scope: { operations: MACHINE_OPERATIONS, targets: {} },
    conditions: {},
  });
  if (!issued.ok) throw new Error(issued.error.message);
  const token = issued.value.token;
  const base = `http://127.0.0.1:${harness.port}`;
  async function post(
    path: string,
    input: unknown,
    options: { token?: string } = {},
  ) {
    const response = await fetch(`${base}/v1/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.token ?? token}`,
      },
      body: JSON.stringify({
        input,
        idempotency_key: `k-${crypto.randomUUID()}`,
        compare: {},
        prepared: [],
      }),
    });
    return {
      status: response.status,
      body: await response.json() as Record<string, unknown>,
    };
  }
  // read route는 입력 객체를 그대로 받는다.
  async function read(path: string, input: unknown) {
    const response = await fetch(`${base}/v1/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });
    return {
      status: response.status,
      body: await response.json() as Record<string, unknown>,
    };
  }
  return {
    token,
    send: createCoreSender({ baseUrl: base, token: () => token }),
    post,
    async invocation(id) {
      const reply = await read("invocations/get", { invocation: id });
      return (reply.body["invocation"] as Record<string, unknown> | null) ??
        null;
    },
    async invocations() {
      const reply = await read("invocations/list", {});
      return reply.body["invocations"] as Record<string, unknown>[];
    },
  };
}
