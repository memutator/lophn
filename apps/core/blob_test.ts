// blob 읽기의 실제 core 경로 테스트(platform/blob-store#R5, R6, R7,
// platform/identity#R9). 등록은 ledger transaction 테스트가 맡는다.

import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { createCoreHarness } from "./testing/core.ts";
import { defineBlobField } from "../../packages/contracts/platform/mod.ts";

const HASH_BYTES = new TextEncoder().encode("blob body");

const field = defineBlobField({
  owner_kind: "document_version",
  field: "file",
  retention: { kind: "permanent" },
  general_read: true,
});
const sealed = defineBlobField({
  owner_kind: "backup",
  field: "archive",
  retention: { kind: "permanent" },
  general_read: false,
});

Deno.test("platform/blob-store#R5 #R6 #R7 platform/identity#R9: core는 등록된 blob만 읽고 권한 밖과 부재를 거절한다", async () => {
  const harness = await createCoreHarness({
    teams: [{
      createCoreRegistration: () => ({ blobFields: [field, sealed] }),
    }],
  });
  assert(harness.ok);
  try {
    const allowed = await harness.value.credential({
      actor: "user",
      principal: "user-1",
      scope: {
        operations: ["blobs/read"],
        targets: { owner_key: "ver_1" },
      },
      conditions: {},
    });
    assert(allowed.ok);
    const denied = await harness.value.credential({
      actor: "user",
      principal: "user-2",
      scope: {
        operations: ["blobs/read"],
        targets: { owner_key: "ver_2" },
      },
      conditions: {},
    });
    assert(denied.ok);
    const hash = await sha256(HASH_BYTES);
    const directory = `${harness.value.dataRoot}/blobs/sha256/${
      hash.slice(0, 2)
    }`;
    await Deno.mkdir(directory, { recursive: true });
    await Deno.writeFile(`${directory}/${hash.slice(2)}`, HASH_BYTES);
    seedRef(harness.value.dataRoot, field.owner_kind, "file", hash);
    seedRef(harness.value.dataRoot, sealed.owner_kind, "archive", hash);

    const read = await post(harness.value.port, {
      owner_kind: field.owner_kind,
      owner_key: "ver_1",
      field: field.field,
      offset_bytes: 0,
      length_bytes: HASH_BYTES.length,
    }, allowed.value.token);
    assertEquals(read.status, 200);
    const body = read.body as {
      status: string;
      bytes?: string;
      truncated?: boolean;
      size_bytes?: number;
    };
    assertEquals(body.status, "available");
    assertEquals(body.bytes, btoa("blob body"));
    assertEquals(body.truncated, false);
    assertEquals(body.size_bytes, HASH_BYTES.length);

    // hash를 알아도 scope 밖 주체는 읽지 못한다(R5, identity R9).
    const forbidden = await post(harness.value.port, {
      owner_kind: field.owner_kind,
      owner_key: "ver_1",
      field: field.field,
      offset_bytes: 0,
      length_bytes: HASH_BYTES.length,
    }, denied.value.token);
    assertEquals(forbidden.status, 403);

    // 일반 읽기를 막은 field는 허용 주체도 읽지 못한다.
    const sealedRead = await post(harness.value.port, {
      owner_kind: sealed.owner_kind,
      owner_key: "ver_1",
      field: sealed.field,
      offset_bytes: 0,
      length_bytes: HASH_BYTES.length,
    }, allowed.value.token);
    assertEquals(sealedRead.status, 403);

    // 참조된 파일이 없으면 unavailable이고 빈 내용을 주지 않는다(R6).
    await Deno.remove(`${directory}/${hash.slice(2)}`);
    const gone = await post(harness.value.port, {
      owner_kind: field.owner_kind,
      owner_key: "ver_1",
      field: field.field,
      offset_bytes: 0,
      length_bytes: HASH_BYTES.length,
    }, allowed.value.token);
    assertEquals(gone.status, 200);
    assertEquals(
      (gone.body as { status: string }).status,
      "unavailable",
    );
    assertEquals((gone.body as { reason?: string }).reason, "missing");
  } finally {
    await harness.value.close();
  }
});

// 등록 transaction이 만든 참조 행과 같은 모양으로 심는다. 등록 자체는
// refs_sqlite_test.ts가 같은 transaction에서 검증한다.
function seedRef(
  dataRoot: string,
  ownerKind: string,
  name: string,
  hash: string,
): void {
  const db = new DatabaseSync(`${dataRoot}/lophn.db`);
  try {
    db.prepare(
      `insert into events (type, subject, actor, payload, at)
       values ('BlobAttached', 'ver_1', 'user', '{}', '2026-01-01T00:00:00.000Z')`,
    ).run();
    const seq = db.prepare(`select last_insert_rowid() as seq`).get() as {
      seq: number;
    };
    db.prepare(
      `insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes, registered_seq)
       values (?, 'ver_1', ?, ?, ?, ?)`,
    ).run(ownerKind, name, hash, HASH_BYTES.length, seq.seq);
  } finally {
    db.close();
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function post(
  port: number,
  body: unknown,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/blobs/read`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
