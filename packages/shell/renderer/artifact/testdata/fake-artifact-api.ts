// 메모리로 도는 LophnArtifactApi. gallery와 test가 쓴다. `missing`이면 open이 not_found로 거절된다.
import type {
  ArtifactEvent,
  ArtifactListItem,
  ArtifactViewState,
  LophnArtifactApi,
} from "../../../ipc/artifact.ts";
import { FAKE_DOMAINS } from "../../workspace/fake-source.ts";

export function fakeArtifactApi(
  options: {
    missing?: boolean;
    /** 목록은 이 domain 하나에만 있다(기본은 fake project의 첫 domain). */
    artifacts?: readonly ArtifactListItem[];
    domain?: string;
    /** domain id마다 따로 주는 목록. 있으면 `artifacts`와 `domain`보다 먼저 본다. */
    perDomain?: Readonly<Record<string, readonly ArtifactListItem[]>>;
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
        : source.kind === "file"
        ? source.path.split("/").at(-1) ?? source.path
        : source.workflow;
      latest = {
        view_session: `fake-artifact-${++count}`,
        source,
        file: source.kind === "artifact"
          ? `/fake/artifacts/${source.name}/index.html`
          : source.kind === "file"
          ? source.path
          : `/fake/workflows/${source.workflow}/artifacts/${source.view}/index.html`,
        title: options.title ?? name,
        loading: false,
        health: "ok",
      };
      return Promise.resolve(latest);
    },
    reload: () => Promise.resolve(null),
    list: ({ domain }) =>
      Promise.resolve({
        artifacts: options.perDomain !== undefined
          ? [...(options.perDomain[domain] ?? [])]
          : domain === (options.domain ?? FAKE_DOMAINS[0]!.id)
          ? [...(options.artifacts ?? [])]
          : [],
      }),
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
