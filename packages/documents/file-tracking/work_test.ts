import { assert, assertEquals } from "@std/assert";
import { ok, type Result } from "../../base/mod.ts";
import { QUIET_MS } from "./model.ts";
import {
  basisChanged,
  dropCandidate,
  dueCandidates,
  emptyObservation,
  fileStatusOf,
  identityMatches,
  mergeCandidate,
  type ObservationCandidate,
  scheduleScan,
} from "./observation.ts";
import {
  type ObservationSubmit,
  type ObserveDeps,
  observeRoot,
  readStably,
  type ScanEntry,
  type ScanPort,
  scanRoot,
  type WatchSignal,
} from "./work.ts";

function candidate(
  canonical: string,
  fact: ObservationCandidate["fact"],
  at: number,
): ObservationCandidate {
  return {
    root: "/work",
    canonical,
    relative: canonical.slice("/work/".length),
    fact,
    lastSignalMs: at,
    retries: 0,
  };
}

Deno.test("documents/file-tracking#R4: 같은 경로의 연속 변화는 하나로 합치고 삭제 뒤 재생성은 수정으로 숨기지 않는다", () => {
  const queue = emptyObservation("/work");
  mergeCandidate(queue, candidate("/work/a.md", "modified", 0));
  mergeCandidate(queue, candidate("/work/a.md", "modified", 100));
  assertEquals(queue.items.length, 1);
  assertEquals(queue.items[0].fact, "modified");
  mergeCandidate(queue, candidate("/work/a.md", "deleted", 200));
  mergeCandidate(queue, candidate("/work/a.md", "modified", 300));
  assertEquals(queue.items.length, 1);
  assertEquals(queue.items[0].fact, "recreated");
});

Deno.test("documents/file-tracking#R4: 750ms 조용한 후보만 관측하고 관측한 후보는 빠진다", () => {
  const queue = emptyObservation("/work");
  mergeCandidate(queue, candidate("/work/a.md", "modified", 0));
  mergeCandidate(queue, candidate("/work/b.md", "modified", 700));
  assertEquals(dueCandidates(queue, 750).map((item) => item.relative), [
    "a.md",
  ]);
  dropCandidate(queue, "/work/a.md");
  assertEquals(queue.items.map((item) => item.relative), ["b.md"]);
});

Deno.test("documents/file-tracking#R3: 진행 중인 scan은 다음 주기와 하나로 합친다", () => {
  assertEquals(scheduleScan(false, 0).merged, false);
  assertEquals(scheduleScan(true, 60_000).merged, true);
});

Deno.test("documents/file-tracking#R6: 열기 전과 읽기 뒤의 파일 식별이 다르면 같은 파일이 아니다", () => {
  const before = {
    realPath: "/work/a.md",
    device: 1,
    inode: 2,
    size: 3,
    mtimeMs: 4,
  };
  assertEquals(identityMatches(before, { ...before }), true);
  assertEquals(identityMatches(before, { ...before, inode: 9 }), false);
  assertEquals(identityMatches(before, { ...before, size: 8 }), false);
});

Deno.test("documents/file-tracking#R9: 파일 상태는 조회 때 계산하고 부재와 미확인을 구별한다", () => {
  const base = {
    tracked: true,
    missing: false,
    unverified: false,
    validationFailed: false,
    observedHash: "aa",
    latestHash: "aa",
  };
  assertEquals(fileStatusOf({ ...base, tracked: false }), "not_tracked");
  assertEquals(fileStatusOf(base), "tracked");
  assertEquals(
    fileStatusOf({ ...base, observedHash: "bb" }),
    "version_pending",
  );
  assertEquals(
    fileStatusOf({ ...base, validationFailed: true }),
    "validation_failed",
  );
  assertEquals(fileStatusOf({ ...base, missing: true }), "source_missing");
  assertEquals(
    fileStatusOf({ ...base, missing: true, unverified: true }),
    "unverified",
  );
});

Deno.test("documents/file-tracking#R8: 규칙·연결·보관·root가 바뀌면 관측 근거는 늦다", () => {
  const basis = {
    project: "prj_1",
    projectRevision: "1",
    path: "/work/a.md",
    documentRevision: "2",
    active: true,
    archived: false,
    rootPresent: true,
  };
  assertEquals(basisChanged(basis, basis), false);
  assertEquals(basisChanged(basis, { ...basis, projectRevision: "3" }), true);
  assertEquals(basisChanged(basis, { ...basis, archived: true }), true);
  assertEquals(basisChanged(basis, { ...basis, rootPresent: false }), true);
});

function memoryScan(tree: Record<string, ScanEntry[]>): ScanPort {
  return {
    list(_root, directory) {
      return Promise.resolve(ok(tree[directory] ?? []));
    },
    gitignore() {
      return Promise.resolve(ok(null));
    },
  };
}

Deno.test("documents/file-tracking#R3: scan은 규칙에 맞는 파일만 남기고 .git과 root 밖 symlink를 뺀다", async () => {
  const port = memoryScan({
    "": [
      { name: "notes.md", kind: "file" },
      { name: "skip.txt", kind: "file" },
      { name: ".git", kind: "directory" },
      {
        name: "outside",
        kind: "symlink",
        realPath: "/other/place",
        targetKind: "file",
      },
    ],
    ".git": [{ name: "config", kind: "file" }],
  });
  const scanned = await scanRoot(port, {
    root: "/work",
    patterns: [{ glob: "**/*.md", effect: "include" }],
    useGitignore: false,
    enabled: true,
  });
  assert(scanned.ok);
  assertEquals(scanned.value.map((file) => file.relative), ["notes.md"]);
});

Deno.test("documents/file-tracking#R3: 이름이 접두사인 형제 폴더와 root 밖 symlink는 추적하지 않는다", async () => {
  const port = memoryScan({
    "": [
      {
        name: "alias",
        kind: "symlink",
        realPath: "/work2/secret.md",
        targetKind: "file",
      },
      {
        name: "inside",
        kind: "symlink",
        realPath: "/work/notes.md",
        targetKind: "file",
      },
    ],
  });
  const scanned = await scanRoot(port, {
    root: "/work",
    patterns: [{ glob: "**/*", effect: "include" }],
    useGitignore: false,
    enabled: true,
  });
  assert(scanned.ok);
  assertEquals(scanned.value.map((file) => file.relative), ["inside"]);
});

Deno.test("documents/file-tracking#R6: 읽는 동안 바뀐 파일은 확정하지 않고 unverified로 남긴다", async () => {
  let opened = 0;
  const outcome = await readStably({
    open() {
      opened += 1;
      return Promise.resolve(ok({
        before: {
          realPath: "/work/a.md",
          device: 1,
          inode: 1,
          size: 1,
          mtimeMs: 1,
        },
        read: () => Promise.resolve(ok(new Uint8Array([1]))),
      }));
    },
    identity() {
      return Promise.resolve(ok({
        realPath: "/work/a.md",
        device: 1,
        inode: 2,
        size: 1,
        mtimeMs: 1,
      }));
    },
    hash: () => Promise.resolve("ab".repeat(32)),
  }, "/work/a.md");
  assert(outcome.ok);
  assertEquals(outcome.value.kind, "unverified");
  assertEquals(opened, 3);
});

Deno.test("documents/file-tracking#R6: 같은 stream의 hash와 바이트가 안정 읽기 하나에서 나온다", async () => {
  const bytes = new Uint8Array([4, 5, 6]);
  const outcome = await readStably({
    open() {
      const identity = {
        realPath: "/work/a.md",
        device: 1,
        inode: 1,
        size: bytes.length,
        mtimeMs: 1,
      };
      return Promise.resolve(ok({
        before: identity,
        read: () => Promise.resolve(ok(bytes) as Result<Uint8Array>),
      }));
    },
    identity() {
      return Promise.resolve(ok({
        realPath: "/work/a.md",
        device: 1,
        inode: 1,
        size: bytes.length,
        mtimeMs: 1,
      }));
    },
    hash: (body) => Promise.resolve(`len-${body.length}`),
  }, "/work/a.md");
  assert(outcome.ok);
  if (outcome.value.kind !== "stable") throw new Error("expected stable");
  assertEquals(outcome.value.read.hash, "len-3");
  assertEquals(outcome.value.read.bytes, bytes);
});

// 신호를 직접 넣는 watch. 배열은 한 번에 흐르고, gate는 호출자가 신호를 나중에
// 넣는다. 넣은 신호는 순서대로 흐르고, close하면 루프가 끝난다.
function gatedWatch(): {
  watch: ObserveDeps["watch"];
  push(signal: WatchSignal): void;
  close(): void;
  ready(): number;
} {
  const queued: WatchSignal[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  return {
    push(signal) {
      queued.push(signal);
      wake?.();
    },
    ready() {
      return queued.length;
    },
    close() {
      closed = true;
      wake?.();
    },
    watch: {
      watch() {
        return {
          async *[Symbol.asyncIterator]() {
            while (true) {
              const next = queued.shift();
              if (next !== undefined) {
                yield next;
                continue;
              }
              if (closed) return;
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
          },
        };
      },
    },
  };
}

function scriptedWatch(signals: WatchSignal[]): ObserveDeps["watch"] {
  return {
    watch() {
      return {
        async *[Symbol.asyncIterator]() {
          for (const signal of signals) yield signal;
        },
      };
    },
  };
}

const BASIS = {
  project: "prj_1",
  projectRevision: "1",
  path: "/work/a.md",
  documentRevision: "1",
  active: true,
  archived: false,
  rootPresent: true,
};

// 호출할 때마다 시간이 흐른다. 신호 시각과 조용함 판정이 다른 시각이 된다.
function movingClock(start: number): () => number {
  let now = start;
  return () => {
    now += 1_000;
    return now;
  };
}

function observeDeps(
  watch: ObserveDeps["watch"],
  submit: (submission: ObservationSubmit) => Promise<Result<void>>,
  nowMs: () => number,
): ObserveDeps {
  return {
    watch,
    scan: memoryScan({}),
    read: {
      open: () =>
        Promise.resolve(ok({
          before: {
            realPath: "/work/a.md",
            device: 1,
            inode: 1,
            size: 1,
            mtimeMs: 1,
          },
          read: () => Promise.resolve(ok(new Uint8Array([1]))),
        })),
      identity: () =>
        Promise.resolve(ok({
          realPath: "/work/a.md",
          device: 1,
          inode: 1,
          size: 1,
          mtimeMs: 1,
        })),
      hash: () => Promise.resolve("ab".repeat(32)),
    },
    nowMs,
    submit,
    basisFor: () => BASIS,
  };
}

Deno.test("documents/file-tracking#R3: watch 넘침은 개별 후보를 버리고 전체를 다시 대조한다", async () => {
  const submitted: string[] = [];
  const now = 1_000;
  await observeRoot(
    observeDeps(
      scriptedWatch([{ kind: "overflow" }]),
      (submission) => {
        submitted.push(submission.candidate.relative);
        return Promise.resolve(ok(undefined));
      },
      () => now,
    ),
    {
      root: "/work",
      patterns: [{ glob: "**/*", effect: "include" }],
      useGitignore: false,
      enabled: true,
    },
  );
  // overflow 뒤 scan이 비어 있으므로 제출은 없다. 넘친 신호를 후보로 남기지 않는다.
  assertEquals(submitted, []);
});

Deno.test("documents/file-tracking#R4: 후보 한도를 넘긴 뒤의 scan은 관측 제출을 다시 시작한다", async () => {
  // 시작 scan에만 있는 파일. 한도를 넘기는 신호는 scan에 없는 경로라, 제출되는
  // 것은 scan이 담은 파일뿐이다.
  const files: ScanEntry[] = [{ name: "before.md", kind: "file" }];
  const gate = gatedWatch();
  // 한도를 작게 넣어 10,000개를 흘리지 않는다. 넘침 동작은 한도 값과 무관하다.
  const limit = 4;
  const submitted: string[] = [];
  const stop = { stopped: false };
  // 시계와 tick을 테스트가 민다. tick은 시간을 안 움직여 60초 주기 scan이 돌지
  // 않고, 750ms 조용함은 quiet()가 한 번에 채운다. 벽시계를 쓰지 않는다.
  let now = 0;
  let release: (() => void) | undefined;
  const deps = observeDeps(
    { ...gate.watch, ready: gate.ready },
    (submission) => {
      submitted.push(submission.candidate.relative);
      return Promise.resolve(ok(undefined));
    },
    () => now,
  );
  deps.waitTick = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const quiet = () => {
    now += QUIET_MS;
  };
  deps.scan = memoryScan({ "": files });
  deps.stop = stop;
  deps.candidateLimit = limit;
  const running = observeRoot(deps, {
    root: "/work",
    patterns: [{ glob: "**/*.md", effect: "include" }],
    useGitignore: false,
    enabled: true,
  });
  const step = async () => {
    while (release === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const wait = release;
    release = undefined;
    wait();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  // 시작 scan의 제출이 나온 뒤에 한도 초과 대조가 끝날 때까지 진행한다.
  for (let tick = 0; tick < 4; tick++) await step();
  quiet();
  for (let tick = 0; tick < 8 && submitted.length === 0; tick++) await step();
  // 시작 scan이 제출된 뒤에야 한도를 넘긴다. 넘침 신호가 scan보다 먼저 오면
  // 시작 scan의 후보를 밀어내고 그 신호를 제출해 버린다. 이미 제출한 파일은
  // scan에서 빼 넘침 대조가 같은 파일을 다시 담지 않게 한다.
  files.splice(0, files.length, { name: "after.md", kind: "file" });
  for (let index = 0; index < limit + 1; index++) {
    gate.push({
      kind: "changed",
      canonical: `/work/n${index}.md`,
      relative: `n${index}.md`,
      fact: "modified",
    });
  }
  // 한도를 넘긴 뒤의 신호. 넘침 신호와 같이 넣어 대조가 끝난 뒤 처리되게 한다.
  // flag가 남아 있으면 dueCandidates가 빈 배열을 돌려 이 신호는 제출되지 않는다.
  gate.push({
    kind: "changed",
    canonical: "/work/again.md",
    relative: "again.md",
    fact: "modified",
  });
  // 대조가 담은 파일이 제출된 뒤에 넘침 뒤 신호의 조용함을 채운다. 그 전에
  // 채우면 넘침 신호까지 조용해져 한도에 닿기 전에 제출된다.
  for (let tick = 0; tick < 20 && submitted.length < 2; tick++) await step();
  quiet();
  // 넘침 뒤의 신호가 조용함 판정을 지나 제출될 때까지 진행한 뒤에 멈춘다.
  for (let tick = 0; tick < 20 && submitted.length < 3; tick++) await step();
  stop.stopped = true;
  gate.close();
  await step();
  await running;
  // 한도 초과가 rescan flag를 세운 채로 두면 이후 scan의 합치기가 전부 거절되어
  // 제출이 멈춘다. 시작 scan, 넘침 대조, 넘침 뒤의 신호가 각각 제출된다.
  // 한도를 넘긴 신호 자체는 scan에 없는 경로라 단언에서 뺀다.
  assertEquals(
    submitted.filter((path) => !path.startsWith("n")),
    ["before.md", "after.md", "again.md"],
  );
});

Deno.test("documents/file-tracking#R6: 읽는 중 교체된 파일은 unverified로 제출되고 확정되지 않는다", async () => {
  const submitted: ObservationSubmit[] = [];
  const deps = observeDeps(
    scriptedWatch([{
      kind: "changed",
      canonical: "/work/a.md",
      relative: "a.md",
      fact: "modified",
    }]),
    (submission) => {
      submitted.push(submission);
      return Promise.resolve(ok(undefined));
    },
    movingClock(0),
  );
  // 열기 전과 읽기 뒤의 inode가 다르다. 안정 읽기는 unverified로 끝난다.
  deps.read.identity = () =>
    Promise.resolve(ok({
      realPath: "/work/a.md",
      device: 1,
      inode: 9,
      size: 1,
      mtimeMs: 1,
    }));
  await observeRoot(deps, {
    root: "/work",
    patterns: [],
    useGitignore: false,
    enabled: true,
  });
  assertEquals(submitted.length, 1);
  assertEquals(submitted[0].outcome.kind, "unverified");
});

Deno.test("documents/file-tracking#R3: size·mtime가 같아도 주기 대조는 hash를 건너뛰지 않는다", async () => {
  const hashed: string[] = [];
  const deps = observeDeps(
    scriptedWatch([]),
    (submission) => {
      hashed.push(submission.candidate.relative);
      return Promise.resolve(ok(undefined));
    },
    movingClock(0),
  );
  // scan은 크기·시각을 보지 않고 규칙에 맞는 파일을 모두 후보로 올린다.
  deps.scan = memoryScan({
    "": [{ name: "a.md", kind: "file" }],
  });
  await observeRoot(deps, {
    root: "/work",
    patterns: [{ glob: "**/*.md", effect: "include" }],
    useGitignore: false,
    enabled: true,
  });
  assertEquals(hashed, ["a.md"]);
});

Deno.test("documents/file-tracking#R7: 준비와 확정 사이에 근거가 바뀌면 제출은 거절되고 다시 관측한다", async () => {
  const submitted: ObservationSubmit[] = [];
  await observeRoot(
    observeDeps(
      scriptedWatch([{
        kind: "changed",
        canonical: "/work/a.md",
        relative: "a.md",
        fact: "modified",
      }]),
      (submission) => {
        submitted.push(submission);
        // 확정 쪽이 규칙·연결·보관 변경으로 거절한 자리다.
        return Promise.resolve({
          ok: false,
          error: { code: "conflict", message: "basis changed" },
        });
      },
      movingClock(0),
    ),
    {
      root: "/work",
      patterns: [],
      useGitignore: false,
      enabled: true,
    },
  );
  assertEquals(submitted.length, 1);
  // 거절된 제출은 확정으로 세지 않는다. 후보는 큐에서 빠지고 다음 scan이 다시 본다.
  assertEquals(submitted[0].outcome.kind, "stable");
});
