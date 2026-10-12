// 앱 프로세스의 automation 조립. clock(`automations/clock.ts`)에 이 프로세스의 상태·broker·호출 경로를
// 주입한다. 직접 호출과 같은 선언·입력 검사·handler를 쓰고 trigger만 automation이다.
// clock은 live 프로세스에서만 연다.
import {
  type Acquire,
  type AutomationClock,
  type AutomationPorts,
  type AutomationSpec,
  createAutomationClock,
  type Prepared,
} from "../../automations/mod.ts";
import { validateInput } from "../../blueprint/mod.ts";
import { readSchedulePort } from "../../invocations/mod.ts";
import { commandsMatchBlueprint } from "./control.ts";
import {
  denyAutomation,
  launchAutomation,
  timeoutAutomation,
} from "./invoke.ts";
import type { RuntimeState } from "./state.ts";

export type AutomationTimers = {
  tick(): number;
  every(ms: number, fn: () => void): () => void;
  after(ms: number, fn: () => void): () => void;
};

// 실제 시계. tick은 프로세스 단조 시계라 벽시계 변경에 영향받지 않는다.
export function systemTimers(): AutomationTimers {
  return {
    tick: () => Math.floor(performance.now()),
    every(ms, fn) {
      const handle = setInterval(fn, ms);
      return () => clearInterval(handle);
    },
    after(ms, fn) {
      const handle = setTimeout(fn, ms);
      return () => clearTimeout(handle);
    },
  };
}

export function automationSpecs(state: RuntimeState): AutomationSpec[] {
  return state.blueprint.automatic_tasks.map((task) => ({
    key: task.key,
    when: task.when,
    command: task.command,
    ...(task.input === undefined ? {} : { input: task.input }),
  }));
}

function prepare(state: RuntimeState, spec: AutomationSpec): Prepared {
  const declared = state.blueprint.commands.find((command) =>
    command.key === spec.command
  );
  // 선언 없는 command는 어떤 호출인지 모르므로 거절 사실도 만들지 않는다.
  if (!declared) return { ok: false, reason: "undeclared_command" };
  // confirm=true command는 automation으로 실행하지 않는다.
  if (declared.confirm) {
    denyAutomation(state, { key: spec.key, command: declared }, "confirm");
    return { ok: false, reason: "confirm_required" };
  }
  // 직접 호출과 같은 규칙으로 고정 입력을 검사하고 default를 채운다.
  const supplied = spec.input === undefined && declared.input?.type === "object"
    ? {}
    : spec.input;
  const validated = validateInput(declared.input, supplied);
  if (!validated.ok) {
    denyAutomation(
      state,
      { key: spec.key, command: declared },
      "invalid_input",
    );
    return { ok: false, reason: "invalid_input" };
  }
  const handler = readSchedulePort()?.handlers().find((item) =>
    item.command === spec.command
  );
  if (!handler) return { ok: false, reason: "handler_missing" };
  return {
    ok: true,
    start() {
      const launched = launchAutomation(state, {
        key: spec.key,
        command: declared,
        input: validated.value,
      });
      // 준비에서 handler를 확인했으므로 여기 오지 않는다. 와도 이미 받은 permit은 정상 반환한다.
      if (!launched) {
        return {
          invocation: state.ids.newId("inv"),
          done: Promise.resolve(),
          timedOut: () => undefined,
        };
      }
      return {
        invocation: launched.invocation,
        done: launched.done,
        timedOut: () => timeoutAutomation(state, launched.invocation),
      };
    },
  };
}

async function acquire(state: RuntimeState, key: string): Promise<Acquire> {
  const release = state.identity.release;
  if (release === null) return { kind: "unavailable" };
  let response: { status: number; body: unknown };
  try {
    response = await state.broker.tryAcquireAutomation({ release, key });
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === 403) return { kind: "denied" };
  const body = response.body as
    | { permit?: unknown; timeout_ms?: unknown }
    | null;
  if (response.status !== 200 || body === null || typeof body !== "object") {
    return { kind: "unavailable" };
  }
  if (body.permit !== true) return { kind: "busy" };
  return {
    kind: "permit",
    timeout_ms: typeof body.timeout_ms === "number" ? body.timeout_ms : 600_000,
  };
}

export function createAutomationPorts(
  state: RuntimeState,
  timers: AutomationTimers,
): AutomationPorts {
  return {
    ...timers,
    open: () => state.accepting && !state.closed,
    schemaOk: () => state.ready && commandsMatchBlueprint(state),
    prepare: (spec) => prepare(state, spec),
    acquire: (key) => acquire(state, key),
    async release(key, invocation) {
      const release = state.identity.release;
      if (release === null) return;
      await state.broker.releaseAutomation({ release, key, invocation });
    },
  };
}

// 이 프로세스의 automation 수명. 업무 통로가 열릴 때 시작하고 닫히면 멈춘다. preview·test와 선언이
// 없는 앱은 clock이 없다.
export type AutomationLifecycle = {
  clock: AutomationClock;
  open(): void;
  close(): void;
};

export function installAutomations(
  state: RuntimeState,
  timers: AutomationTimers = systemTimers(),
): AutomationLifecycle | undefined {
  if (state.identity.mode !== "live") return undefined;
  const automations = automationSpecs(state);
  if (automations.length === 0) return undefined;
  const clock = createAutomationClock({
    automations,
    ports: createAutomationPorts(state, timers),
  });
  const lifecycle: AutomationLifecycle = {
    clock,
    open: () => clock.start(),
    close: () => clock.stop(),
  };
  state.automations = lifecycle;
  return lifecycle;
}
