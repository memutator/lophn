// main의 core 통로 모양과 앱 view의 값. view가 어느 앱 process에 묶이는지는 core의 view 표(`app_views/*`)가
// 정한다(binding.ts). 여기는 화면의 바깥 host만 읽는다: active net.fetch grant 가운데 지금 release가 선언한 것이다.
import type { FetchHost } from "./network-policy.ts";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

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

/** 기계 하나의 core 통로. null은 이 컴퓨터다. 앱 view가 부른 것은 그 view의 기계로만 간다. */
export type MachineCaller = (machine: string | null) => CoreCaller;

/**
 * 앱 session·call route에 싣는 앱. 다른 기계는 이 컴퓨터를 기기로 보고 그 기기가 연 view에서 앱을 정하므로 view도 싣는다
 * (core/main/daemon/wiring/app-principal.ts).
 */
export function onBehalfOf(view: {
  view_session: string;
  machine: string | null;
  target: { app: string };
}): { app: string; view?: string } {
  return view.machine === null
    ? { app: view.target.app }
    : { app: view.target.app, view: view.view_session };
}

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
export type Place = "tab" | "panel" | "card" | "sidebar" | "tray" | "phone";

/**
 * 화면이 열린 workspace. 앱 화면은 URL query로 받는다. project만 기계를 넘는 id(`identity`)와 옛 id
 * (`formerIdentities`)를 싣는다.
 */
export type PlaceWorkspace =
  | {
      kind: "project";
      id: string;
      identity: string | null;
      formerIdentities: string[];
      folders: string[];
    }
  | { kind: "home" | "app"; id: string; folders: string[] };

/** view가 묶일 대상. live는 release가 있다. preview의 release는 없어도 된다. */
export interface ConnectTarget {
  app: string;
  mode: ViewMode;
  release: string | null;
  screen: string;
  place: Place;
  /** 열 때 정한 화면 인자. 선언의 params schema를 통과한 값이다. */
  params?: Record<string, JsonValue>;
  workspace?: PlaceWorkspace;
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
        // 다른 기계가 기기에 grant 읽기를 열지 않았으면 그 거절을 그대로 화면에 낸다.
        if (!reply.ok) {
          return reply.error.code === "forbidden"
            ? failure("forbidden", reply.error.message)
            : failure("unavailable", "grants are unavailable");
        }
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
