import { assert, assertEquals } from "@std/assert";
import {
  connectDocumentsRelaunch,
  createLedgerRegistration,
  documentsWorkerRelaunch,
  workerSpecs,
} from "./documents.ts";

Deno.test("documents/file-tracking#R3: launch spec의 읽기·쓰기는 활성 root로 한정된다", () => {
  const specs = workerSpecs("/data/lophn", ["/work/notes", "/work/other"]);
  const coordinator = specs.find((spec) => spec.kind === "documents/worker");
  const preparation = specs.find((spec) =>
    spec.kind === "documents/preparation"
  );
  // 사용자 root 읽기는 활성 root뿐이고, 그 뒤는 코드·deno 캐시다.
  assertEquals(coordinator?.allow_read.slice(0, 3), [
    "/data/lophn",
    "/work/notes",
    "/work/other",
  ]);
  assertEquals(coordinator?.allow_read.length, 5);
  assertEquals(coordinator?.allow_write.includes("/work/notes"), true);
  assertEquals(preparation?.allow_read.includes("/work/other"), true);
  // network는 core loopback뿐이고 run은 format runner를 띄우는 deno 하나뿐이다(T11).
  assertEquals(coordinator?.allow_net, ["127.0.0.1"]);
  assertEquals(coordinator?.allow_run, [Deno.execPath()]);
  assertEquals(preparation?.allow_net, []);
});

Deno.test("documents/file-tracking#R3: root가 바뀌면 documents worker만 새 spec으로 다시 띄운다", async () => {
  const same = documentsWorkerRelaunch("/data/lophn", ["/work/a"], ["/work/a"]);
  assertEquals(same.kind, "unchanged");
  const relaunched: string[] = [];
  const decision = await connectDocumentsRelaunch(
    {
      updateSpec(spec) {
        relaunched.push(spec.kind);
        return Promise.resolve({ ok: true });
      },
    },
    "/data/lophn",
    ["/work/a"],
    ["/work/a", "/work/b"],
  );
  assertEquals(decision.kind, "relaunch");
  // documents worker만 다시 띄운다. 준비 worker는 감독이 따로 본다.
  assertEquals(relaunched, ["documents/worker"]);
  if (decision.kind === "relaunch") {
    const coordinator = decision.specs.find((spec) =>
      spec.kind === "documents/worker"
    );
    assert(coordinator?.allow_read.includes("/work/b"));
  }
});

Deno.test("documents/file-tracking#R3: 재시작이 실패하면 옛 권한으로 성공했다고 하지 않는다", async () => {
  const decision = await connectDocumentsRelaunch(
    { updateSpec: () => Promise.resolve({ ok: false }) },
    "/data/lophn",
    [],
    ["/work/a"],
  );
  assertEquals(decision.kind, "unavailable");
});

Deno.test("documents/file-tracking#R3: 활성 root가 없으면 data root만 허용한다", () => {
  const specs = workerSpecs("/data/lophn");
  const coordinator = specs.find((spec) => spec.kind === "documents/worker");
  assertEquals(coordinator?.allow_read[0], "/data/lophn");
  assertEquals(coordinator?.allow_read.length, 3);
  assertEquals(
    coordinator?.allow_write.some((path) => path.startsWith("/work")),
    false,
  );
});

Deno.test("documents/file-tracking#R3: root 집합이 바뀐 확인만 documents worker를 다시 띄운다", async () => {
  const { watchTrackingRoots } = await import("./documents-roots.ts");
  let current: string[] = ["/work/a"];
  const relaunched: string[][] = [];
  const watch = watchTrackingRoots({
    roots: () => Promise.resolve({ ok: true as const, value: current }),
    relaunch: (previous, next) =>
      connectDocumentsRelaunch(
        {
          updateSpec(spec) {
            relaunched.push([...spec.allow_read]);
            return Promise.resolve({ ok: true });
          },
        },
        "/data/lophn",
        previous,
        next,
      ),
    known: ["/work/a"],
    retryMs: 3_600_000,
  });
  try {
    await watch.check();
    assertEquals(relaunched.length, 0);
    current = ["/work/b", "/work/a"];
    await watch.check();
    assertEquals(relaunched.length, 1);
    assert(relaunched[0].includes("/work/b"));
    assertEquals(watch.known, ["/work/a", "/work/b"]);
    await watch.check();
    assertEquals(relaunched.length, 1);
  } finally {
    watch.stop();
  }
});

Deno.test("documents/file-tracking#R3: 재시작이 실패한 root 변화는 다음 확인에서 다시 시도한다", async () => {
  const { watchTrackingRoots } = await import("./documents-roots.ts");
  let healthy = false;
  let attempts = 0;
  const watch = watchTrackingRoots({
    roots: () => Promise.resolve({ ok: true as const, value: ["/work/a"] }),
    relaunch: (previous, next) =>
      connectDocumentsRelaunch(
        {
          updateSpec() {
            attempts += 1;
            return Promise.resolve({ ok: healthy });
          },
        },
        "/data/lophn",
        previous,
        next,
      ),
    known: [],
    retryMs: 3_600_000,
  });
  try {
    await watch.check();
    assertEquals(watch.known, []);
    healthy = true;
    await watch.check();
    assertEquals(attempts, 2);
    assertEquals(watch.known, ["/work/a"]);
  } finally {
    watch.stop();
  }
});

Deno.test("documents/file-tracking#R3: 실제 core는 tracking 규칙 변경 event를 받아 documents worker를 새 권한으로 다시 띄운다", async () => {
  const { startCore } = await import("./core.ts");
  const { manualClock, seededRandom } = await import(
    "../../packages/base/mod.ts"
  );
  const { previewTracking } = await import(
    "../../packages/documents/projects/work.ts"
  );
  const { directoryScanner } = await import(
    "../../packages/documents/projects/scan.ts"
  );
  const home = await Deno.makeTempDir({ prefix: "lophn-docs-roots-" });
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-docs-track-" }),
  );
  let hellos = 0;
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createLedgerRegistration }],
    teamModules: [new URL("./documents.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(9),
    testCredentials: true,
    onDocumentsHello: () => hellos += 1,
  });
  assert(started.ok);
  const core = started.value;
  try {
    assertEquals(hellos, 1);
    const token = "r".repeat(43);
    const context = {
      principal: "user",
      actor: "user" as const,
      credential_ref: "cred_roots_person",
      scope: {
        operations: ["project.create", "project.set_tracking"],
        targets: {},
      },
      conditions: {},
    };
    assert(core.acceptTestCredential);
    const accepted = await core.acceptTestCredential(context, token);
    assert(accepted.ok);
    const recorded = await core.record(context);
    assert(recorded.ok);
    const post = async (path: string, body: unknown) => {
      const response = await fetch(
        `http://127.0.0.1:${core.port}/v1/${path}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        },
      );
      return {
        status: response.status,
        body: await response.json() as Record<string, unknown>,
      };
    };
    // 사람이 프로젝트를 만들고 tracking을 켠다. 주기로 읽지 않으므로 이 command가 남긴
    // ProjectTrackingChanged event가 core 안 구독자를 깨워야 새 root가 보인다.
    const id = "prj_01kq12a1pha000000000000000";
    const folders = [{ path: folder, description: "a" }];
    const created = await post("projects/create", {
      input: {
        id,
        name: "alpha",
        title: "Alpha",
        purpose: "",
        folders,
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      },
      idempotency_key: "create-alpha",
      compare: {},
      prepared: [],
    });
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const revision = String(created.body["revision"]);
    const tracking = {
      enabled: true,
      patterns: [{ effect: "include" as const, glob: "**/*.md" }],
      use_gitignore: false,
    };
    const preview = previewTracking(directoryScanner(), {
      project: id,
      baseRevision: revision,
      folders,
      tracking,
      observedAt: "2026-10-06T00:00:00.000Z",
    });
    assert(preview.ok);
    const applied = await post("projects/set_tracking", {
      input: { project: id, folders, tracking, preview: preview.value },
      idempotency_key: "track-alpha",
      compare: { base_revision: revision },
      prepared: [],
    });
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    // 구독자가 event를 받고 worker가 새 권한으로 다시 뜬다.
    for (let waited = 0; waited < 120 && hellos < 2; waited++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assertEquals(hellos, 2);
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(folder, { recursive: true });
  }
});

Deno.test("documents/file-tracking#R3: 읽기·재시작이 실패하면 주기 읽기 없이 대기 뒤 스스로 다시 시도한다", async () => {
  const { watchTrackingRoots } = await import("./documents-roots.ts");
  let healthy = false;
  let reads = 0;
  const watch = watchTrackingRoots({
    roots: () => {
      reads += 1;
      return Promise.resolve(
        healthy ? { ok: true as const, value: ["/work/a"] } : {
          ok: false as const,
          error: { code: "unavailable" as const, message: "reader down" },
        },
      );
    },
    relaunch: () => Promise.resolve({ kind: "relaunch", specs: [] }),
    known: [],
    retryMs: 20,
  });
  try {
    await watch.check();
    assertEquals(reads, 1);
    healthy = true;
    for (let waited = 0; waited < 100 && watch.known.length === 0; waited++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // 시험이 다시 부르지 않아도 timer가 한 번 더 읽어 root를 맞췄다.
    assertEquals(watch.known, ["/work/a"]);
    const settled = reads;
    await new Promise((resolve) => setTimeout(resolve, 100));
    // 성공하면 timer를 남기지 않는다: 주기 읽기가 아니다.
    assertEquals(reads, settled);
  } finally {
    watch.stop();
  }
});

Deno.test("documents/file-tracking#R3: 확인 도중에 온 신호는 이미 읽은 값 뒤의 변화라 끝난 뒤 한 번 더 확인한다", async () => {
  const { watchTrackingRoots } = await import("./documents-roots.ts");
  let current = ["/work/a"];
  let release: (() => void) | undefined;
  let gate = new Promise<void>((resolve) => release = resolve);
  const seen: string[][] = [];
  const watch = watchTrackingRoots({
    roots: async () => {
      const value = [...current];
      await gate;
      return { ok: true as const, value };
    },
    relaunch: (_previous, next) => {
      seen.push([...next]);
      return Promise.resolve({ kind: "relaunch", specs: [] });
    },
    known: [],
    retryMs: 3_600_000,
  });
  try {
    const first = watch.check();
    // 첫 확인이 /work/a를 읽은 뒤에 root가 바뀌고 신호가 온다.
    current = ["/work/b"];
    const second = watch.check();
    gate = Promise.resolve();
    release?.();
    await Promise.all([first, second]);
    assertEquals(seen, [["/work/a"], ["/work/b"]]);
  } finally {
    watch.stop();
  }
});
