// main의 앱 통로 client. 앱 연결은 core의 `POST /v1/apps/connect`로 얻고, 서명된
// AppConnection을 그대로 Authorization envelope로 싣는다. 앱·release·mode·bundle은 main이
// 요청하고 core가 서명한 값만 쓰며 페이지 주장은 들어올 자리가 없다.
// 바깥 host는 apps/permissions의 active net.fetch grant에서 읽는다.
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

export type AppFrameErrorCode =
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

/** 연결을 얻을 대상. live는 release가 있다. preview의 release는 없어도 된다. */
export interface ConnectTarget {
  app: string;
  mode: ViewMode;
  release: string | null;
  screen: string;
  size: ScreenSize;
}

/** view에 묶인 연결. connection은 core가 서명한 원래 객체 그대로다. */
export interface AppBinding {
  endpoint: string;
  authorization: string;
  release: string | null;
  bundleHash: string;
  processNonce: string;
  /** 연결 만료(epoch ms). 없으면 null이다. */
  expiresAtMs: number | null;
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Json
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const SHA256 = /^[0-9a-f]{64}$/;

// core 오류를 화면 틀 오류로 좁힌다. 범위 밖 앱은 core가 없는 앱과 같게 답하고, 여기서도
// 앱 중지·연결 없음과 같은 unavailable로 둔다.
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

interface PreviewProcess {
  nonce: string;
  bundleHash: string;
  release: string | null;
}

async function currentPreview(
  call: CoreCaller,
  app: string,
): Promise<Outcome<PreviewProcess>> {
  const reply = await call("read", "previews", "get", { app });
  if (!reply.ok) return mapped(reply.error);
  const observation = record(record(reply.value)?.observation);
  const nonce = text(observation?.process_nonce);
  const bundleHash = text(observation?.bundle_hash);
  if (
    observation === undefined || nonce === undefined ||
    bundleHash === undefined || observation.ready !== true
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

/**
 * core가 돌려준 연결이 요청한 대상과 같은지 본다. 다른 앱·mode·옛 release·없는 screen·size는
 * 받지 않는다. connection 객체는 서명 대상이라 고치지 않고 그대로 envelope에 싣는다.
 */
export function checkConnectOutput(
  value: unknown,
  target: ConnectTarget,
  preview: PreviewProcess | undefined,
): Outcome<AppBinding> {
  const output = record(value);
  const connection = record(output?.connection);
  const endpoint = text(output?.endpoint);
  const signature = text(output?.signature);
  if (
    output === undefined || connection === undefined ||
    endpoint === undefined || signature === undefined
  ) {
    return failure("unavailable", "connection response did not match");
  }
  const release = connection.release === null ? null : text(connection.release);
  const bundleHash = text(connection.bundle_hash);
  const processNonce = text(connection.process_nonce);
  const expires = connection.expires_at === null
    ? null
    : text(connection.expires_at);
  if (
    connection.app !== target.app || connection.mode !== target.mode ||
    release === undefined || bundleHash === undefined ||
    !SHA256.test(bundleHash) || processNonce === undefined ||
    expires === undefined
  ) {
    return failure("unavailable", "connection response did not match");
  }
  if (target.mode === "live" && release !== target.release) {
    return failure("conflict", "the app now runs another release");
  }
  if (
    preview !== undefined &&
    (bundleHash !== preview.bundleHash || processNonce !== preview.nonce)
  ) {
    return failure("conflict", "the preview changed while connecting");
  }
  const screens = Array.isArray(connection.screens) ? connection.screens : [];
  const sizes = record(connection.screen_sizes)?.[target.screen];
  if (
    !screens.includes(target.screen) || !Array.isArray(sizes) ||
    !sizes.includes(target.size)
  ) {
    return failure("forbidden", "screen size is not open to this view");
  }
  const expiresAtMs = expires === null ? null : Date.parse(expires);
  if (expiresAtMs !== null && Number.isNaN(expiresAtMs)) {
    return failure("unavailable", "connection response did not match");
  }
  return {
    ok: true,
    value: {
      endpoint,
      authorization: JSON.stringify({ payload: connection, signature }),
      release,
      bundleHash,
      processNonce,
      expiresAtMs,
    },
  };
}

function fetchScope(grant: Json | undefined): FetchHost | undefined {
  if (grant?.kind !== "net.fetch" || grant.status !== "active") return;
  const scope = record(grant.scope);
  const host = text(scope?.host);
  const port = scope?.port;
  if (
    host === undefined || typeof port !== "number" || !Number.isInteger(port)
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
  async function connectScoped(
    target: ConnectTarget,
    followRelease: boolean,
    commands: readonly string[],
  ): Promise<Outcome<{ binding: AppBinding; commands: string[] }>> {
    let preview: PreviewProcess | undefined;
    if (target.mode === "preview") {
      const found = await currentPreview(call, target.app);
      if (!found.ok) return found;
      if (
        !followRelease && target.release !== null &&
        found.value.release !== target.release
      ) {
        return failure("conflict", "the preview runs another release");
      }
      preview = found.value;
    }
    const reply = await call("memory", "apps", "connect", {
      app: target.app,
      mode: target.mode,
      screens: [target.screen],
      screen_sizes: { [target.screen]: [target.size] },
      commands: [...commands],
      ...(preview === undefined ? {} : { preview_nonce: preview.nonce }),
    });
    if (!reply.ok) return mapped(reply.error);
    const output = record(reply.value);
    const adopted = record(output?.connection)?.release;
    const expected: ConnectTarget = followRelease && target.mode === "live" &&
        typeof adopted === "string"
      ? { ...target, release: adopted }
      : target;
    const checked = checkConnectOutput(reply.value, expected, preview);
    if (!checked.ok) return checked;
    // core는 요청한 것 중 프로세스가 등록한 command만 넣는다. 요청 밖 command는 받지 않는다.
    const granted = record(output?.connection)?.commands;
    const scoped = Array.isArray(granted)
      ? granted.filter((key): key is string =>
        typeof key === "string" && commands.includes(key)
      )
      : [];
    return { ok: true, value: { binding: checked.value, commands: scoped } };
  }

  return {
    /**
     * view 하나의 연결을 얻는다. preview는 main이 지금 preview 프로세스의 nonce를 읽어 쓴다.
     * live에서 `followRelease`면 지금 채택된 release를 받아들인다(갱신). 아니면 다른
     * release는 conflict다. 화면만 여는 연결이라 command 범위는 없다.
     */
    async connect(
      target: ConnectTarget,
      followRelease = false,
    ): Promise<Outcome<AppBinding>> {
      const opened = await connectScoped(target, followRelease, []);
      return opened.ok ? { ok: true, value: opened.value.binding } : opened;
    },

    /**
     * 같은 view 대상에 command 범위를 더한 연결이다(`app:call`). release는 따라가지 않는다:
     * view에 묶인 release와 다르면 conflict다. 돌려주는 command는 core가 실제로 넣은 것이다.
     */
    connectCommands(
      target: ConnectTarget,
      commands: readonly string[],
    ): Promise<Outcome<{ binding: AppBinding; commands: string[] }>> {
      return connectScoped(target, false, commands);
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
      let declared: Set<string> | undefined;
      let cursor: string | undefined;
      for (let page = 0; page < GRANT_PAGES_MAX; page++) {
        const reply = await call("read", "grants", "list", {
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
        const display = record(value?.display);
        if (
          display !== undefined && release !== null &&
          display.release === release && Array.isArray(display.requirements)
        ) {
          declared ??= new Set();
          for (const item of display.requirements) {
            const requirement = record(item);
            const scope = record(requirement?.scope);
            if (
              requirement?.kind === "net.fetch" &&
              typeof scope?.host === "string" &&
              typeof scope.port === "number"
            ) {
              declared.add(key({
                host: scope.host.toLowerCase(),
                port: scope.port,
              }));
            }
          }
        }
        cursor = text(value?.next_cursor);
        if (cursor === undefined) {
          return {
            ok: true,
            value: [...granted.values()].filter((host) =>
              declared === undefined || declared.has(key(host))
            ),
          };
        }
      }
      return failure("unavailable", "grants are unavailable");
    },
  };
}

export type AppConnector = ReturnType<typeof createAppConnector>;
