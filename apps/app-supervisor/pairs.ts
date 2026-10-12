// 앱 쌍 연결 준비와 confirm의 supervisor 쪽 어댑터(apps/connections#R1–R5). 서명 key는 core만 쥐므로
// 준비·proof 발급은 core의 서비스가 하고, supervisor는 앱 자식 연결의 신원(app·release·mode·nonce)을
// 붙여 machine credential로 core route를 부를 뿐이다. 본문의 신원 주장은 쓰지 않는다. 호출의 start
// 사실은 core의 경로 장부에 알리고(알리지 못해도 호출은 막지 않는다) 자식 종료는 그 자식의 기억을 비운다.
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  appConnectOutputSchema,
  brokerAppsConfirmPollOutputSchema,
  brokerAppsConfirmRequestOutputSchema,
} from "../../packages/protocol/apps/mod.ts";
import type {
  AppPairConfirmer,
  AppPairPreparer,
  BrokerChild,
  InvocationBroker,
} from "../../packages/core/apps/permissions/mod.ts";
import type { CorePost } from "./access.ts";

type Reply = { status: number; body: unknown };

function codeOf(
  reply: Reply,
):
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_input"
  | "unavailable" {
  const code = (reply.body as { error?: { code?: unknown } } | null)?.error
    ?.code;
  const known = [
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "invalid_input",
    "unavailable",
  ] as const;
  const found = known.find((entry) => entry === code);
  if (found !== undefined) return found;
  if (reply.status === 401) return "unauthorized";
  if (reply.status === 403) return "forbidden";
  if (reply.status === 404) return "not_found";
  if (reply.status === 409) return "conflict";
  if (reply.status >= 400 && reply.status < 500) return "invalid_input";
  return "unavailable";
}

function sourceOf(child: BrokerChild) {
  return {
    app: child.app,
    release: child.release,
    mode: child.mode,
    process_nonce: child.processNonce,
  };
}

export function createCorePairs(deps: {
  post: CorePost;
  // supervisor의 machine credential. hello 뒤에 채워지므로 호출 때 읽는다.
  bearer: () => string;
}): { preparer: AppPairPreparer; confirmer: AppPairConfirmer } {
  async function call<T>(
    path: string,
    body: unknown,
    schema: {
      safeParse(
        value: unknown,
      ): { success: true; data: T } | { success: false };
    },
  ): Promise<Result<T>> {
    const bearer = deps.bearer();
    if (bearer === "") {
      return err({ code: "unavailable", message: "core is not connected" });
    }
    let reply: Reply;
    try {
      reply = await deps.post(path, bearer, body);
    } catch {
      return err({ code: "unavailable", message: "core is unreachable" });
    }
    if (reply.status !== 200) {
      const error = (reply.body as {
        error?: { message?: unknown; details?: unknown };
      } | null)?.error;
      return err({
        code: codeOf(reply),
        message: typeof error?.message === "string"
          ? error.message
          : "core refused the request",
        ...(typeof error?.details === "object" && error.details !== null
          ? { details: error.details as Record<string, unknown> }
          : {}),
      });
    }
    const parsed = schema.safeParse(reply.body);
    return parsed.success
      ? ok(parsed.data)
      : err({ code: "unavailable", message: "core answered badly" });
  }

  return {
    preparer: {
      prepare: (request) =>
        call("apps/pair_prepare", {
          source: sourceOf(request.source),
          app: request.app,
          commands: [...request.commands],
          parent_invocation: request.parent_invocation,
          ...(request.incoming === undefined
            ? {}
            : { incoming: request.incoming }),
        }, appConnectOutputSchema),
    },
    confirmer: {
      request: (request) =>
        call("apps/pair_confirm_request", {
          source: sourceOf(request.source),
          app: request.app,
          command: request.command,
          ...(request.input === undefined ? {} : { input: request.input }),
          target_release: request.target_release,
          target_process_nonce: request.target_process_nonce,
          parent_invocation: request.parent_invocation,
        }, brokerAppsConfirmRequestOutputSchema),
      poll: (request) =>
        call("apps/pair_confirm_poll", {
          source: sourceOf(request.source),
          approval: request.approval,
          wait_ms: request.wait_ms,
        }, brokerAppsConfirmPollOutputSchema),
    },
  };
}

// broker의 invocations 서비스를 감싸 호출의 start 사실을 core의 경로 장부에 알린다. 기록과 전달은 감싼
// 서비스가 그대로 하고, 알리지 못한 호출은 부모 없음으로 시작한다(전달 실패가 호출을 막지 않는다).
export function observeStartsAtCore(
  inner: Pick<InvocationBroker, "submit">,
  deps: { post: CorePost; bearer: () => string },
): Pick<InvocationBroker, "submit"> {
  return {
    submit(child, body) {
      const result = inner.submit(child, body);
      const submitted = body as {
        invocation?: unknown;
        fact?: unknown;
        summary?: { caller?: unknown } | null;
      } | null;
      const caller = submitted?.summary?.caller;
      if (
        result.ok && submitted?.fact === "start" &&
        typeof submitted.invocation === "string" &&
        caller !== null && typeof caller === "object" &&
        typeof (caller as { kind?: unknown }).kind === "string"
      ) {
        const bearer = deps.bearer();
        if (bearer !== "") {
          void deps.post("apps/pair_observe", bearer, {
            event: "start",
            process_nonce: child.processNonce,
            invocation: submitted.invocation,
            caller,
          }).catch(() => undefined);
        }
      }
      return result;
    },
  };
}

// 자식 종료를 확인했다. core의 경로 장부가 그 자식의 기억을 비운다.
export function forgetAtCore(
  deps: { post: CorePost; bearer: () => string },
  processNonce: string,
): void {
  const bearer = deps.bearer();
  if (bearer === "") return;
  void deps.post("apps/pair_observe", bearer, {
    event: "exit",
    process_nonce: processNonce,
  }).catch(() => undefined);
}
