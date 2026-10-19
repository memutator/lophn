// 메모리로 도는 LophnArtifactApi. gallery와 test가 쓴다. `missing`이면 open이 not_found로 거절된다.
import type {
  ArtifactEvent,
  ArtifactListItem,
  ArtifactViewState,
  LophnArtifactApi,
} from "../../../ipc/artifact.ts";

export function fakeArtifactApi(
  options: {
    missing?: boolean;
    artifacts?: readonly ArtifactListItem[];
    title?: string;
  } = {},
): {
  api: LophnArtifactApi;
  /** 열린 view의 state를 바꿔 민다. */
  set(patch: Partial<ArtifactViewState>): void;
  push(event: ArtifactEvent): void;
} {
  const stateListeners = new Set<(state: ArtifactViewState) => void>();
  const eventListeners = new Set<(event: ArtifactEvent) => void>();
  let latest: ArtifactViewState | null = null;
  let count = 0;

  const api: LophnArtifactApi = {
    open({ source }) {
      if (options.missing) return Promise.reject(new Error("not_found"));
      const name = source.kind === "artifact"
        ? source.name
        : source.path.split("/").at(-1) ?? source.path;
      latest = {
        view_session: `fake-artifact-${++count}`,
        source,
        file: source.kind === "artifact"
          ? `/fake/artifacts/${source.name}/index.html`
          : source.path,
        title: options.title ?? name,
        loading: false,
        health: "ok",
      };
      return Promise.resolve(latest);
    },
    reload: () => Promise.resolve(null),
    list: () => Promise.resolve({ artifacts: [...(options.artifacts ?? [])] }),
    subscribeState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  };

  return {
    api,
    set(patch) {
      if (latest === null) return;
      latest = { ...latest, ...patch };
      for (const listener of stateListeners) listener(latest);
    },
    push(event) {
      for (const listener of eventListeners) listener(event);
    },
  };
}
