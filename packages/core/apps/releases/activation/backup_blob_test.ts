// 보호 backup blob(apps/data#R4, R5, domain-model apps/data DataBackup)을 실제 core(임시 LOPHN_HOME)와 실제 I/O
// worker로 본다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../../../base/mod.ts";
import {
  call,
  codeOf,
  command,
  inspect,
} from "../../../testing/approvals-fixture.ts";
import {
  prepare,
  recordBackup,
  start,
  startedSeq,
  withWorld,
} from "./world_test.ts";

const STEP = {
  from: 0,
  to: 1,
  script_hash: "d".repeat(64),
  description: "add the events table",
};

Deno.test("apps/data#R4, R5: record_backup은 backup byte를 일반 읽기가 없는 보호 blob으로 보존하고 그 hash만 ledger에 확정한다", async () => {
  await withWorld(async (world) => {
    const release = await prepare(world, {
      data_schema: 1,
      data_changes: [STEP],
    });
    const seq = startedSeq((await start(world, release, { schema: 0 })).reply);
    const content = "sqlite backup bytes";
    const saved = await recordBackup(world, release, seq, 0, content);
    assertEquals(saved.reply.status, 200, JSON.stringify(saved.reply.body));

    // 보존한 blob이 있고 hash·크기가 byte와 같다. ledger가 가리키는 hash는 그 blob의 hash다.
    const bytes = new TextEncoder().encode(content);
    assertEquals(saved.hash, await sha256Hex(bytes));
    const refs = inspect(
      world.harness,
      `SELECT owner_kind, owner_key, field, hash, size_bytes FROM blob_refs
        WHERE owner_kind = 'release_backup'`,
      [],
    );
    assertEquals(refs.length, 1);
    assertEquals(refs[0]["owner_key"], `${release}:${seq}`);
    assertEquals(refs[0]["field"], "backup");
    assertEquals(refs[0]["hash"], saved.hash);
    assertEquals(Number(refs[0]["size_bytes"]), bytes.length);
    const stored = await Deno.readFile(
      // blob은 data root의 `blobs/sha256/<hash 앞 2자>/<나머지 62자>`에 저장된다.
      `${world.harness.dataRoot}/blobs/sha256/${saved.hash.slice(0, 2)}/${
        saved.hash.slice(2)
      }`,
    );
    assertEquals(await sha256Hex(stored), saved.hash);
    assertEquals(stored.length, bytes.length);
    const activation = JSON.parse(String(
      inspect(world.harness, "SELECT activation FROM releases WHERE id = ?", [
        release,
      ])[0]["activation"],
    ));
    assertEquals(activation.backup_hash, saved.hash);

    // 일반 blob 읽기 경로로는 어떤 자격도 이 byte를 읽지 못한다.
    const reader = await world.harness.credential({
      actor: "user",
      principal: "reader",
      scope: { operations: ["blobs/read"], targets: {} },
      conditions: {},
    });
    assert(reader.ok);
    const read = await call(world.harness, "blobs/read", reader.value.token, {
      owner_kind: "release_backup",
      owner_key: `${release}:${seq}`,
      field: "backup",
      offset_bytes: 0,
      length_bytes: bytes.length,
    });
    assertEquals(read.status, 403, JSON.stringify(read.body));
    assertEquals(codeOf(read), "forbidden");
  });
});

Deno.test("apps/data#R4: 보존하지 않은 blob의 hash나 다른 purpose·준비 주체의 blob은 backup 참조가 되지 못한다", async () => {
  await withWorld(async (world) => {
    const release = await prepare(world, {
      data_schema: 1,
      data_changes: [STEP],
    });
    const seq = startedSeq((await start(world, release, { schema: 0 })).reply);
    const record = (body: Record<string, unknown>) =>
      call(
        world.harness,
        "releases/record_backup",
        world.machine.token,
        command({
          release,
          activation_seq: seq,
          data_schema: 0,
          ...body,
        }),
      );
    const prepared = async (principal: string, purpose: string) => {
      const made = await world.harness.prepareBlob({
        principal,
        purpose,
        bytes: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(`${principal}${purpose}`),
            );
            controller.close();
          },
        }),
      });
      assert(made.ok, made.ok ? "" : made.error.message);
      return made.value;
    };
    // blob이 가리키는 hash와 다른 hash를 ledger에 두려는 주장.
    const real = await prepared(world.machine.context.principal, "app_backup");
    const lie = await record({ backup_hash: "e".repeat(64), blob: real });
    assertEquals(codeOf(lie), "invalid_input", JSON.stringify(lie.body));
    // 다른 목적으로 준비한 blob.
    const other = await prepared(
      world.machine.context.principal,
      "document_file",
    );
    const wrongPurpose = await record({ backup_hash: other.hash, blob: other });
    assertEquals(codeOf(wrongPurpose), "invalid_input");
    // 다른 주체가 준비한 blob.
    const foreign = await prepared("someone-else", "app_backup");
    const wrongPrincipal = await record({
      backup_hash: foreign.hash,
      blob: foreign,
    });
    assert(wrongPrincipal.status >= 400, JSON.stringify(wrongPrincipal.body));
    // 어느 경우에도 참조도 backup 확정도 없다.
    assertEquals(
      inspect(
        world.harness,
        "SELECT COUNT(*) AS n FROM blob_refs WHERE owner_kind = 'release_backup'",
        [],
      )[0]["n"],
      0,
    );
    assertEquals(
      inspect(
        world.harness,
        "SELECT COUNT(*) AS n FROM app_data_records",
        [],
      )[0]["n"],
      0,
    );
  });
});
