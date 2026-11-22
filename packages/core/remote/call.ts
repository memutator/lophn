// 기기 연결의 자격과 `call`. 기기는 actor user, principal `device:<id>`이고 scope는 REMOTE_ALLOWED_ROUTES와 REMOTE_PERSON_ROUTES의
// 합이다. `call`은 HTTP API와 같은 dispatchHttp를 그 자격으로 탄다. frame은 JSON뿐이라 file·upload route의 bytes는 base64로 싣는다.
// 무엇을 여는지는 요청한 쪽(frame의 `by`)이 정한다. 폰은 `by`가 없고 컴퓨터는 있다(폰이 `by`를 싣고 부르면 `invalid_input`이다. 컴퓨터가
// `by` 없이 부르면 그 컴퓨터의 core가 스스로 하는 일이라 REMOTE_CORE_ROUTES와 REMOTE_COMPUTER_CORE_ROUTES만 열고 그 밖은 `invalid_input`이다.
// REMOTE_COMPUTER_CORE_ROUTES는 그 길(컴퓨터, `by` 없음)만 받고 폰과 요청한 쪽이 있는 call은 `forbidden`이다). 사람 route와 확인이 필요한 command는 `by`가 없는 폰이나 `screen`이고 터미널 입력을 허락받은 기기에만 연다.
// `terminal`은 사람의 route와 REMOTE_TERMINAL_DENIED를 못 받고(그 터미널에서 치는 coding agent도 같은 token이다), `agent`와 `app`은
// REMOTE_AGENT_ROUTES만 받는다. 그 가운데 앱 목록·읽기는 private인 앱을 빼고 준다.
// `by`는 부른 컴퓨터가 자기 자격에서 정한 값이라 이 기계는 그 종류만 믿고 `agent`의 name 같은 글로는 아무것도 정하지 않는다.
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import {
  CONFIRMATION_HANDLE_TTL_MS,
  type ConfirmationHandleRegister,
  type ConfirmationRef,
  type Route,
  RPC_JSON_MAX_BYTES,
  UPLOAD_INPUT_HEADER,
} from "../../protocol/base/mod.ts";
import { appGet, appList, appRemoteCall } from "../../protocol/apps/mod.ts";
import { appTools } from "../../protocol/apps/declaration/read.ts";
import { jobUpdate } from "../../protocol/jobs/mod.ts";
import { a2aMail } from "../../protocol/lophn-agent/mail.ts";
import type { Requester } from "../../protocol/machine/requester.ts";
import {
  REMOTE_AGENT_ROUTES,
  REMOTE_ALLOWED_ROUTES,
  REMOTE_COMPUTER_CORE_ROUTES,
  REMOTE_CORE_ROUTES,
  REMOTE_PERSON_ROUTES,
  REMOTE_TERMINAL_DENIED,
} from "../../protocol/remote/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import {
  authorize,
  confirmationBinding,
  type CredentialRegistry,
} from "../server/identity/mod.ts";
import {
  BODY_TIMEOUT_MS,
  type DispatchDeps,
  dispatchHttp,
  type RouteRegistry,
} from "../server/mod.ts";
import type { Admission } from "../supervision/responsiveness/mod.ts";

export type DeviceCredential = { context: AuthenticatedContext; token: string };

export type DeviceCredentials = {
  get(device: string): Promise<Result<DeviceCredential>>;
  // 끊은 기기의 자격을 거둔다. 진행 중인 연결의 다음 call부터 unauthorized다.
  revoke(device: string): void;
};

export function devicePrincipal(device: string): string {
  return `device:${device}`;
}

// writer가 command scope를 ledger의 자격 기록으로 보므로 사람 route도 자격에 있어야 한다. 거르기는 createRemoteCall이 한다.
const DEVICE_OPERATIONS = [
  ...REMOTE_ALLOWED_ROUTES,
  ...REMOTE_PERSON_ROUTES,
  ...REMOTE_COMPUTER_CORE_ROUTES,
].map((route) => route.name);
const PERSON_OPERATIONS = new Set<string>(
  REMOTE_PERSON_ROUTES.map((route) => route.name),
);
const AGENT_OPERATIONS = new Set<string>(
  REMOTE_AGENT_ROUTES.map((route) => route.name),
);
const CORE_OPERATIONS = new Set<string>(
  REMOTE_CORE_ROUTES.map((route) => route.name),
);
const COMPUTER_CORE_OPERATIONS = new Set<string>(
  REMOTE_COMPUTER_CORE_ROUTES.map((route) => route.name),
);
const TERMINAL_DENIED = new Set<string>(
  REMOTE_TERMINAL_DENIED.map((route) => route.name),
);

// 받은 call의 요청한 쪽은 입력 body가 아니라 이 자격 옆에 실어 handler에 준다(body의 `by`는 route schema가 거절한다).
// symbol 칸이라 body나 JSON으로는 만들어지지 않고, 이 file의 `call`만 싣는다.
const REQUESTER = Symbol("requester");
export function requesterOf(ctx: AuthenticatedContext): Requester | undefined {
  return (ctx as { [REQUESTER]?: Requester })[REQUESTER];
}

// 기기마다 core 한 번 사는 동안 자격 하나를 쓴다. 다시 붙을 때마다 ledger에 credential 행을 쌓지 않으려는 것이다.
export function createDeviceCredentials(deps: {
  registry: CredentialRegistry;
  // writer·reader가 이 자격의 command·read를 받으려면 ledger에 기록이 있어야 한다.
  record(context: AuthenticatedContext): Promise<Result<void>>;
}): DeviceCredentials {
  const issued = new Map<string, DeviceCredential>();
  return {
    async get(device) {
      const cached = issued.get(device);
      if (cached && deps.registry.revalidate(cached.context).ok) {
        return ok(cached);
      }
      const made = deps.registry.issue({
        actor: "user",
        principal: devicePrincipal(device),
        scope: { operations: DEVICE_OPERATIONS, targets: {} },
        conditions: { process: "remote" },
      });
      if (!made.ok) return made;
      const current = deps.registry.revalidate({
        credential_ref: made.value.credential_ref,
      });
      if (!current.ok) return current;
      const recorded = await deps.record(current.value);
      if (!recorded.ok) return recorded;
      const credential = { context: current.value, token: made.value.token };
      issued.set(device, credential);
      return ok(credential);
    },
    revoke(device) {
      const credential = issued.get(device);
      if (!credential) return;
      issued.delete(device);
      deps.registry.revoke(credential.context.credential_ref);
    },
  };
}

// file route가 기기에 내주는 한 file의 상한이다. base64로 4/3배가 되어도 frame 하나(REMOTE_FRAME_MAX_BYTES, 16 MiB)에 든다.
export const REMOTE_FILE_MAX_BYTES = 8 * 1024 * 1024;

export type RemoteCall = (
  credential: DeviceCredential,
  call: {
    resource: string;
    method: string;
    body: unknown;
    // frame의 `by`. 컴퓨터가 부른 call에만 있다.
    by?: Requester;
  },
) => Promise<Result<unknown>>;

type RemoteCallDeps = Pick<
  DispatchDeps,
  | "clock"
  | "writer"
  | "reads"
  | "memory"
  | "fileStreams"
  | "uploads"
  | "onThrown"
  | "bus"
> & {
  registry: CredentialRegistry;
  routes: RouteRegistry;
  // remote 연결만의 입장 한도. principal(`device:<id>`)마다 따로 선다.
  admission: Admission;
  // 사람이 이 기기의 터미널 입력을 허락했는지. call마다 읽어 허락을 바꾸면 다음 call부터 따른다.
  granted(principal: string): boolean;
  // 이 기계의 명단이 아는 기기의 종류. 명단에 없으면 null이다. `by`는 이 값으로 맞춰 본다.
  kind(principal: string): "phone" | "computer" | null;
  // 이 기계의 call 정책에서 그 앱의 workspace가 private인가. private인 앱은 agent와 앱의 요청에 보이지 않는다.
  privateApp(app: string): boolean;
  // 사람 결정 handle을 발급한다(control의 shell 등록과 같은 core 확인 registry).
  confirm(
    request: ConfirmationHandleRegister,
  ): Promise<Result<ConfirmationRef>>;
};

// HTTP API의 gate 대신 여기서 자격을 다시 보고 scope로 거른다. dispatchHttp는 command만 ledger에서 scope를 보고
// read·memory route는 actor만 본다. 그래서 route 목록 밖은 여기서 `forbidden`이다. 사람 route와 확인이 필요한 command는
// 요청한 쪽이 `by` 없는 폰이나 `screen`이고 터미널 입력을 허락받은 기기만 부른다. 앱 command 입구(`apps/remote_call`)는
// 허락받은 컴퓨터만 부른다. upload의 body는 이 검사 뒤에야 읽는다.
export function createRemoteCall(deps: RemoteCallDeps): RemoteCall {
  const dispatch: DispatchDeps = {
    credentials: deps.registry,
    clock: deps.clock,
    writer: deps.writer,
    reads: deps.reads,
    memory: deps.memory,
    fileStreams: deps.fileStreams,
    uploads: deps.uploads,
    bodyTimeoutMs: BODY_TIMEOUT_MS,
    jsonMaxBytes: RPC_JSON_MAX_BYTES,
    admitCommand: async (ctx, _name, work) => {
      const admitted = await deps.admission.admit(ctx.principal, () =>
        Promise.resolve(),
      );
      return admitted
        ? await work()
        : {
            status: 503,
            json: {
              error: {
                code: "unavailable",
                message: "admission 한도를 넘었다",
              },
            },
          };
    },
    onThrown: deps.onThrown,
    // 폰에서 한 일(memory·upload route)도 desktop 화면이 StateChanged로 다시 읽게 한다. HTTP API와 같다.
    bus: deps.bus,
  };
  return async (credential, call) => {
    const path = `/${call.resource}/${call.method}`;
    const entry = deps.routes.lookup(path);
    if (!entry) return err({ code: "not_found", message: "route not found" });
    const current = deps.registry.revalidate(credential.context);
    if (!current.ok) return current;
    const allowed = authorize(current.value, entry.route.name);
    if (!allowed.ok) return allowed;
    const { principal } = current.value;
    const kind = deps.kind(principal);
    const by = call.by;
    // 명단의 컴퓨터의 core 자신만 부르는 route(login 값이 실린다)는 폰과 요청한 쪽이 있는 call을 받지 않는다.
    const computerCore = COMPUTER_CORE_OPERATIONS.has(entry.route.name);
    if (computerCore && !(kind === "computer" && by === undefined)) {
      return err({
        code: "forbidden",
        message: "only the lophn of a paired computer reaches this",
      });
    }
    // `by` 없는 컴퓨터는 core가 스스로 하는 일(`carry/*`, `browser_vault/exchange`)만 한다.
    const coreOwn =
      kind === "computer" &&
      by === undefined &&
      (CORE_OPERATIONS.has(entry.route.name) || computerCore);
    if (!coreOwn && (kind === "computer") === (by === undefined)) {
      return err({
        code: "invalid_input",
        message:
          kind === "computer"
            ? "a call from a computer carries the requester"
            : "only a computer carries a requester",
      });
    }
    const granted =
      current.value.actor === "user" &&
      principal.startsWith("device:") &&
      deps.granted(principal);
    // `by`가 있으면 위에서 컴퓨터로 맞춰졌다. 폰은 이 입구를 못 쓴다.
    if (entry.route.name === appRemoteCall.name && !(granted && by)) {
      return err({
        code: "forbidden",
        message:
          "only a computer with a terminal input grant calls an app command",
      });
    }
    if (
      (by?.kind === "agent" || by?.kind === "app") &&
      !AGENT_OPERATIONS.has(entry.route.name)
    ) {
      return err({
        code: "forbidden",
        message: "an agent or an app on another computer does not reach this",
      });
    }
    if (by !== undefined && by.kind !== "screen") {
      if (TERMINAL_DENIED.has(entry.route.name)) {
        return err({
          code: "forbidden",
          message: "a request typed in a shell does not reach this",
        });
      }
    }
    const hidesPrivate = by?.kind === "agent" || by?.kind === "app";
    const askedApp = (call.body as { app?: unknown } | null)?.app;
    if (
      hidesPrivate &&
      (entry.route.name === appGet.name ||
        entry.route.name === appTools.name) &&
      typeof askedApp === "string" &&
      deps.privateApp(askedApp)
    ) {
      return err({ code: "not_found", message: "app not found" });
    }
    if (entry.route.name === jobUpdate.name && !onlyToggles(call.body)) {
      return err({
        code: "forbidden",
        message: "a device may only turn a job on or off",
      });
    }
    const confirming =
      entry.route.kind === "command" && entry.route.confirmation === "required";
    if (
      (PERSON_OPERATIONS.has(entry.route.name) || confirming) &&
      !(granted && (by === undefined || by.kind === "screen"))
    ) {
      return err({
        code: "forbidden",
        message: "this call has no terminal input grant for this route",
      });
    }
    let body = call.body;
    if (confirming) {
      const confirmed = await confirmFor(
        deps,
        principal,
        entry.route,
        call.body,
      );
      if (!confirmed.ok) return confirmed;
      body = confirmed.value;
    }
    const arrival = deps.admission.enterHttp(principal);
    if (!arrival.ok) return arrival;
    try {
      const request =
        entry.route.kind === "upload"
          ? uploadRequest(path, credential.token, body)
          : new Request(`http://remote${path}`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${credential.token}`,
              },
              body: JSON.stringify(body ?? {}),
            });
      if (!request) {
        return err({
          code: "invalid_input",
          message: "upload body is {input, base64}",
        });
      }
      const result = await dispatchHttp(
        request,
        entry,
        (entry.route.name === appRemoteCall.name ||
          entry.route.name === a2aMail.name) &&
          by
          ? Object.assign({}, current.value, { [REQUESTER]: by })
          : current.value,
        dispatch,
      );
      if ("stream" in result) return await fileAnswer(result);
      if (!("json" in result)) {
        return ok({
          content_type: result.contentType,
          base64: Buffer.from(result.bytes).toString("base64"),
        });
      }
      if (result.status === 200) {
        return ok(
          hidesPrivate && entry.route.name === appList.name
            ? withoutPrivateApps(result.json, deps.privateApp)
            : result.json,
        );
      }
      // details도 싣는다: 폰과 다른 기계의 창도 desktop처럼 `details.reason`(예: `changed_elsewhere`)으로 안내한다.
      const { error } = result.json as { error: LophnError };
      return err({
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
    } finally {
      arrival.value.release();
    }
  };
}

function withoutPrivateApps(
  json: unknown,
  privateApp: (app: string) => boolean,
): unknown {
  const listed = json as { apps: { id: string }[] };
  return { ...listed, apps: listed.apps.filter((app) => !privateApp(app.id)) };
}

// 허락받은 기기의 확인이 필요한 command는 사람이 확인한 것으로 본다. 기기가 보낸 `confirmation`은 버리고 core가 대상과 내용에 묶은
// handle을 그 자리에서 받아 싣는다. 화면이 보내기 전에 사람에게 묻는다.
async function confirmFor(
  deps: Pick<RemoteCallDeps, "clock" | "confirm">,
  principal: string,
  route: Route,
  body: unknown,
): Promise<Result<unknown>> {
  const record = (body ?? {}) as Record<string, unknown>;
  const binding = await confirmationBinding(route, record.input);
  if (binding === undefined) {
    return err({ code: "invalid_input", message: "invalid command body" });
  }
  const handle = await deps.confirm({
    type: "confirmation_handle_register",
    window_id: principal,
    target_ref: binding.target,
    content_hash: binding.content,
    allowed_decisions: [route.name],
    expires_at: new Date(
      deps.clock.nowMs() + CONFIRMATION_HANDLE_TTL_MS,
    ).toISOString(),
  });
  if (!handle.ok) return handle;
  return ok({ ...record, confirmation: handle.value });
}

// 폰은 job을 켜고 끄기만 한다. 이름·때·놓친 차례를 바꾸는 것은 job 고치기라 기기 자격에 없다.
function onlyToggles(body: unknown): boolean {
  const input = (body as { input?: unknown } | null)?.input;
  if (typeof input !== "object" || input === null) return true;
  return Object.keys(input).every((key) => key === "job" || key === "enabled");
}

// upload route: body `{input, base64}`를 HTTP upload 요청(input은 header, bytes는 body)으로 바꾼다. 한도는 dispatch가 route의
// max_bytes로 본다.
function uploadRequest(
  path: string,
  token: string,
  body: unknown,
): Request | undefined {
  const { input, base64 } = (body ?? {}) as {
    input?: unknown;
    base64?: unknown;
  };
  if (typeof base64 !== "string") return undefined;
  const bytes = Buffer.from(base64, "base64");
  return new Request(`http://remote${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
      authorization: `Bearer ${token}`,
      [UPLOAD_INPUT_HEADER]: Buffer.from(JSON.stringify(input ?? {})).toString(
        "base64url",
      ),
    },
    body: bytes,
  });
}

// file route의 답(stream)을 `{content_type, base64}`로 모은다.
async function fileAnswer(file: {
  stream: ReadableStream<Uint8Array>;
  length: number;
  contentType: string;
}): Promise<Result<{ content_type: string; base64: string }>> {
  if (file.length > REMOTE_FILE_MAX_BYTES) {
    await file.stream.cancel().catch(() => undefined);
    return err({
      code: "invalid_input",
      message: `file exceeds the ${REMOTE_FILE_MAX_BYTES} byte limit`,
    });
  }
  const bytes = Buffer.from(await new Response(file.stream).arrayBuffer());
  return ok({
    content_type: file.contentType,
    base64: bytes.toString("base64"),
  });
}
