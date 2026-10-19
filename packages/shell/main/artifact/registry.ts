// artifact view 목록. 봉한 partition의 native view(contents 하나와 그 위치 placement)이고, 앱 view
// registry(app-frame/registry.ts)는 앱 연결에 묶여 있어 여기 넣지 않는다. 위치·숨김만 browser의 native
// popup과 같은 createPlacement를 쓴다. 같은 창에서 같은 source의 view는 하나다(탭이 다시 mount되어도).
import type {
  ArtifactEvent,
  ArtifactReply,
  ArtifactSource,
  ArtifactViewState,
} from "../../ipc/artifact.ts";
import type { AnnotateViewPort } from "../../ipc/annotation.ts";
import { failure, type Outcome } from "../app-frame/app-connection.ts";
import {
  nextHealth,
  type ViewHealth,
  type ViewHealthSignal,
} from "../app-frame/crash.ts";
import { createPlacement, type Placed } from "../app-frame/placement.ts";
import type {
  AppViewContents,
  AppViewHost,
  ViewBounds,
} from "../app-frame/view-model.ts";
import type { ResolvedSource } from "./source.ts";

// 파일이 연달아 바뀌는 동안 한 번만 다시 load한다.
const RELOAD_DEBOUNCE_MS = 150;

export interface ArtifactContents extends AppViewContents {
  title(): string;
  loading(): boolean;
  /** 캐시를 거치지 않고 다시 load한다. */
  reload(): void;
  pageUrl(): string | null;
  /** 그 view의 페이지로 보낸다(`webContents.send`). */
  send(channel: string, payload: unknown): void;
  /** view의 PNG byte. */
  capture(): Promise<Uint8Array>;
}

/** contents에 거는 hook이 부르는 것. */
export interface ArtifactHooks {
  activation: {
    mark(contentsId: number): void;
    fresh(contentsId: number): boolean;
    forget(contentsId: number): void;
  };
  /** title·loading이 바뀌었다. */
  onChange(): void;
  onHealth(signal: ViewHealthSignal): void;
  /** 사용자 입력 직후 page에서 누른 http/https link. */
  openLink(url: string): void;
}

export interface ArtifactViewHost extends
  Pick<
    AppViewHost,
    "hasWindow" | "attach" | "detach" | "focused" | "focusShell"
  > {
  create(host: string, hooks: ArtifactHooks): ArtifactContents;
}

interface ArtifactViewsDeps {
  host: ArtifactViewHost;
  activation: ArtifactHooks["activation"];
  resolve(source: ArtifactSource): Promise<
    | { ok: true; value: ResolvedSource }
    | { ok: false; error: { code: string; message: string } }
  >;
  /** 봉한 session을 한 번 세운다. 못 세우면 던진다. */
  ensureSession(): Promise<void>;
  /** root마다 host를 달리해 origin을 가른다. */
  registerRoot(root: string): string;
  watch(
    input: { dir: string; recursive: boolean; debounceMs: number },
    onChange: () => void,
  ): { stop(): void };
  ids: { viewSession(): string };
  /** 그 창의 renderer로 상태를 민다. */
  pushState(window: string, state: ArtifactViewState): void;
  pushEvent(window: string, event: ArtifactEvent): void;
}

interface Entry extends Omit<Placed, "contents"> {
  view_session: string;
  source: ArtifactSource;
  file: string;
  host: string;
  entry: string;
  watch: { stop(): void };
  contents: ArtifactContents;
  health: ViewHealth;
}

const notOpen = () => failure("invalid_input", "view is not open");

const sameSource = (a: ArtifactSource, b: ArtifactSource) =>
  a.kind === "artifact"
    ? b.kind === "artifact" && a.project === b.project && a.name === b.name
    : b.kind === "file" && a.project === b.project && a.path === b.path;

export function createArtifactViews(deps: ArtifactViewsDeps) {
  const entries = new Map<string, Entry>();
  const placement = createPlacement<Entry>({
    views: deps.host,
    record: () => {},
  });

  const urlOf = (entry: Entry) =>
    `lophn-artifact://${entry.host}/${encodeURIComponent(entry.entry)}`;

  function state(entry: Entry): ArtifactViewState {
    return {
      view_session: entry.view_session,
      source: entry.source,
      file: entry.file,
      title: entry.contents.title(),
      loading: entry.contents.loading(),
      health: entry.health,
    };
  }

  const push = (entry: Entry) => deps.pushState(entry.window, state(entry));

  // 교체·폐기된 contents가 늦게 보낸 신호는 지금 view의 것이 아니다.
  function spawn(view_session: string, host: string): ArtifactContents {
    const live = () => {
      const current = entries.get(view_session);
      return current?.contents === contents ? current : undefined;
    };
    const contents: ArtifactContents = deps.host.create(host, {
      activation: deps.activation,
      onChange() {
        const current = live();
        if (current !== undefined) push(current);
      },
      onHealth(signal) {
        const current = live();
        if (current === undefined) return;
        current.health = nextHealth(current.health, signal);
        push(current);
      },
      openLink(url) {
        const current = live();
        if (current !== undefined) {
          deps.pushEvent(current.window, {
            kind: "open-link",
            view_session,
            url,
          });
        }
      },
    });
    return contents;
  }

  // 첫 load가 끝나면(실패도) 붙일 수 있다.
  function load(entry: Entry): void {
    const contents = entry.contents;
    void contents.load(urlOf(entry)).catch(() => {}).then(() => {
      if (entries.get(entry.view_session) !== entry) return;
      if (entry.contents !== contents || entry.ready) return;
      placement.loaded(entry);
    });
  }

  function dispose(entry: Entry): void {
    entries.delete(entry.view_session);
    entry.watch.stop();
    placement.unmounted(entry);
    entry.contents.destroy();
  }

  function annotatePort(entry: Entry): AnnotateViewPort {
    const contents = entry.contents;
    const current = () =>
      entries.get(entry.view_session) === entry && entry.contents === contents;
    return {
      view_session: entry.view_session,
      // page가 보낸 값이 아니라 open 때 main이 정한 source다.
      target: {
        kind: "artifact",
        project: entry.source.project,
        name: entry.source.kind === "artifact" ? entry.source.name : null,
      },
      pageUrl: () => contents.pageUrl(),
      current,
      send(channel, payload) {
        if (current()) contents.send(channel, payload);
      },
      capture() {
        return current()
          ? contents.capture()
          : Promise.reject(new Error("view is gone"));
      },
    };
  }

  return {
    async open(
      window: string,
      source: ArtifactSource,
    ): Promise<ArtifactReply<ArtifactViewState>> {
      const resolved = await deps.resolve(source);
      if (!resolved.ok) {
        const { code, message } = resolved.error;
        return {
          ok: false,
          error: {
            code: code === "invalid_input" || code === "not_found"
              ? code
              : "unavailable",
            message,
          },
        };
      }
      try {
        await deps.ensureSession();
      } catch {
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: "artifact view could not be sealed",
          },
        };
      }
      // await 뒤라 같은 source를 동시에 연 요청이 먼저 만들었을 수 있다.
      for (const found of entries.values()) {
        if (found.window === window && sameSource(found.source, source)) {
          return { ok: true, value: state(found) };
        }
      }
      const { root, entry: entryName, file } = resolved.value;
      const view_session = deps.ids.viewSession();
      const host = deps.registerRoot(root);
      const entry: Entry = {
        view_session,
        window,
        source,
        file,
        host,
        entry: entryName,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        generation: 0,
        shown: false,
        ready: false,
        placed: false,
        attached: false,
        layer: 0,
        health: "ok",
        contents: spawn(view_session, host),
        // 사람의 file은 그 폴더 바로 아래만 지켜본다.
        watch: deps.watch(
          {
            dir: root,
            recursive: source.kind === "artifact",
            debounceMs: RELOAD_DEBOUNCE_MS,
          },
          () => {
            const live = entries.get(view_session);
            if (live?.health === "ok") live.contents.reload();
          },
        ),
      };
      entries.set(view_session, entry);
      placement.mounted(entry);
      load(entry);
      return { ok: true, value: state(entry) };
    },

    /** 깨진 contents는 reload로 살아나지 않는다. 같은 view_session에 새 contents를 만든다. */
    reload(window: string, view_session: string): ArtifactReply<null> {
      const entry = entries.get(view_session);
      if (entry?.window !== window) {
        return {
          ok: false,
          error: { code: "invalid_input", message: "view is not open" },
        };
      }
      if (entry.health === "ok") entry.contents.reload();
      else {
        placement.unmounted(entry);
        entry.contents.destroy();
        entry.contents = spawn(view_session, entry.host);
        entry.health = "ok";
        placement.mounted(entry);
        load(entry);
        push(entry);
      }
      return { ok: true, value: null };
    },

    annotateView(view_session: string): AnnotateViewPort | undefined {
      const entry = entries.get(view_session);
      return entry === undefined ? undefined : annotatePort(entry);
    },

    /** IPC sender webContents의 annotate 입구. 폐기·교체된 contents는 undefined다. */
    senderAnnotateView(contentsId: number): AnnotateViewPort | undefined {
      for (const entry of entries.values()) {
        if (entry.contents.id === contentsId) return annotatePort(entry);
      }
      return undefined;
    },

    // frame-router 길.
    has: (view_session: string) => entries.has(view_session),

    owner: (view_session: string) => entries.get(view_session)?.window,

    /**
     * view를 닫지 않고 from 창에서 to 창으로 옮긴다. 떼어 숨긴 상태가 되고 새 창 renderer가
     * bounds를 보내면 붙는다.
     */
    move(view_session: string, from: string, to: string): Outcome<null> {
      const entry = entries.get(view_session);
      if (entry === undefined || entry.window !== from) return notOpen();
      if (!deps.host.hasWindow(to)) {
        return failure("invalid_input", "window is not open");
      }
      // 떼기는 옛 창 기준이라 소유 창을 바꾸기 전에 한다.
      placement.hide(entry);
      entry.window = to;
      push(entry);
      return { ok: true, value: null };
    },

    setBounds(view_session: string, bounds: ViewBounds, layer: number) {
      const entry = entries.get(view_session);
      return entry === undefined
        ? notOpen()
        : placement.setBounds(entry, bounds, layer);
    },

    hide(view_session: string) {
      const entry = entries.get(view_session);
      return entry === undefined ? notOpen() : placement.hide(entry);
    },

    close(view_session: string): void {
      const entry = entries.get(view_session);
      if (entry !== undefined) dispose(entry);
    },

    closeWindow(window: string): void {
      for (const entry of [...entries.values()]) {
        if (entry.window === window) dispose(entry);
      }
    },

    dispose(): void {
      for (const entry of [...entries.values()]) dispose(entry);
    },
  };
}

export type ArtifactViews = ReturnType<typeof createArtifactViews>;
