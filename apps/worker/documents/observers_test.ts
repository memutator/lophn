// documents/file-tracking#R3·R8: 관측 근거가 반영될 때마다 root별 loop를 맞춘다. 새 root는
// 시작하고, 사라진 root는 멈추고, 규칙·project 판·보관 연결이 바뀐 root만 다시 시작한다.
import { assert, assertEquals } from "@std/assert";
import type {
  ObservationBasisChunk,
  ObservationLinkBasis,
  ObservationRootBasis,
  ObserveDeps,
  ObserveRoot,
} from "../../../packages/core/projects/file-tracking/mod.ts";
import { ok } from "../../../packages/base/mod.ts";
import { createBasisStore } from "./basis.ts";
import { createRootObservers } from "./observers.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";

function root(path: string, revision = "2"): ObservationRootBasis {
  return {
    root: path,
    project: PROJECT,
    project_revision: revision,
    patterns: [{ effect: "include", glob: "**/*.md" }],
    use_gitignore: false,
  };
}

function link(path: string, status: "active" | "archived" = "active") {
  return {
    project: PROJECT,
    path,
    document: "doc_a",
    document_revision: "5",
    status,
    latest_version: "ver_1",
    latest_hash: null,
    title: "a",
  } satisfies ObservationLinkBasis;
}

function push(
  roots: ObservationRootBasis[],
  links: ObservationLinkBasis[] = [],
): ObservationBasisChunk {
  return {
    begin: true,
    full: true,
    roots,
    folders: roots.map((root) => ({ project: root.project, path: root.root })),
    upsert: links,
    remove: [],
    more: false,
  };
}

// loop 하나를 흉내 낸다: stop이 서면 끝난다. 시작과 멈춤을 기록한다.
function harness() {
  const store = createBasisStore();
  const started: ObserveRoot[] = [];
  const stopped: string[] = [];
  const observers = createRootObservers({
    store,
    observe: async (deps: ObserveDeps, request: ObserveRoot) => {
      started.push(request);
      while (!deps.stop?.stopped) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      stopped.push(request.root);
    },
    deps: {
      watch: { watch: () => (async function* () {})() },
      scan: {
        list: () => Promise.resolve(ok([])),
        gitignore: () => Promise.resolve(ok(null)),
      },
      read: {
        open: () => Promise.reject(new Error("unused")),
        identity: () => Promise.reject(new Error("unused")),
        hash: () => Promise.resolve(""),
      },
      nowMs: () => Date.now(),
      submit: () => Promise.resolve(ok(undefined)),
      basisFor: () => {
        throw new Error("unused");
      },
    },
  });
  store.onCommit(() => observers.sync());
  return { store, observers, started, stopped };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

Deno.test("documents/file-tracking#R3: 근거가 오기 전에는 관측하지 않고 root가 오면 그 root의 loop를 시작한다", async () => {
  const { store, observers, started } = harness();
  observers.sync();
  assertEquals(started.length, 0);
  store.apply(push([root("/work/a"), root("/work/b")]));
  await settle();
  assertEquals(started.map((request) => request.root).sort(), [
    "/work/a",
    "/work/b",
  ]);
  assertEquals(started[0].enabled, true);
  assertEquals(started[0].patterns, [{ effect: "include", glob: "**/*.md" }]);
  assertEquals([...observers.running()].sort(), ["/work/a", "/work/b"]);
  observers.stopAll();
  await settle();
});

Deno.test("documents/file-tracking#R3: 바뀌지 않은 root의 loop는 다시 시작하지 않는다", async () => {
  const { store, observers, started } = harness();
  store.apply(push([root("/work/a")]));
  await settle();
  // 연결만 바뀐 push는 규칙이 같으니 loop를 건드리지 않는다.
  store.apply(push([root("/work/a")], [link("/work/a/x.md")]));
  await settle();
  assertEquals(started.length, 1);
  observers.stopAll();
  await settle();
});

Deno.test("documents/file-tracking#R3: 규칙이 바뀐 root는 멈춘 뒤 다시 시작하고 사라진 root는 멈춘다", async () => {
  const { store, observers, started, stopped } = harness();
  store.apply(push([root("/work/a"), root("/work/b")]));
  await settle();
  store.apply(push([root("/work/a", "3")]));
  await settle();
  // a는 project 판이 바뀌어 다시 시작했고 b는 사라져 멈췄다.
  assertEquals(
    started.filter((request) => request.root === "/work/a").length,
    2,
  );
  assert(stopped.includes("/work/a"));
  assert(stopped.includes("/work/b"));
  assertEquals(observers.running(), ["/work/a"]);
  observers.stopAll();
  await settle();
});

Deno.test("documents/file-tracking#R8: 보관이 풀린 연결이 있는 root는 현재 파일을 다시 대조하려고 다시 시작한다", async () => {
  const { store, observers, started } = harness();
  store.apply(push([root("/work/a")], [link("/work/a/old.md", "archived")]));
  await settle();
  assertEquals(started.length, 1);
  store.apply(push([root("/work/a")], [link("/work/a/old.md", "active")]));
  await settle();
  assertEquals(started.length, 2);
  observers.stopAll();
  await settle();
});

Deno.test("documents/file-tracking#R8: 멈춘 뒤에는 근거가 와도 loop를 시작하지 않는다", async () => {
  const { store, observers, started } = harness();
  observers.stopAll();
  store.apply(push([root("/work/a")]));
  await settle();
  assertEquals(started.length, 0);
});

Deno.test("documents/file-tracking#R3: loop 하나가 실패해도 다른 root는 계속 돈다", async () => {
  const store = createBasisStore();
  const seen: string[] = [];
  const observers = createRootObservers({
    store,
    observe: (deps, request) => {
      seen.push(request.root);
      if (request.root === "/work/bad") {
        return Promise.reject(new Error("scan failed"));
      }
      return new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (deps.stop?.stopped) {
            clearInterval(timer);
            resolve();
          }
        }, 5);
      });
    },
    deps: {
      watch: { watch: () => (async function* () {})() },
      scan: {
        list: () => Promise.resolve(ok([])),
        gitignore: () => Promise.resolve(ok(null)),
      },
      read: {
        open: () => Promise.reject(new Error("unused")),
        identity: () => Promise.reject(new Error("unused")),
        hash: () => Promise.resolve(""),
      },
      nowMs: () => Date.now(),
      submit: () => Promise.resolve(ok(undefined)),
      basisFor: () => {
        throw new Error("unused");
      },
    },
  });
  store.onCommit(() => observers.sync());
  store.apply(push([root("/work/bad"), root("/work/good")]));
  await settle();
  assertEquals(seen.sort(), ["/work/bad", "/work/good"]);
  // 실패한 loop는 끝났고 좋은 loop만 남는다.
  assertEquals(observers.running(), ["/work/good"]);
  observers.stopAll();
  await settle();
});
