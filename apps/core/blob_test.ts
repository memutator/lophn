// blob 읽기의 실제 core 경로 테스트(platform/blob-store#R5, R6, R7,
// platform/identity#R9). 등록은 ledger transaction 테스트가 맡는다.

import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import { startCore } from "./core.ts";
import {
  BLOB_READ_MAX_BYTES,
  defineBlobField,
} from "../../packages/protocol/server/mod.ts";

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
  const home = await Deno.makeTempDir({ prefix: "lophn-blob-read-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{
      createCoreRegistration: () => ({ blobFields: [field, sealed] }),
    }],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(1),
    testCredentials: true,
  });
  assert(started.ok);
  const core = started.value;
  try {
    const allowed = await credential(core, {
      actor: "user",
      principal: "user-1",
      scope: {
        operations: ["blobs/read"],
        targets: { owner_key: "ver_1" },
      },
      conditions: {},
    });
    assert(allowed.ok);
    const denied = await credential(core, {
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
    const directory = `${core.dataRoot}/blobs/sha256/${hash.slice(0, 2)}`;
    await Deno.mkdir(directory, { recursive: true });
    await Deno.writeFile(`${directory}/${hash.slice(2)}`, HASH_BYTES);
    seedRef(core.dataRoot, field.owner_kind, "file", hash);
    seedRef(core.dataRoot, sealed.owner_kind, "archive", hash);

    const read = await post(core.port, {
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
    const forbidden = await post(core.port, {
      owner_kind: field.owner_kind,
      owner_key: "ver_1",
      field: field.field,
      offset_bytes: 0,
      length_bytes: HASH_BYTES.length,
    }, denied.value.token);
    assertEquals(forbidden.status, 403);

    // 일반 읽기를 막은 field는 허용 주체도 읽지 못한다.
    const sealedRead = await post(core.port, {
      owner_kind: sealed.owner_kind,
      owner_key: "ver_1",
      field: sealed.field,
      offset_bytes: 0,
      length_bytes: HASH_BYTES.length,
    }, allowed.value.token);
    assertEquals(sealedRead.status, 403);

    // 참조된 파일이 없으면 unavailable이고 빈 내용을 주지 않는다(R6).
    await Deno.remove(`${directory}/${hash.slice(2)}`);
    const gone = await post(core.port, {
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
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

// 한 창의 상한(256KiB)을 그대로 읽는다. worker 응답은 base64로 커지므로 감독
// control frame 한도와 맞물린다. fake bytes.read는 이 경로를 지나지 않는다.
Deno.test("platform/blob-store#R7: core는 256KiB 읽기 창 전체를 실제 I/O worker로 돌려준다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-blob-window-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{
      createCoreRegistration: () => ({ blobFields: [field] }),
    }],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(1),
    testCredentials: true,
  });
  assert(started.ok);
  const core = started.value;
  try {
    const allowed = await credential(core, {
      actor: "user",
      principal: "user-1",
      scope: {
        operations: ["blobs/read"],
        targets: { owner_key: "ver_1" },
      },
      conditions: {},
    });
    assert(allowed.ok);
    const body = new Uint8Array(BLOB_READ_MAX_BYTES);
    for (let i = 0; i < body.length; i++) body[i] = i % 251;
    const hash = await sha256(body);
    const directory = `${core.dataRoot}/blobs/sha256/${hash.slice(0, 2)}`;
    await Deno.mkdir(directory, { recursive: true });
    await Deno.writeFile(`${directory}/${hash.slice(2)}`, body);
    seedRef(core.dataRoot, field.owner_kind, "file", hash, body.length);

    const read = await post(core.port, {
      owner_kind: field.owner_kind,
      owner_key: "ver_1",
      field: field.field,
      offset_bytes: 0,
      length_bytes: body.length,
    }, allowed.value.token);
    assertEquals(read.status, 200);
    const answer = read.body as {
      status: string;
      bytes?: string;
      length_bytes?: number;
      size_bytes?: number;
      truncated?: boolean;
      reason?: string;
    };
    assertEquals(answer.status, "available");
    assertEquals(answer.truncated, false);
    assertEquals(answer.length_bytes, BLOB_READ_MAX_BYTES);
    assertEquals(answer.size_bytes, BLOB_READ_MAX_BYTES);
    const decoded = Uint8Array.from(
      atob(answer.bytes ?? ""),
      (c) => c.charCodeAt(0),
    );
    assertEquals(decoded, body);
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

async function credential(
  core: {
    acceptTestCredential?(
      context: {
        principal: string;
        actor: "user";
        credential_ref: string;
        scope: { operations: string[]; targets: Record<string, string> };
        conditions: Record<string, never>;
      },
      token: string,
    ): Promise<{ ok: boolean }>;
    record(context: {
      principal: string;
      actor: "user";
      credential_ref: string;
      scope: { operations: string[]; targets: Record<string, string> };
      conditions: Record<string, never>;
    }): Promise<{ ok: boolean }>;
  },
  input: {
    actor: "user";
    principal: string;
    scope: { operations: string[]; targets: Record<string, string> };
    conditions: Record<string, never>;
  },
): Promise<{ ok: true; value: { token: string } } | { ok: false }> {
  const token = input.principal === "user-1" ? "a".repeat(43) : "b".repeat(43);
  const context = {
    principal: input.principal,
    actor: input.actor,
    credential_ref: `cred_${input.principal}`,
    scope: input.scope,
    conditions: input.conditions,
  };
  assert(core.acceptTestCredential);
  const accepted = await core.acceptTestCredential(context, token);
  if (!accepted.ok) return { ok: false };
  const recorded = await core.record(context);
  if (!recorded.ok) return { ok: false };
  return { ok: true, value: { token } };
}

// 등록 transaction이 만든 참조 행과 같은 모양으로 심는다. 등록 자체는
// refs_sqlite_test.ts가 같은 transaction에서 검증한다.
function seedRef(
  dataRoot: string,
  ownerKind: string,
  name: string,
  hash: string,
  sizeBytes: number = HASH_BYTES.length,
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
    ).run(ownerKind, name, hash, sizeBytes, seq.seq);
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
