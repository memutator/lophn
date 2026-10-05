// coordinator가 쥔 관측 근거(documents plan Q15). core가 감독 pipe로 보낸 조각을 받아
// 마지막 조각에서 한꺼번에 반영한다. 반영되면 관측 loop 관리자가 root별로 loop를 맞춘다.
// 이 store는 파일을 읽지 않는다: root·규칙과 경로→문서 연결의 메모리일 뿐이다.
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type {
  ObservationBasisChunk,
  ObservationLinkBasis,
  ObservationRootBasis,
} from "../../../packages/documents/file-tracking/mod.ts";

export type BasisStore = {
  // 조각 하나를 받는다. 마지막 조각이면 반영하고 committed=true다.
  apply(chunk: ObservationBasisChunk): Result<{ committed: boolean }>;
  roots(): readonly ObservationRootBasis[];
  // 경로에 연결된 문서. 없으면 아직 연결되지 않은 파일이다.
  link(path: string): ObservationLinkBasis | undefined;
  links(): Iterable<ObservationLinkBasis>;
  rootOf(root: string): ObservationRootBasis | undefined;
  // 반영 횟수. 늦은 제출이 새 근거를 기다리는 기준이다.
  readonly version: number;
  // version이 since보다 커질 때까지 기다린다. 기한이 지나면 false다.
  changedSince(since: number, timeoutMs: number): Promise<boolean>;
  // 반영될 때마다 부른다. 구독 해제 함수를 돌려준다.
  onCommit(listener: () => void): () => void;
};

type Staged = {
  full: boolean;
  roots: ObservationRootBasis[];
  upsert: ObservationLinkBasis[];
  remove: string[];
};

export function createBasisStore(): BasisStore {
  let roots: ObservationRootBasis[] = [];
  let links = new Map<string, ObservationLinkBasis>();
  let staged: Staged | undefined;
  let version = 0;
  const listeners = new Set<() => void>();
  const waiters = new Set<() => void>();

  return {
    apply(chunk) {
      if (chunk.begin) {
        staged = {
          full: chunk.full,
          roots: chunk.roots ?? [],
          upsert: [],
          remove: [],
        };
      }
      // 시작 조각 없이 온 조각은 끊긴 push의 꼬리다. 일부만 반영하지 않는다.
      if (staged === undefined) {
        return err({
          code: "invalid_input",
          message: "observation basis chunk has no beginning",
        });
      }
      staged.upsert.push(...chunk.upsert);
      staged.remove.push(...chunk.remove);
      if (chunk.more) return ok({ committed: false });
      const done = staged;
      staged = undefined;
      const next = done.full
        ? new Map<string, ObservationLinkBasis>()
        : new Map(links);
      for (const path of done.remove) next.delete(path);
      for (const link of done.upsert) next.set(link.path, link);
      links = next;
      roots = done.roots;
      version += 1;
      for (const listener of [...listeners]) listener();
      for (const wake of [...waiters]) wake();
      return ok({ committed: true });
    },
    roots: () => roots,
    link: (path) => links.get(path),
    links: () => links.values(),
    rootOf: (root) => roots.find((entry) => entry.root === root),
    get version() {
      return version;
    },
    changedSince(since, timeoutMs) {
      if (version > since) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          waiters.delete(wake);
          resolve(false);
        }, timeoutMs);
        const wake = () => {
          clearTimeout(timer);
          waiters.delete(wake);
          resolve(true);
        };
        waiters.add(wake);
      });
    },
    onCommit(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
