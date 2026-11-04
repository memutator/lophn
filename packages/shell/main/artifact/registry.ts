// artifact view 목록. 봉한 partition의 shell renderer `<webview>` guest 하나이고, 앱 view
// registry(app-frame/registry.ts)는 앱 연결에 묶여 있어 여기 넣지 않는다. 위치·숨김은 renderer
// CSS다. 같은 창에서 같은 source의 view는 하나다(탭이 다시 mount되어도).
import type {
  ArtifactEvent,
  ArtifactReply,
  ArtifactSource,
  ArtifactViewState,
} from "../../ipc/artifact.ts";
import type { AnnotateViewPort } from "../../ipc/annotation.ts";
import { artifactPlaceOf } from "../../../protocol/projects/artifact.ts";
import {
  nextHealth,
  type ViewHealth,
  type ViewHealthSignal,
} from "../app-frame/crash.ts";
import type { GuestContents } from "../app-frame/view-model.ts";
import { ARTIFACT_PARTITION, ARTIFACT_SCHEME } from "./session.ts";
import type { ResolvedSource } from "./source.ts";

// 파일이 연달아 바뀌는 동안 한 번만 다시 load한다.
const RELOAD_DEBOUNCE_MS = 150;

export interface ArtifactContents {
  readonly id: number;
  title(): string;
  loading(): boolean;
  /** 캐시를 거치지 않고 다시 load한다. */
  reload(): void;
  pageUrl(): string | null;
  /** 그 guest의 페이지로 보낸다(`webContents.send`). */
  send(channel: string, payload: unknown): void;
  /** 그 guest만 찍은 PNG byte. */
  capture(): Promise<Uint8Array>;
}

/** guest에 거는 hook이 부르는 것. */
export interface ArtifactHooks {
  /** 이 view의 origin host(registerRoot). */
  host: string;
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
  /** renderer가 `<webview>`를 지워 guest가 사라졌다. */
  onDestroyed(): void;
}

/** 붙은 guest를 artifact view로 감싸는 adapter. */
export interface ArtifactViewHost {
  guest(contents: GuestContents, hooks: ArtifactHooks): ArtifactContents;
}

interface ArtifactViewsDeps {
  host: ArtifactViewHost;
  activation: ArtifactHooks["activation"];
  resolve(
    source: ArtifactSource,
  ): Promise<
    | { ok: true; value: ResolvedSource }
    | { ok: false; error: { code: string; message: string } }
  >;
  /** 봉한 session을 한 번 세운다. 못 세우면 던진다. */
  ensureSession(): Promise<void>;
  /** root(와 scope)마다 host를 달리해 origin을 가른다. */
  registerRoot(root: string, scope: string | null): string;
  watch(
    input: { dir: string; recursive: boolean; debounceMs: number },
    onChange: () => void,
  ): { stop(): void };
  ids: { viewSession(): string };
  /** 그 창의 renderer로 상태를 민다. */
  pushState(window: string, state: ArtifactViewState): void;
  pushEvent(window: string, event: ArtifactEvent): void;
}

interface Entry {
  view_session: string;
  window: string;
  source: ArtifactSource;
  file: string;
  host: string;
  entry: string;
  /** 화면을 새로 여는 세대. `<webview src>`의 `mount` 값이다. */
  mount: number;
  /** renderer가 `<webview src>`에 넣을 주소. */
  src: string;
  /** 그 src를 붙이기로 이미 받았는가. 한 src는 1회만 받는다. */
  srcUsed: boolean;
  /** 지금 붙은 guest. renderer가 아직 안 붙였거나 지웠으면 undefined다. */
  contents: ArtifactContents | undefined;
  /** 붙이기로 받았지만 아직 did-attach가 오지 않은 guest. */
  accepted: AcceptedArtifactGuest | undefined;
  health: ViewHealth;
  watch: { stop(): void };
}

/** `will-attach-webview`가 받은 이 view의 붙이기 하나. src 하나에 한 번만 준다. */
export interface AcceptedArtifactGuest {
  readonly src: string;
  readonly partition: string;
}

const sameSource = (a: ArtifactSource, b: ArtifactSource) => {
  if (a.kind === "artifact") {
    if (b.kind !== "artifact" || a.name !== b.name) return false;
    const [pa, pb] = [artifactPlaceOf(a), artifactPlaceOf(b)];
    return pa.kind === pb.kind && pa.id === pb.id;
  }
  if (a.kind === "file") {
    return b.kind === "file" && a.project === b.project && a.path === b.path;
  }
  return (
    b.kind === "workflow" &&
    a.project === b.project &&
    a.workflow === b.workflow &&
    a.view === b.view &&
    (a.instance ?? null) === (b.instance ?? null)
  );
};

// view 하나가 화면을 열 때의 주소. `mount`가 바뀔 때마다 renderer가 guest를 새로 만든다.
function viewUrl(entry: Entry): string {
  return `${ARTIFACT_SCHEME}://${entry.host}/${encodeURIComponent(
    entry.entry,
  )}?mount=${entry.mount}`;
}

export interface ArtifactViews {
  open(
    window: string,
    source: ArtifactSource,
  ): Promise<ArtifactReply<ArtifactViewState>>;
  /** 건강한 view는 cache를 거치지 않고 다시 load하고, 깨진 view는 새 화면 세대를 연다. */
  reload(window: string, view_session: string): ArtifactReply<null>;
  reloadInstance(instance: string): void;
  acceptGuest(window: string, src: string): AcceptedArtifactGuest | undefined;
  dropGuest(accepted: AcceptedArtifactGuest): void;
  bindGuest(accepted: AcceptedArtifactGuest, guest: GuestContents): void;
  annotateView(view_session: string): AnnotateViewPort | undefined;
  senderAnnotateView(contentsId: number): AnnotateViewPort | undefined;
  owner(view_session: string): string | undefined;
  close(view_session: string): void;
  closeWindow(window: string): void;
  dispose(): void;
}

export function createArtifactViews(deps: ArtifactViewsDeps): ArtifactViews {
  const entries = new Map<string, Entry>();
  const pending = new Map<AcceptedArtifactGuest, Entry>();

  function state(entry: Entry): ArtifactViewState {
    return {
      view_session: entry.view_session,
      source: entry.source,
      file: entry.file,
      src: entry.src,
      title: entry.contents?.title() ?? "",
      loading: entry.contents?.loading() ?? false,
      health: entry.health,
    };
  }

  const push = (entry: Entry) => deps.pushState(entry.window, state(entry));

  // 새 화면 세대를 연다. 옛 guest 묶음은 즉시 버린다(그 guest의 신원·캡처는 더 없다).
  function mount(entry: Entry): void {
    entry.contents = undefined;
    if (entry.accepted !== undefined) pending.delete(entry.accepted);
    entry.accepted = undefined;
    entry.mount += 1;
    entry.src = viewUrl(entry);
    entry.srcUsed = false;
  }

  // view를 버린다. watch와 받아 둔 붙이기를 함께 지운다.
  function forget(entry: Entry): void {
    entries.delete(entry.view_session);
    entry.watch.stop();
    if (entry.accepted !== undefined) pending.delete(entry.accepted);
    entry.accepted = undefined;
    entry.contents = undefined;
  }

  function annotatePort(entry: Entry): AnnotateViewPort {
    const view_session = entry.view_session;
    const current = () => entries.get(view_session) === entry;
    return {
      view_session,
      // page가 보낸 값이 아니라 open 때 main이 정한 source다.
      // workflow artifact는 사람의 .html과 같은 file 길로 그 project place의 lophn session이 받는다.
      target:
        entry.source.kind === "artifact"
          ? "app" in entry.source
            ? {
                kind: "artifact",
                app: entry.source.app,
                name: entry.source.name,
              }
            : {
                kind: "artifact",
                project: entry.source.project,
                name: entry.source.name,
              }
          : { kind: "file", project: entry.source.project },
      pageUrl: () => entry.contents?.pageUrl() ?? null,
      current,
      send(channel, payload) {
        entry.contents?.send(channel, payload);
      },
      async capture() {
        const contents = entry.contents;
        if (contents === undefined) throw new Error("view is gone");
        const png = await contents.capture();
        // 캡처하는 사이 guest가 바뀌었으면 그 그림은 이 view의 것이 아니다.
        if (entry.contents !== contents) throw new Error("view is gone");
        return png;
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
            code:
              code === "invalid_input" || code === "not_found"
                ? code
                : "unavailable",
            message,
          },
        };
      }
      try {
        // 붙이기가 sync로 받아야 해서 guest가 생기기 전에 봉해 둔다.
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
      const host = deps.registerRoot(root, resolved.value.scope);
      const entry: Entry = {
        view_session,
        window,
        source,
        file,
        host,
        entry: entryName,
        mount: 0,
        src: "",
        srcUsed: false,
        contents: undefined,
        accepted: undefined,
        health: "ok",
        // 사람의 file은 그 폴더 바로 아래만 지켜본다.
        watch: deps.watch(
          {
            dir: root,
            recursive: source.kind !== "file",
            debounceMs: RELOAD_DEBOUNCE_MS,
          },
          () => {
            const live = entries.get(view_session);
            if (live?.health === "ok") live.contents?.reload();
          },
        ),
      };
      mount(entry);
      entries.set(view_session, entry);
      return { ok: true, value: state(entry) };
    },

    /** 깨진 view는 reload로 살아나지 않는다. 같은 view_session에 새 화면 세대를 연다. */
    reload(window: string, view_session: string): ArtifactReply<null> {
      const entry = entries.get(view_session);
      if (entry?.window !== window) {
        return {
          ok: false,
          error: { code: "invalid_input", message: "view is not open" },
        };
      }
      if (entry.health === "ok") entry.contents?.reload();
      else {
        entry.health = "ok";
        mount(entry);
        push(entry);
      }
      return { ok: true, value: null };
    },

    /** instance가 바뀌었다. 그 instance를 여는 view만 다시 load한다. */
    reloadInstance(instance: string): void {
      for (const entry of entries.values()) {
        if (
          entry.source.kind === "workflow" &&
          entry.source.instance === instance &&
          entry.health === "ok"
        )
          entry.contents?.reload();
      }
    },

    /**
     * `<webview>` 붙이기 하나를 받는다. 이 창의 view이고 그 src를 아직 안 붙였을 때만 받는다
     * (1회용). 아니면 undefined다.
     */
    acceptGuest(
      window: string,
      src: string,
    ): AcceptedArtifactGuest | undefined {
      for (const entry of entries.values()) {
        if (entry.window !== window || entry.src !== src) continue;
        if (entry.srcUsed || entry.contents !== undefined) return undefined;
        entry.srcUsed = true;
        const accepted: AcceptedArtifactGuest = Object.freeze({
          src: entry.src,
          partition: ARTIFACT_PARTITION,
        });
        entry.accepted = accepted;
        pending.set(accepted, entry);
        return accepted;
      }
      return undefined;
    },

    /** 받아 두었지만 붙지 못한 붙이기를 버린다(창이 닫히거나 규칙이 뒤에서 거절). */
    dropGuest(accepted: AcceptedArtifactGuest): void {
      const entry = pending.get(accepted);
      if (entry === undefined || entry.accepted !== accepted) return;
      pending.delete(accepted);
      entry.accepted = undefined;
    },

    /** 받아 둔 붙이기의 guest를 view 신원·건강 감시에 묶는다(did-attach). */
    bindGuest(accepted: AcceptedArtifactGuest, guest: GuestContents): void {
      const entry = pending.get(accepted);
      if (entry === undefined) return;
      pending.delete(accepted);
      if (entry.accepted !== accepted) return;
      entry.accepted = undefined;
      if (
        entries.get(entry.view_session) !== entry ||
        entry.src !== accepted.src
      )
        return;
      let bound: ArtifactContents | undefined;
      const contents = deps.host.guest(guest, {
        host: entry.host,
        activation: deps.activation,
        onChange() {
          if (entries.get(entry.view_session) !== entry) return;
          if (bound === undefined || entry.contents !== bound) return;
          push(entry);
        },
        onHealth(signal) {
          if (entries.get(entry.view_session) !== entry) return;
          if (bound === undefined || entry.contents !== bound) return;
          entry.health = nextHealth(entry.health, signal);
          push(entry);
        },
        openLink(url) {
          if (entries.get(entry.view_session) !== entry) return;
          if (bound === undefined || entry.contents !== bound) return;
          deps.pushEvent(entry.window, {
            kind: "open-link",
            view_session: entry.view_session,
            url,
          });
        },
        onDestroyed() {
          if (bound === undefined || entry.contents !== bound) return;
          entry.contents = undefined;
        },
      });
      bound = contents;
      entry.contents = contents;
    },

    annotateView(view_session: string): AnnotateViewPort | undefined {
      const entry = entries.get(view_session);
      return entry === undefined ? undefined : annotatePort(entry);
    },

    /** IPC sender webContents의 annotate 입구. 폐기·교체된 contents는 undefined다. */
    senderAnnotateView(contentsId: number): AnnotateViewPort | undefined {
      for (const entry of entries.values()) {
        if (entry.contents?.id === contentsId) return annotatePort(entry);
      }
      return undefined;
    },

    owner(view_session: string): string | undefined {
      return entries.get(view_session)?.window;
    },

    close(view_session: string): void {
      const entry = entries.get(view_session);
      if (entry !== undefined) forget(entry);
    },

    closeWindow(window: string): void {
      for (const entry of [...entries.values()]) {
        if (entry.window === window) forget(entry);
      }
    },

    dispose(): void {
      for (const entry of [...entries.values()]) forget(entry);
    },
  };
}
