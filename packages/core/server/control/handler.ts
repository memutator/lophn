import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import type { ConfirmationHandleRegister } from "../../../protocol/base/mod.ts";
import type { Route } from "../../../protocol/base/mod.ts";
import {
  controlRequestSchema,
  type ControlClient,
  type ControlConfirmation,
  type ControlConnect,
  type ControlIdentify,
  type ControlRequest,
} from "../../../protocol/supervision/core-control.ts";
import type { Diagnostic } from "../../../protocol/supervision/mod.ts";
import type { ShellCapabilities } from "./capability.ts";

// control 요청 하나를 처리한 답과, 그 답을 다 쓴 뒤에 할 일. stop은 응답이 나간 뒤에 종료를 시작한다.
export type ControlReply = { response: unknown; after?: () => void };

// 확인 등록은 shell capability가 있어야만 온다. 다른 자격(HTTP user token, agent·worker credential)으로
// handle을 등록하는 길은 이 handler에도, route에도, worker message에도 없다.
export type ControlDeps = {
  identify(): Promise<Result<ControlIdentify>>;
  // user credential을 발급하고 ledger에 적는다. shell capability는 여기서 붙이지 않는다.
  connect(
    client: ControlClient,
  ): Promise<Result<Omit<ControlConnect, "shell_capability">>>;
  capabilities: ShellCapabilities;
  // capability를 확인한 뒤에만 부른다.
  register(
    register: ConfirmationHandleRegister,
  ): Promise<Result<ControlConfirmation>>;
  closeWindow(windowId: string): Promise<Result<null>>;
  // shutdown barrier를 시작한다. 응답이 나간 뒤에 부른다.
  shutdown(): void;
  diagnostic(diagnostic: Diagnostic): Promise<Result<null>>;
};

// 사람 token이 지니는 operation은 route 등록의 actor 상한에서 계산한다. 손으로 쓴
// 목록이 아니어서 새 route는 user를 허용하면 자동으로 들어가고, machine·app·worker
// 전용 route는 들어가지 않는다. status·health read는 route 이름과 별개로 늘 포함한다.
export function userOperations(
  routes: readonly Route[],
  // 팀이 공개 정책을 내놓은 event 이름. owner 정책이 사람에게 event를 보이려면 필요하다.
  events: readonly string[] = [],
): string[] {
  const names = new Set<string>([
    "platform/status",
    "platform/health",
    ...events,
  ]);
  for (const route of routes) {
    if (route.actors.includes("user")) names.add(route.name);
  }
  return [...names];
}

function failure(code: LophnError["code"], message: string): ControlReply {
  return { response: { ok: false, error: { code, message } } };
}

function reply(result: Result<unknown>): ControlReply {
  return {
    response: result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error },
  };
}

function refusal(): ControlReply {
  return failure("forbidden", "shell capability가 아니다");
}

function parse(line: string): Result<ControlRequest> {
  let body: unknown;
  try {
    body = JSON.parse(line);
  } catch {
    return err({
      code: "invalid_input",
      message: "control 요청이 JSON이 아니다",
    });
  }
  const parsed = controlRequestSchema.safeParse(body);
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "invalid_input", message: "control 요청이 계약과 다르다" });
}

export async function handleControlLine(
  deps: ControlDeps,
  line: string,
): Promise<ControlReply> {
  const request = parse(line);
  if (!request.ok) return reply(request);
  if (request.value.type === "identify") {
    return reply(await deps.identify());
  }
  if (request.value.type === "diagnostic") {
    return reply(await deps.diagnostic(request.value));
  }
  if (request.value.type === "stop") {
    const identified = await deps.identify();
    if (!identified.ok) return reply(identified);
    if (identified.value.state !== "ready") {
      return failure("unavailable", "core가 준비되지 않았다");
    }
    return {
      response: { ok: true, value: null },
      after: () => deps.shutdown(),
    };
  }
  if (request.value.type === "connect") {
    const identified = await deps.identify();
    if (!identified.ok) return reply(identified);
    if (identified.value.state !== "ready") {
      return failure("unavailable", "core가 준비되지 않았다");
    }
    const connected = await deps.connect(request.value.client);
    if (!connected.ok) return reply(connected);
    // capability는 이 길에서만, shell 요청에만 붙는다. connect가 다른 값을 실어 와도 여기서 버린다.
    return reply(
      ok({
        user_token: connected.value.user_token,
        api_url: connected.value.api_url,
        core_epoch: connected.value.core_epoch,
        ...(request.value.client === "shell"
          ? { shell_capability: deps.capabilities.issue() }
          : {}),
      }),
    );
  }
  if (!deps.capabilities.has(request.value.shell_capability)) {
    return refusal();
  }
  if (request.value.type === "confirmation_handle_register") {
    const { shell_capability: _capability, ...register } = request.value;
    return reply(await deps.register(register));
  }
  return reply(await deps.closeWindow(request.value.window_id));
}
