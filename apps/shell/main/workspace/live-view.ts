// 창의 layout 힌트를 현재 보기로 조립해 relay에 publish하고, 사람 메시지를
// 보내기 전에 그 창과 session을 bind한다(shell/workspace#R9, R10). 창 신원은
// main이 정한다. 힌트의 대상은 scope 읽기가 허용한 것만 남긴다.
import { appViewContext, type AppViewSource } from "./app-view-context.ts";
import {
  assembleCurrentView,
  type CurrentViewState,
  type HintTab,
  type LayoutHint,
  type ViewScope,
} from "./current-view.ts";
import {
  type CoreSessionLike,
  createViewPublisher,
  type ViewPublisher,
} from "./view-publish.ts";

const ULID = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const MAX_PANES = 2;
const MAX_TABS = 200;
/** 판을 모르는 문서 탭이 있으면 메시지 bind 전에 이만큼 기다린다. */
const PENDING_WAIT_MS = 5_000;

export interface LiveViewDeps {
  session: () => CoreSessionLike | null;
  isLive(windowRef: string): boolean;
  views: AppViewSource["views"];
  now(): string;
}

export interface LiveView {
  hint(windowRef: string, input: unknown): Promise<{ ok: boolean }>;
  /** `messages/receive` body에서 session을 꺼내 그 창에 bind한다. */
  bindReceive(body: unknown, windowRef: string): Promise<void>;
  unavailable(windowRef: string): Promise<void>;
}

type Known = {
  fingerprint: string;
  generation: number;
  tabs: number;
  pending: boolean;
};

export function createLiveView(deps: LiveViewDeps): LiveView {
  const publisher = createViewPublisher({ session: deps.session });
  const tails = new Map<string, Promise<void>>();
  const known = new Map<string, Known>();

  return {
    hint(windowRef, input) {
      return enqueue(
        tails,
        windowRef,
        () => applyHint(deps, publisher, known, windowRef, input),
      );
    },
    async bindReceive(body, windowRef) {
      const session = receiveSession(body);
      if (session === null) return;
      const deadline = Date.now() + PENDING_WAIT_MS;
      for (;;) {
        await settled(tails, windowRef);
        const current = known.get(windowRef);
        if (current !== undefined && current.tabs > 0) break;
        if (current?.pending !== true || Date.now() >= deadline) break;
        await delay(40);
      }
      await enqueue(tails, windowRef, async () => {
        const core = deps.session();
        if (!core) return;
        await publisher.bind(session, windowRef);
      });
    },
    unavailable(windowRef) {
      known.delete(windowRef);
      return enqueue(tails, windowRef, async () => {
        const core = deps.session();
        if (!core) return;
        await publisher.unavailable(windowRef, "창이 닫혔다");
      });
    },
  };
}

async function applyHint(
  deps: LiveViewDeps,
  publisher: ViewPublisher,
  known: Map<string, Known>,
  windowRef: string,
  input: unknown,
): Promise<{ ok: boolean }> {
  const parsed = parseHint(windowRef, input);
  if (parsed === null) return { ok: false };
  const hintedTabs = parsed.hint.panes.reduce(
    (count, pane) => count + pane.tabs.length,
    0,
  );
  // 마지막 탭을 닫아 비었으면(판을 기다리는 탭도 없다) 이전에 publish한 보기를 빈 보기로 바꾼다.
  // 그대로 두면 agent가 닫힌 탭을 지금 열린 탭으로 읽는다(prompt-assemble#R28).
  const clearing = !parsed.pending && (known.get(windowRef)?.tabs ?? 0) > 0;
  if (hintedTabs === 0 && !clearing) {
    if (parsed.pending) markPending(known, windowRef);
    return { ok: true };
  }
  const session = deps.session();
  if (session === null) {
    markPending(known, windowRef);
    return { ok: false };
  }
  const scope = await scopeFor(session, parsed.hint);
  const assembled = assembleCurrentView({
    hint: parsed.hint,
    registry: {
      isLive: deps.isLive,
      ...appViewContext({ views: deps.views }, windowRef),
    },
    scope,
    observed_at: deps.now(),
  });
  if (!assembled.ok || (assembled.state.tabs.length === 0 && !clearing)) {
    if (parsed.pending) markPending(known, windowRef);
    return { ok: assembled.ok };
  }
  const fingerprint = viewFingerprint(assembled.state);
  const prev = known.get(windowRef);
  if (
    prev !== undefined && prev.tabs > 0 && prev.fingerprint === fingerprint
  ) {
    known.set(windowRef, { ...prev, pending: false });
    return { ok: true };
  }
  const generation = prev !== undefined && prev.generation > 0
    ? prev.generation + 1
    : 1;
  const result = await publisher.publish({ ...assembled.state, generation });
  if (!result.ok) {
    if (parsed.pending) markPending(known, windowRef);
    return { ok: false };
  }
  known.set(windowRef, {
    fingerprint,
    generation,
    tabs: assembled.state.tabs.length,
    pending: false,
  });
  return { ok: true };
}

function markPending(known: Map<string, Known>, windowRef: string): void {
  const current = known.get(windowRef);
  known.set(windowRef, {
    fingerprint: current?.fingerprint ?? "",
    generation: current?.generation ?? 0,
    tabs: current?.tabs ?? 0,
    pending: true,
  });
}

async function scopeFor(
  session: CoreSessionLike,
  hint: LayoutHint,
): Promise<ViewScope> {
  const projects = new Set<string>();
  const editors = new Set<string>();
  const viewers = new Set<string>();
  const apps = new Set<string>();
  const reads: Promise<void>[] = [];
  const seen = new Set<string>();
  const allow = (
    key: string,
    resource: string,
    body: unknown,
    keep: () => void,
  ) => {
    if (seen.has(key)) return;
    seen.add(key);
    reads.push((async () => {
      try {
        const result = await session.call("read", resource, "get", body);
        if (result.ok) keep();
      } catch {
        // 읽지 못한 대상은 범위 밖이다. 이전 화면으로 대신하지 않는다.
      }
    })());
  };
  if (hint.project !== null) {
    const project = hint.project;
    allow(`prj:${project}`, "projects", { project }, () => {
      projects.add(project);
    });
  }
  for (const pane of hint.panes) {
    for (const tab of pane.tabs) {
      if (tab.kind === "document_editor") {
        const document = tab.document;
        allow(`doc:${document}`, "documents", { document }, () => {
          editors.add(document);
        });
      } else if (tab.kind === "document_viewer") {
        const document = tab.document;
        const version = tab.version;
        allow(
          `ver:${document}:${version}`,
          "documents",
          { document, version },
          () => viewers.add(`${document}\0${version}`),
        );
      } else if (tab.kind === "app_panel") {
        const app = tab.app;
        allow(`app:${app}`, "apps", { app }, () => apps.add(app));
      }
    }
  }
  await Promise.all(reads);
  return {
    project: (id) => projects.has(id),
    document: (document, version) =>
      version === null
        ? editors.has(document)
        : viewers.has(`${document}\0${version}`),
    app: (id) => apps.has(id),
  };
}

function viewFingerprint(state: CurrentViewState): string {
  return JSON.stringify({
    project: state.project,
    focused_pane: state.focused_pane,
    selection: state.selection,
    app_view: state.app_view,
    tabs: state.tabs,
  });
}

function parseHint(
  windowRef: string,
  input: unknown,
): { hint: LayoutHint; pending: boolean } | null {
  if (input === null || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.panes) || raw.panes.length > MAX_PANES) return null;
  const panes: { tabs: HintTab[]; selected: string | null }[] = [];
  let count = 0;
  for (const pane of raw.panes) {
    if (pane === null || typeof pane !== "object") return null;
    const value = pane as Record<string, unknown>;
    if (!Array.isArray(value.tabs)) return null;
    const tabs: HintTab[] = [];
    for (const tab of value.tabs) {
      if (count >= MAX_TABS) break;
      const hinted = parseTab(tab);
      if (hinted !== null) {
        tabs.push(hinted);
        count += 1;
      }
    }
    const selected = typeof value.selected === "string" ? value.selected : null;
    panes.push({ tabs, selected });
  }
  const project = id("prj", raw.project);
  const focused = typeof raw.focused_pane === "number" &&
      Number.isSafeInteger(raw.focused_pane) && raw.focused_pane >= 0
    ? raw.focused_pane
    : null;
  const appTab = typeof raw.app_tab === "string" ? raw.app_tab : null;
  return {
    hint: {
      window_ref: windowRef,
      project,
      panes,
      focused_pane: focused,
      app_tab: appTab,
    },
    pending: raw.pending === true,
  };
}

function parseTab(value: unknown): HintTab | null {
  if (value === null || typeof value !== "object") return null;
  const tab = value as Record<string, unknown>;
  if (
    typeof tab.key !== "string" || tab.key.length === 0 || tab.key.length > 80
  ) {
    return null;
  }
  const key = tab.key;
  if (tab.kind === "document_editor") {
    const document = id("doc", tab.document);
    if (document === null) return null;
    return { kind: "document_editor", key, document };
  }
  if (tab.kind === "document_viewer") {
    const document = id("doc", tab.document);
    const version = id("ver", tab.version);
    if (document === null || version === null) return null;
    return { kind: "document_viewer", key, document, version };
  }
  if (tab.kind === "terminal") {
    const folder = tab.project_folder;
    if (
      typeof folder !== "string" || folder.length === 0 || folder.length > 80 ||
      folder.includes("/") || folder.includes("\\")
    ) return null;
    return { kind: "terminal", key, project_folder: folder };
  }
  if (tab.kind === "app_panel") {
    const app = id("app", tab.app);
    if (
      app === null || typeof tab.surface !== "string" ||
      tab.surface.length === 0 || tab.surface.length > 80
    ) return null;
    const session = typeof tab.view_session === "string" &&
        tab.view_session.length > 0 && tab.view_session.length <= 80
      ? tab.view_session
      : undefined;
    return {
      kind: "app_panel",
      key,
      app,
      surface: tab.surface,
      ...(session === undefined ? {} : { view_session: session }),
    };
  }
  return null;
}

function id(prefix: string, value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(`${prefix}_`)) return null;
  return ULID.test(value.slice(prefix.length + 1)) ? value : null;
}

function receiveSession(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const input = (body as { input?: unknown }).input;
  if (input === null || typeof input !== "object") return null;
  return id("ses", (input as { session?: unknown }).session);
}

function enqueue<T>(
  tails: Map<string, Promise<void>>,
  windowRef: string,
  job: () => Promise<T>,
): Promise<T> {
  const prev = tails.get(windowRef) ?? Promise.resolve();
  const run = prev.then(job, job);
  tails.set(
    windowRef,
    run.then(() => undefined, () => undefined),
  );
  return run;
}

function settled(
  tails: Map<string, Promise<void>>,
  windowRef: string,
): Promise<void> {
  return tails.get(windowRef) ?? Promise.resolve();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
