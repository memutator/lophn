import { assert, assertEquals } from "@std/assert";
import {
  connectDocumentsRelaunch,
  documentsWorkerRelaunch,
  workerSpecs,
} from "./documents.ts";

Deno.test("documents/file-tracking#R3: launch spec의 읽기·쓰기는 활성 root로 한정된다", () => {
  const specs = workerSpecs("/data/lophn", ["/work/notes", "/work/other"]);
  const coordinator = specs.find((spec) => spec.kind === "documents/worker");
  const preparation = specs.find((spec) =>
    spec.kind === "documents/preparation"
  );
  assertEquals(coordinator?.allow_read, [
    "/data/lophn",
    "/work/notes",
    "/work/other",
  ]);
  assertEquals(coordinator?.allow_write.includes("/work/notes"), true);
  assertEquals(preparation?.allow_read.includes("/work/other"), true);
  // network는 core loopback뿐이고 run은 승인된 Deno 실행 파일뿐이다(T11).
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
  assertEquals(coordinator?.allow_read, ["/data/lophn"]);
  assertEquals(
    coordinator?.allow_write.some((path) => path.startsWith("/work")),
    false,
  );
});
