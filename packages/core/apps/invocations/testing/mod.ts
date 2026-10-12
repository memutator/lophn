/**
 * apps/invocations의 test fixture다. mod.ts에서 내보내지 않는다.
 *
 * 전달 목록을 막았다 여는 문, 확인이 필요한 명령까지 갖춘 blueprint, 실제 core로 가는 sender를 쓴다.
 * 앱 runtime과 잇는 부분은 다른 leaf의 fixture를 import해야 해서 `world_test.ts`에 있고,
 * core harness(apps/core/testing)도 `*_test.ts`만 import할 수 있어 시험이 띄워 넘긴다.
 */
import { validateBlueprint } from "../../blueprint/mod.ts";
import type { Blueprint } from "../../blueprint/mod.ts";
import { createCoreSender } from "../delivery/sender.ts";
import type { DeliveryMessage, DeliveryOutcome } from "../mod.ts";

// 다른 leaf의 read 시험이 같은 invocations 표(실제 schema)를 만들 때 쓴다.
export { invocationsSchemaSteps } from "../schema.ts";

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
