// 앱 통로(direct call)의 coding agent 쪽이다(T21, mcp#R29, cli#R31). core의 `apps/connect`로
// 서명된 connection을 받고 그 뒤 업무 요청은 앱 direct socket으로 core를 지나지 않고 보낸다
// (apps/runtime#R10). 연결을 열지 못해 요청이 나가지 않은 것(unavailable)과 보낸 뒤 응답을
// 잃은 것(결과 불명)을 구별하고 자동으로 다시 부르지 않는다. transport(socket 위치·권한)는
// 호출 조립이 끼운다: 이 파일은 socket을 열지 않는다.
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import {
  appConnect,
  type CommandInvokeOutput,
  commandInvokeOutputSchema,
  DIRECT_SOCKET_PATHS,
} from "../../protocol/apps/mod.ts";
import {
  errorBodySchema,
  errorCodeForStatus,
} from "../../protocol/base/mod.ts";
import type { FlowClient } from "./document-save.ts";

export const APP_ENVIRONMENTS = ["preview", "live"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export type AppInvokeRequest = {
  app: string;
  environment: AppEnvironment;
  command: string;
  input?: unknown;
  // 같은 호출의 식별이다. 다시 부를 때는 같은 값을 쓴다.
  request_key: string;
  // preview는 살아 있는 preview 프로세스의 nonce가 필요하다.
  preview_nonce?: string;
};

// 결과 불명은 오류가 아니다: 앱이 처리했는지 모른다는 사실이다.
export type AppInvokeOutcome =
  | { kind: "result"; output: CommandInvokeOutput }
  | { kind: "unknown"; request_key: string };

export type AppDirect = {
  invoke(
    request: AppInvokeRequest,
  ): Promise<Result<AppInvokeOutcome, LophnError>>;
};

export type DirectRequest = {
  method: "POST";
  path: string;
  authorization: string;
  body: unknown;
};

// 요청을 보내지 못했다면 이름이 NotSent인 Error를 던진다. 그 밖의 던짐·응답 유실은 보낸
// 뒤라 결과 불명이다.
export type AppDirectTransport = (
  endpoint: string,
  request: DirectRequest,
) => Promise<{ status: number; body: unknown }>;

export const NOT_SENT = "NotSent";

// 요청이 나가지 않았음을 알리는 오류다. transport 구현이 쓴다.
export class NotSent extends Error {
  constructor() {
    super("앱 socket을 열지 못했다");
    this.name = NOT_SENT;
  }
}

// 화면 key는 사람(user) 연결만 쓴다. coding agent connect는 무시하지만 입력은 비지 않아야 한다.
const PLACEHOLDER_SCREEN = "main";

export function createAppDirect(deps: {
  // `apps/connect`를 core에 보내는 흐름 client다.
  client: Pick<FlowClient, "read">;
  transport: AppDirectTransport;
}): AppDirect {
  return {
    async invoke(request) {
      const connected = await deps.client.read(appConnect, {
        app: request.app,
        mode: request.environment,
        screens: [PLACEHOLDER_SCREEN],
        screen_sizes: {},
        commands: [request.command],
        ...(request.preview_nonce === undefined
          ? {}
          : { preview_nonce: request.preview_nonce }),
      });
      if (!connected.ok) return connected;
      const grant = connected.value as {
        endpoint: string;
        connection: { release: string | null };
        signature: string;
      };
      const authorization = JSON.stringify({
        payload: grant.connection,
        signature: grant.signature,
      });
      const body = {
        request_key: request.request_key,
        ...(grant.connection.release === null
          ? {}
          : { release: grant.connection.release }),
        command: request.command,
        ...(request.input === undefined ? {} : { input: request.input }),
      };
      let response: { status: number; body: unknown };
      try {
        response = await deps.transport(grant.endpoint, {
          method: "POST",
          path: DIRECT_SOCKET_PATHS.invoke,
          authorization,
          body,
        });
      } catch (caught) {
        if (caught instanceof Error && caught.name === NOT_SENT) {
          return err({
            code: "unavailable",
            message: "앱에 닿지 못했다. 요청은 나가지 않았다",
          });
        }
        // 보낸 뒤 끊겼다. 앱이 이미 처리했을 수 있어 자동으로 다시 부르지 않는다.
        return ok({ kind: "unknown", request_key: request.request_key });
      }
      if (response.status !== 200) {
        const failed = errorBodySchema.safeParse(response.body);
        if (failed.success) return err(failed.data.error);
        return err({
          code: errorCodeForStatus(response.status) ?? "unavailable",
          message: "앱 요청이 실패했다",
        });
      }
      const parsed = commandInvokeOutputSchema.safeParse(response.body);
      // 응답은 왔지만 읽을 수 없다. 처리 여부를 모른다.
      if (!parsed.success) {
        return ok({ kind: "unknown", request_key: request.request_key });
      }
      return ok({ kind: "result", output: parsed.data });
    },
  };
}
