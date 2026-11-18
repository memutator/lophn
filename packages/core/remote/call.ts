// 기기 연결의 자격과 `call`. 기기는 actor user, principal `device:<id>`이고 scope는 REMOTE_ALLOWED_ROUTES와 REMOTE_PERSON_ROUTES의
// 합이다. 사람 route는 `call`이 터미널 입력을 허락받은 기기에만 연다. `call`은 HTTP API와 같은 dispatchHttp를 그 자격으로 탄다.
// frame은 JSON뿐이라 file·upload route의 bytes는 base64로 싣는다.
import { err, type ErrorCode, ok, type Result } from "../../base/mod.ts";
import {
  CONFIRMATION_HANDLE_TTL_MS,
  type ConfirmationHandleRegister,
  type ConfirmationRef,
  type Route,
  RPC_JSON_MAX_BYTES,
  UPLOAD_INPUT_HEADER,
} from "../../protocol/base/mod.ts";
import { jobUpdate } from "../../protocol/jobs/mod.ts";
import {
  REMOTE_ALLOWED_ROUTES,
  REMOTE_PERSON_ROUTES,
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
].map((route) => route.name);
const PERSON_OPERATIONS = new Set<string>(
  REMOTE_PERSON_ROUTES.map((route) => route.name),
);

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
  call: { resource: string; method: string; body: unknown },
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
  // 사람 결정 handle을 발급한다(control의 shell 등록과 같은 core 확인 registry).
  confirm(
    request: ConfirmationHandleRegister,
  ): Promise<Result<ConfirmationRef>>;
};

// HTTP API의 gate 대신 여기서 자격을 다시 보고 scope로 거른다. dispatchHttp는 command만 ledger에서 scope를 보고
// read·memory route는 actor만 본다. 그래서 route 목록 밖은 여기서 `forbidden`이다. 사람 route와 확인이 필요한 command는
// 터미널 입력을 허락받은 기기만 부른다. upload의 body는 이 검사 뒤에야 읽는다.
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
      !(
        current.value.principal.startsWith("device:") &&
        deps.granted(current.value.principal)
      )
    ) {
      return err({
        code: "forbidden",
        message: "this device has no terminal input grant for this route",
      });
    }
    let body = call.body;
    if (confirming) {
      const confirmed = await confirmFor(
        deps,
        current.value.principal,
        entry.route,
        call.body,
      );
      if (!confirmed.ok) return confirmed;
      body = confirmed.value;
    }
    const arrival = deps.admission.enterHttp(current.value.principal);
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
        current.value,
        dispatch,
      );
      if ("stream" in result) return await fileAnswer(result);
      if (!("json" in result)) {
        return ok({
          content_type: result.contentType,
          base64: Buffer.from(result.bytes).toString("base64"),
        });
      }
      if (result.status === 200) return ok(result.json);
      const { error } = result.json as {
        error: { code: ErrorCode; message: string };
      };
      return err({ code: error.code, message: error.message });
    } finally {
      arrival.value.release();
    }
  };
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
