import type { ConfirmationIntent, ConfirmationRef } from "./types.ts";

import { type Canonical, createCoordinator } from "./coordinator.ts";
import type { CoreHandlePort } from "./handle.ts";
import type {
  AppContents,
  ConfirmationBrowserWindow,
  ConfirmationContents,
  ConfirmationHost,
  ConfirmationSession,
  ParentWindow,
} from "./window.ts";

export const REF = "C".repeat(43) as ConfirmationRef;
export const INTENT = {
  kind: "approval_request" as const,
  approval: "apr_00000000000000000000000001",
};

export interface Fake {
  host: ConfirmationHost;
  parents: Map<string, ParentWindow>;
  apps: Map<string, FakeApp[]>;
  windows: FakeWindow[];
  sessions: string[];
  hidden: string[];
  handles: CoreHandlePort & {
    closed: string[];
    cleared: number;
    issued: number;
    /** 등록한 handle의 내용 기준. 등록 순서대로다. */
    registered: string[];
  };
  canon: {
    value: Canonical;
    fail: boolean;
    reads: number;
    /** 읽은 intent. */
    intents: ConfirmationIntent[];
    /** 있으면 intent마다 다른 정본을 돌려준다(미리 고른 범위가 binding 내용을 바꾼다). */
    byIntent?: (intent: ConfirmationIntent) => Canonical;
  };
  submitted: { ref: string; decision: string; contentHash: string }[];
  clock: { now: number };
}

export interface FakeApp extends AppContents {
  blocked: boolean;
  hidden: boolean;
}

export class FakeWindow implements ConfirmationBrowserWindow {
  readonly webContents: ConfirmationContents;
  readonly id: number;
  shown = false;
  closed = false;
  #listeners = new Map<string, () => void>();
  sent: unknown[] = [];

  constructor(id: number) {
    this.id = id;
    this.webContents = {
      id,
      loadURL: () => Promise.resolve(),
      send: (_channel, payload) => {
        this.sent.push(payload);
      },
      isDestroyed: () => this.closed,
      on: () => {},
      setWindowOpenHandler: () => {},
      close: () => {
        this.closed = true;
      },
    };
  }

  loadURL(): Promise<void> {
    return Promise.resolve();
  }
  show(): void {
    this.shown = true;
  }
  focus(): void {}
  close(): void {
    this.closed = true;
    this.#listeners.get("closed")?.();
  }
  isDestroyed(): boolean {
    return this.closed;
  }
  on(event: "closed" | "unresponsive", listener: () => void): void {
    this.#listeners.set(event, listener);
  }
}

export function fake(): Fake {
  const windows: FakeWindow[] = [];
  const sessions: string[] = [];
  const apps = new Map<string, FakeApp[]>();
  const parents = new Map<string, ParentWindow>();
  let contentsId = 1;
  const host: ConfirmationHost = {
    create: () => {
      const window = new FakeWindow(contentsId++);
      windows.push(window);
      return window;
    },
    sessionFor: (partition) => {
      sessions.push(partition);
      const session: ConfirmationSession = {
        partition,
        setPermissionRequestHandler: () => {},
        on: () => {},
        webRequest: { onBeforeRequest: () => {} },
      };
      return session;
    },
    appContents: (parentId) => apps.get(parentId) ?? [],
  };
  const closed: string[] = [];
  const handles = {
    closed,
    cleared: 0,
    issued: 0,
    registered: [] as string[],
    register: (
      request: { expires_at: string; window_id: string; content_hash: string },
    ) => {
      handles.issued += 1;
      handles.registered.push(request.content_hash);
      return Promise.resolve({
        ok: true as const,
        confirmation: REF,
        expiresAt: request.expires_at,
      });
    },
    closeWindow: (windowId: string) => {
      closed.push(windowId);
      return Promise.resolve();
    },
    clear: () => {
      handles.cleared += 1;
      return Promise.resolve();
    },
  };
  return {
    host,
    parents,
    apps,
    windows,
    sessions,
    hidden: [],
    handles,
    canon: {
      reads: 0,
      intents: [],
      fail: false,
      value: {
        targetRef: INTENT.approval,
        content: {
          approval: INTENT.approval,
          binding_hash: "a".repeat(64),
          created_seq: "1",
        },
        allowed: ["grant_approval_request", "reject_approval_request"],
        expiresAt: null,
        secondConfirm: false,
        request: {
          kind: "approval_request",
          approval: INTENT.approval,
          created_seq: "1",
          binding_hash: "a".repeat(64),
        },
      },
    },
    submitted: [],
    clock: { now: 1_700_000_000_000 },
  };
}

export function parent(id: string): ParentWindow {
  return {
    id,
    focus: () => {},
    getContentSize: () => ({ width: 1200, height: 800 }),
  };
}

export function app(id: number): FakeApp {
  const appContents: FakeApp = {
    id,
    blocked: false,
    hidden: false,
    isDestroyed: () => false,
    on: () => {
      appContents.blocked = true;
    },
    off: () => {
      appContents.blocked = false;
    },
    setWindowOpenHandler: () => {},
  };
  return appContents;
}

export function coordinator(
  env: Fake,
  connected = () => true,
  epoch = () => "epoch-1",
) {
  return createCoordinator({
    host: env.host,
    canon: {
      read: (intent) => {
        env.canon.reads += 1;
        env.canon.intents.push(intent);
        if (env.canon.fail) {
          return Promise.resolve({
            ok: false,
            error: { code: "unavailable", message: "조회에 실패했다" },
          });
        }
        return Promise.resolve({
          ok: true,
          value: env.canon.byIntent?.(intent) ?? env.canon.value,
        });
      },
    },
    handles: env.handles,
    submit: {
      submit: ({ handle, decision }) => {
        env.submitted.push({
          ref: handle.ref,
          decision,
          contentHash: handle.contentHash,
        });
        return Promise.resolve({
          ok: true,
          value: { receipt: { kind: "event", seq: "1" } },
        });
      },
      receipt: () => Promise.resolve(undefined),
    },
    refusals: {
      reject_approval_request: "rejected",
      cancel_approval_request: "cancelled",
    },
    clock: { now: () => env.clock.now },
    preload: "/preload-confirmation.cjs",
    packaged: true,
    epoch,
    connected,
  });
}
