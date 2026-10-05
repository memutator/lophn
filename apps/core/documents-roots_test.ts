import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
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
    intervalMs: 3_600_000,
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
    intervalMs: 3_600_000,
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

Deno.test("documents/file-tracking#R3: 실제 core는 등록 프로젝트의 tracking root가 생기면 documents worker를 다시 띄운다", async () => {
  const { startCore } = await import("./core.ts");
  const { manualClock, seededRandom } = await import(
    "../../packages/base/mod.ts"
  );
  const home = await Deno.makeTempDir({ prefix: "lophn-docs-roots-" });
  const folder = await Deno.makeTempDir({ prefix: "lophn-docs-track-" });
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
    // tracking 켜기는 worker 미리보기가 필요하다(preview route 연결은 T11 남은 것).
    // 켠 상태의 ledger 행을 시험이 직접 둔다: 등록 폴더와 켜진 tracking이 전부다.
    const db = new DatabaseSync(`${home}/lophn.db`);
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      db.prepare(
        `INSERT INTO projects (id, name, title, purpose, tracking_enabled, use_gitignore, revision, status)
         VALUES ('prj_01kq12a1pha000000000000000', 'alpha', 'Alpha', '', 1, 0, '1', 'active')`,
      ).run();
      db.prepare(
        `INSERT INTO project_folders (project, position, path, description)
         VALUES ('prj_01kq12a1pha000000000000000', 0, ?, 'a')`,
      ).run(folder);
    } finally {
      db.close();
    }
    // 확인 주기(2초) 안에 새 root가 보이고 worker가 새 권한으로 다시 뜬다.
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
