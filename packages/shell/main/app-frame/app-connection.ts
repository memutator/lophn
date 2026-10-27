// main의 앱 view 묶기. view가 보는 앱 process(release·bundle·process nonce)를 core 읽기로 알아
// 두고, 이후 호출과 화면 byte는 core가 그 대상으로 전달한다. 앱·release·mode는 main이 정한 값만
// 쓴다. 페이지는 자기가 어느 앱인지 모른다.
// 바깥 host는 active net.fetch grant 가운데 지금 release가 선언한 것에서 읽는다.
import type { FetchHost } from "./network-policy.ts";

// shell은 packages/base를 import하지 않는다. core 통로 결과 모양만 맞춘다.
export type CallResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };

/** main 안 통로. renderer allowlist를 거치지 않는 core 호출이다. */
export type CoreCaller = (
  kind: string,
  resource: string,
  method: string,
  body: unknown,
) => Promise<CallResult>;

type AppFrameErrorCode =
  | "invalid_input"
  | "forbidden"
  | "conflict"
  | "unavailable";

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: AppFrameErrorCode; message: string } };

export function failure(
  code: AppFrameErrorCode,
  message: string,
): Outcome<never> {
  return { ok: false, error: { code, message } };
}

export type ViewMode = "live" | "preview";
export type ScreenSize = "full" | "panel" | "card";

/** view가 묶일 대상. live는 release가 있다. preview의 release는 없어도 된다. */
export interface ConnectTarget {
  app: string;
  mode: ViewMode;
  release: string | null;
  screen: string;
  size: ScreenSize;
}

/** view에 묶인 앱 process. 같은 값이면 같은 process의 같은 bundle이다. */
export interface AppBinding {
  release: string | null;
  bundleHash: string;
  processNonce: string;
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const SHA256 = /^[0-9a-f]{64}$/;

// core 오류를 화면 틀 오류로 좁힌다. 범위 밖 앱은 core가 없는 앱과 같게 답하고, 여기서도
// 앱 중지와 같은 unavailable로 둔다.
function mapped(error: { code: string; message: string }): Outcome<never> {
  switch (error.code) {
    case "invalid_input":
    case "forbidden":
    case "conflict":
      return failure(error.code, error.message);
    default:
      return failure("unavailable", "app is not available");
  }
}

interface Process {
  nonce: string;
  release: string | null;
  bundleHash: string;
}

// preview 프로세스. 관측이 bundle hash까지 싣는다.
async function currentPreview(
  call: CoreCaller,
  app: string,
): Promise<Outcome<Process>> {
  const reply = await call("read", "previews", "get", { app });
  if (!reply.ok) return mapped(reply.error);
  const observation = record(record(reply.value)?.observation);
  const nonce = text(observation?.process_nonce);
  const bundleHash = text(observation?.bundle_hash);
  if (
    observation === undefined ||
    nonce === undefined ||
    bundleHash === undefined ||
    observation.ready !== true
  ) {
    return failure("unavailable", "preview is not running");
  }
  return {
    ok: true,
    value: {
      nonce,
      bundleHash,
      release: text(observation.release) ?? null,
    },
  };
}

// live 프로세스. 관측은 release와 process nonce를 싣고, bundle hash는 release가 정한다.
async function currentLive(
  call: CoreCaller,
  app: string,
): Promise<Outcome<Process & { release: string }>> {
  const reply = await call("read", "apps", "runtime", { app });
  if (!reply.ok) return mapped(reply.error);
  const observation = record(record(reply.value)?.observation);
  const nonce = text(observation?.process_nonce);
  const release = text(observation?.release);
  if (
    observation === undefined ||
    observation.mode !== "live" ||
    observation.ready !== true ||
    nonce === undefined ||
    release === undefined
  ) {
    return failure("unavailable", "app is not running");
  }
  const found = await call("read", "releases", "get_record", { release });
  if (!found.ok) return mapped(found.error);
  const bundleHash = text(record(record(found.value)?.release)?.bundle_hash);
  if (bundleHash === undefined || !SHA256.test(bundleHash)) {
    return failure("unavailable", "app is not available");
  }
  return { ok: true, value: { nonce, release, bundleHash } };
}

function fetchScope(grant: Json | undefined): FetchHost | undefined {
  if (grant?.status !== "active") return;
  const scope = record(grant.scope);
  if (scope?.kind !== "net.fetch") return;
  const host = text(scope.host);
  const port = scope.port;
  if (
    host === undefined ||
    typeof port !== "number" ||
    !Number.isInteger(port)
  ) {
    return;
  }
  return { host: host.toLowerCase(), port };
}

function key(host: FetchHost): string {
  return `${host.host} ${host.port}`;
}

// grant 목록을 끝까지 읽는다. 상한을 넘는 page 수는 grant 상한(앱당 몇 개)으로 막힌다.
const GRANT_PAGE_LIMIT = 200;
const GRANT_PAGES_MAX = 20;

export function createAppConnector(call: CoreCaller) {
  // release가 선언한 net.fetch host. 읽지 못하면 undefined다.
  async function declaredHosts(
    app: string,
    release: string,
  ): Promise<Set<string> | undefined> {
    const reply = await call("read", "apps", "tools", { app, release });
    if (!reply.ok) return undefined;
    const value = record(reply.value);
    const permissions = record(value?.facts)?.permissions;
    if (value?.release !== release || !Array.isArray(permissions)) {
      return undefined;
    }
    const declared = new Set<string>();
    for (const item of permissions) {
      const requirement = record(item);
      const scope = record(requirement?.scope);
      if (
        requirement?.kind === "net.fetch" &&
        typeof scope?.host === "string" &&
        typeof scope.port === "number"
      ) {
        declared.add(key({ host: scope.host.toLowerCase(), port: scope.port }));
      }
    }
    return declared;
  }

  return {
    /**
     * view 하나가 볼 앱 process를 알아낸다. live에서 `followRelease`면 지금 채택된 release를
     * 받아들인다(갱신). 아니면 다른 release는 conflict다. preview는 지금 preview process다.
     */
    async connect(
      target: ConnectTarget,
      followRelease = false,
    ): Promise<Outcome<AppBinding>> {
      if (target.mode === "preview") {
        const found = await currentPreview(call, target.app);
        if (!found.ok) return found;
        if (
          !followRelease &&
          target.release !== null &&
          found.value.release !== target.release
        ) {
          return failure("conflict", "the preview runs another release");
        }
        return {
          ok: true,
          value: {
            release: found.value.release,
            bundleHash: found.value.bundleHash,
            processNonce: found.value.nonce,
          },
        };
      }
      const found = await currentLive(call, target.app);
      if (!found.ok) return found;
      if (!followRelease && found.value.release !== target.release) {
        return failure("conflict", "the app now runs another release");
      }
      return {
        ok: true,
        value: {
          release: found.value.release,
          bundleHash: found.value.bundleHash,
          processNonce: found.value.nonce,
        },
      };
    },

    /**
     * 이 앱의 바깥 fetch host. active net.fetch grant이고, 지금 release의 선언을 알면
     * 선언과 같은 scope만 남긴다. 읽지 못하면 아무 host도 열지 않는다(unavailable).
     */
    async hosts(
      app: string,
      release: string | null,
    ): Promise<Outcome<FetchHost[]>> {
      const granted = new Map<string, FetchHost>();
      let cursor: string | undefined;
      for (let page = 0; page < GRANT_PAGES_MAX; page++) {
        const reply = await call("read", "app_grants", "list", {
          app,
          status: "active",
          limit: GRANT_PAGE_LIMIT,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!reply.ok) return failure("unavailable", "grants are unavailable");
        const value = record(reply.value);
        const grants = Array.isArray(value?.grants) ? value.grants : [];
        for (const grant of grants) {
          const host = fetchScope(record(grant));
          if (host !== undefined) granted.set(key(host), host);
        }
        cursor = text(value?.next_cursor);
        if (cursor === undefined) {
          const hosts = [...granted.values()];
          if (hosts.length === 0 || release === null) {
            return { ok: true, value: hosts };
          }
          const declared = await declaredHosts(app, release);
          return declared === undefined
            ? { ok: true, value: [] }
            : {
                ok: true,
                value: hosts.filter((host) => declared.has(key(host))),
              };
        }
      }
      return failure("unavailable", "grants are unavailable");
    },
  };
}

export type AppConnector = ReturnType<typeof createAppConnector>;
