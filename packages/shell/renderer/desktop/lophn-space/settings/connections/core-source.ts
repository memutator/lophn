// CodingConnectionsSource를 main의 통로로 만든다. 감지·연결·설치는 main IPC(`lophnCoding`)이고 연결 목록은
// core read이며 회수는 보호 창을 여는 일이다. 응답은 main의 contract client가 route output schema로 이미
// 검사했다. 아래 모양은 그 schema에서 이 화면이 읽는 field만 옮긴 것이다. 연결 생성 command와 token은 이
// 통로에 없다: 연결은 고정 intent(`CONNECT_INTENT`)만 보내고 main이 따로 검증한다.
import { type CodingApi, CONNECT_INTENT } from "../../../../../ipc/coding.ts";
import type { CoreSource } from "../../../connection/connection.ts";
import { coreAppsSource } from "../../apps/core-source.ts";
import type {
  CodingConnectionsSource,
  ConnectionRow,
  SourceResult,
} from "./source.ts";

interface ConnectionValue {
  id: string;
  label: string;
  scope: { kind: "all"; app: null } | { kind: "app"; app: string };
  state: "active" | "revoked";
  revision: string;
}

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 10;

// 보호 창의 부모. main은 이 값이 아니라 IPC를 보낸 창을 부모로 쓴다.
const PARENT_WINDOW = "requesting-window";

/** 회수 결정 창을 여는 preload 통로. 없는 창에서는 undefined다. */
export type OpenRevokeWindow = (
  intent: {
    request: {
      kind: "owner_decision";
      concern: string;
      decision: string;
      targets: string[];
    };
    parentWindow: string;
  },
) => Promise<unknown>;

export function windowRevokeOpener(): OpenRevokeWindow | undefined {
  const shell = (globalThis as {
    lophnShell?: { openConfirmation?: OpenRevokeWindow };
  }).lophnShell;
  return typeof shell?.openConfirmation === "function"
    ? (intent) => shell.openConfirmation!(intent)
    : undefined;
}

export function windowCodingApi(): CodingApi | undefined {
  const bridge = (globalThis as { lophnCoding?: CodingApi }).lophnCoding;
  return bridge !== undefined && typeof bridge.detect === "function"
    ? bridge
    : undefined;
}

export interface CodingConnectionsDeps {
  coding: CodingApi | undefined;
  openWindow: OpenRevokeWindow | undefined;
}

function rowOf(value: ConnectionValue): ConnectionRow {
  return {
    id: value.id,
    label: value.label,
    scope: value.scope.kind === "app"
      ? { kind: "app", app: value.scope.app }
      : { kind: "all" },
    state: value.state,
    revision: value.revision,
  };
}

const unavailable = { ok: false, code: "unavailable" } as const;

export function coreCodingConnectionsSource(
  core: CoreSource,
  deps: CodingConnectionsDeps,
): CodingConnectionsSource {
  const apps = coreAppsSource(core);

  function mapped<T, U>(
    reply:
      | { ok: true; value: T }
      | { ok: false; error: { code: string } },
    map: (value: T) => U,
  ): SourceResult<U> {
    return reply.ok
      ? { ok: true, value: map(reply.value) }
      : { ok: false, code: reply.error.code };
  }

  return {
    watch: (listener) => core.subscribe(listener),

    async detect() {
      if (deps.coding === undefined) return unavailable;
      return mapped(await deps.coding.detect(), (view) => view);
    },

    async refresh() {
      if (deps.coding === undefined) return unavailable;
      return mapped(await deps.coding.refresh(), (view) => view);
    },

    async connections() {
      const rows: ConnectionRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const reply = await core.call({
          kind: "read",
          resource: "coding_agent_connections",
          method: "list",
          body: cursor === undefined ? {} : { cursor },
        });
        if (!reply.ok) {
          return { ok: false, code: reply.error?.code ?? "internal" };
        }
        const value = reply.value as {
          connections: ConnectionValue[];
          next_cursor: string | null;
        };
        rows.push(...value.connections.map(rowOf));
        if (value.next_cursor === null) break;
        cursor = value.next_cursor;
      }
      return { ok: true, value: rows };
    },

    async apps() {
      const listed = await apps.list();
      return listed.ok
        ? {
          ok: true,
          value: listed.value.filter((app) => !app.archived).map((app) => ({
            id: app.id,
            name: app.name,
          })),
        }
        : listed;
    },

    async connect(choice) {
      if (deps.coding === undefined) return unavailable;
      return mapped(
        await deps.coding.connect({
          intent: CONNECT_INTENT,
          harness_id: choice.harness,
          label: choice.label,
          scope: choice.scope.kind === "all"
            ? { kind: "all", app: null }
            : { kind: "app", app: choice.scope.app },
        }),
        (view) => view,
      );
    },

    async revoke(connection) {
      if (deps.openWindow === undefined) return unavailable;
      try {
        const opened = await deps.openWindow({
          request: {
            kind: "owner_decision",
            concern: "coding-agent/connection",
            decision: "coding_agent_connection_revoke",
            targets: [connection],
          },
          parentWindow: PARENT_WINDOW,
        }) as { windowId?: string; code?: string };
        return typeof opened?.windowId === "string"
          ? { ok: true, value: null }
          : { ok: false, code: opened?.code ?? "internal" };
      } catch {
        return unavailable;
      }
    },
  };
}
