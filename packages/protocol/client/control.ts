import { err, ok, type Result } from "../../base/mod.ts";
import { z } from "zod";
import type { ConfirmationHandleRegister } from "../base/confirmation-handle.ts";
import {
  controlConfirmationSchema,
  controlConnectSchema,
  controlIdentifySchema,
  controlRequestSchema,
  controlResponseSchema,
  type ControlClient,
  type ControlConfirmation,
  type ControlConnect,
  type ControlIdentify,
} from "../supervision/core-control.ts";
import type { Diagnostic } from "../supervision/supervision.ts";

// control socket 하나에 요청 한 줄을 보내고 답 한 줄을 받는다. 연결·읽기 실패는 unavailable이다.
// socket 경로 계산과 실제 IO는 부르는 쪽(shell main·CLI)이 넘긴다.
export type ControlDial = (
  request: string,
  timeoutMs: number,
) => Promise<Result<string>>;

// 답이 오지 않는 core가 client를 붙잡지 않게 하는 한 요청의 기한.
export const CONTROL_REQUEST_TIMEOUT_MS = 5_000;

export type ControlRequestDeps = {
  dial: ControlDial;
  timeoutMs?: number;
};

function malformed(): Result<never> {
  return err({ code: "internal", message: "control 응답이 계약과 다르다" });
}

async function call<S extends z.ZodType>(
  deps: ControlRequestDeps,
  request: unknown,
  output: S,
): Promise<Result<z.output<S>>> {
  // 부르는 쪽이 만든 요청도 경계에서 한 번 본다. contract 밖 값이 나가면 core가 거절한다.
  const parsedRequest = controlRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    return err({
      code: "invalid_input",
      message: "control 요청이 계약과 다르다",
    });
  }
  const line = await deps.dial(
    JSON.stringify(parsedRequest.data),
    deps.timeoutMs ?? CONTROL_REQUEST_TIMEOUT_MS,
  );
  if (!line.ok) return line;
  let body: unknown;
  try {
    body = JSON.parse(line.value);
  } catch {
    return malformed();
  }
  const response = controlResponseSchema.safeParse(body);
  if (!response.success) return malformed();
  if (!response.data.ok) return err(response.data.error);
  const value = output.safeParse(response.data.value);
  if (!value.success) return malformed();
  return ok(value.data as z.output<S>);
}

export function controlIdentify(
  deps: ControlRequestDeps,
): Promise<Result<ControlIdentify>> {
  return call(deps, { type: "identify" }, controlIdentifySchema);
}

export function controlConnect(
  deps: ControlRequestDeps,
  client: ControlClient,
): Promise<Result<ControlConnect>> {
  return call(deps, { type: "connect", client }, controlConnectSchema);
}

export function controlStop(deps: ControlRequestDeps): Promise<Result<null>> {
  return call(deps, { type: "stop" }, z.null());
}

export function controlDiagnostic(
  deps: ControlRequestDeps,
  diagnostic: Diagnostic,
): Promise<Result<null>> {
  return call(deps, diagnostic, z.null());
}

export function controlConfirmationHandle(
  deps: ControlRequestDeps,
  shellCapability: string,
  register: ConfirmationHandleRegister,
): Promise<Result<ControlConfirmation>> {
  return call(
    deps,
    { ...register, shell_capability: shellCapability },
    controlConfirmationSchema,
  );
}

export function controlCloseConfirmationWindow(
  deps: ControlRequestDeps,
  shellCapability: string,
  windowId: string,
): Promise<Result<null>> {
  return call(
    deps,
    {
      type: "confirmation_handle_close_window",
      shell_capability: shellCapability,
      window_id: windowId,
    },
    z.null(),
  );
}
