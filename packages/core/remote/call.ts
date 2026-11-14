// 기기 연결의 자격과 `call`. 기기는 actor user, principal `device:<id>`이고 scope는 REMOTE_ALLOWED_ROUTES뿐이다.
// `call`은 HTTP API와 같은 dispatchHttp를 그 자격으로 탄다.
import { err, type ErrorCode, ok, type Result } from "../../base/mod.ts";
import { RPC_JSON_MAX_BYTES } from "../../protocol/base/mod.ts";
import { REMOTE_ALLOWED_ROUTES } from "../../protocol/remote/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import { authorize, type CredentialRegistry } from "../server/identity/mod.ts";
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
        scope: {
          operations: REMOTE_ALLOWED_ROUTES.map((route) => route.name),
          targets: {},
        },
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

export type RemoteCall = (
  credential: DeviceCredential,
  call: { resource: string; method: string; body: unknown },
) => Promise<Result<unknown>>;

type RemoteCallDeps = Pick<
  DispatchDeps,
  "clock" | "writer" | "reads" | "memory" | "onThrown"
> & {
  registry: CredentialRegistry;
  routes: RouteRegistry;
  // remote 연결만의 입장 한도. principal(`device:<id>`)마다 따로 선다.
  admission: Admission;
};

// HTTP API의 gate 대신 여기서 자격을 다시 보고 scope로 거른다. dispatchHttp는 command만 ledger에서 scope를 보고
// read·memory route는 actor만 본다. 그래서 route 목록 밖은 여기서 `forbidden`이다.
export function createRemoteCall(deps: RemoteCallDeps): RemoteCall {
  const dispatch: DispatchDeps = {
    credentials: deps.registry,
    clock: deps.clock,
    writer: deps.writer,
    reads: deps.reads,
    memory: deps.memory,
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
  };
  return async (credential, call) => {
    const path = `/${call.resource}/${call.method}`;
    const entry = deps.routes.lookup(path);
    if (!entry) return err({ code: "not_found", message: "route not found" });
    const current = deps.registry.revalidate(credential.context);
    if (!current.ok) return current;
    const allowed = authorize(current.value, entry.route.name);
    if (!allowed.ok) return allowed;
    const arrival = deps.admission.enterHttp(current.value.principal);
    if (!arrival.ok) return arrival;
    try {
      const request = new Request(`http://remote${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${credential.token}`,
        },
        body: JSON.stringify(call.body ?? {}),
      });
      const result = await dispatchHttp(
        request,
        entry,
        current.value,
        dispatch,
      );
      if (!("json" in result)) {
        // file·upload route는 목록에 없다. 바이트 응답은 frame으로 싣지 않는다.
        return err({ code: "invalid_input", message: "route is not JSON" });
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
