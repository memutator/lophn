// format module 묶음의 blob 보존과 hash 되찾기(documents/formats#R20).
// harness의 notePrepared나 ledger 직접 insert는 쓰지 않는다.
// 준비는 core.prepareBlob(pipe, purpose format_module)이고, 등록은 command
// transaction이며, 되찾기는 /v1/blobs/read로 읽은 바이트에서 hash로 찾는다.
// 없는 hash는 누락이고 최신 module로 대체하지 않는다.

import { assert, assertEquals } from "@std/assert";
import { err, manualClock, ok, seededRandom } from "../../packages/base/mod.ts";
import {
  BUILTIN_MODULE_HASH,
  moduleHash,
} from "../../packages/documents/formats/guest/module-hash.ts";
import {
  type ModuleBytes,
  moduleFrom,
} from "../../packages/documents/formats/module-store.ts";
import type { TeamModule } from "./registration.ts";
import { startCore } from "./core.ts";
import { createCoreRegistration } from "./testing/module-registration.ts";

async function bundleBytes(): Promise<Uint8Array> {
  const bundle = await Deno.readTextFile(
    new URL(
      "../../packages/documents/formats/guest/bundle.js",
      import.meta.url,
    ),
  );
  return new TextEncoder().encode(bundle);
}

Deno.test("documents/formats#R20: module 묶음을 purpose format_module로 보존하고 hash로 되찾는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-module-blob-" });
  const bytes = await bundleBytes();
  assertEquals(
    moduleHash(new TextDecoder().decode(bytes)),
    BUILTIN_MODULE_HASH,
  );
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createCoreRegistration } as TeamModule],
    teamModules: [
      new URL("./testing/module-registration.ts", import.meta.url)
        .href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(1),
    testCredentials: true,
  });
  assert(started.ok);
  const core = started.value;
  try {
    assert(core.acceptTestCredential);
    const token = "a".repeat(43);
    const context = {
      principal: "user-1",
      actor: "user" as const,
      credential_ref: "cred_moduleblob1",
      scope: {
        operations: ["moduleref.attach", "blobs/read"],
        targets: {},
      },
      conditions: {},
    };
    const accepted = await core.acceptTestCredential(context, token);
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const recorded = await core.record(context);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);

    // 묶음 준비. purpose는 platform blob의 `format_module`이다. blob store의
    // 주소는 원문 바이트의 sha256(content hash)이고 module_hash는 묶음 계약
    // version을 덮는 별개 hash다. 등록된 크기와 bundle_hash로 module_hash를 검증한다.
    const prepared = await core.prepareBlob({
      principal: "user-1",
      purpose: "format_module",
      bytes: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    });
    assert(prepared.ok, prepared.ok ? "" : prepared.error.message);
    // content hash는 module_hash와 다르고, 되찾은 바이트의 moduleHash가
    // BUILTIN_MODULE_HASH와 같아야 한다(R19의 재현 가능 bundle 규약).
    assert(prepared.value.hash !== BUILTIN_MODULE_HASH);

    // 등록은 command transaction이다. owner_key는 Version이 참조하는 module의 주소다.
    const attached = await post(core.port, "/v1/moduleref/attach", {
      input: {
        owner_key: "mod:1",
        prepared: prepared.value,
      },
      idempotency_key: "attach-module-1",
      compare: {},
      prepared: [],
    }, token);
    assertEquals(attached.status, 200, JSON.stringify(attached.body));

    // 되찾기: /v1/blobs/read가 참조 행의 그 바이트를 돌려 준다. 묶음을 구간으로
    // 읽어 이어 붙인다. worker_response frame은 supervision의 256KiB control
    // 한도를 넘을 수 없으므로 요청 구간도 그 안으로 유지한다.
    const WINDOW = 64 * 1024;
    const readBytes = new Uint8Array(bytes.length);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await post(core.port, "/v1/blobs/read", {
        owner_kind: "format_module",
        owner_key: "mod:1",
        field: "bundle",
        offset_bytes: offset,
        length_bytes: Math.min(WINDOW, bytes.length - offset),
      }, token);
      assertEquals(read.status, 200, JSON.stringify(read.body));
      const body = read.body as {
        status: string;
        bytes?: string;
        truncated?: boolean;
        size_bytes?: number;
      };
      assertEquals(body.status, "available");
      assert(body.bytes !== undefined);
      const raw = atob(body.bytes);
      const chunk = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) chunk[i] = raw.charCodeAt(i);
      readBytes.set(chunk, offset);
      offset += chunk.length;
    }
    assertEquals(offset, bytes.length);

    // hash로 다시 찾는다. ModuleBytes의 key는 module_hash고 value.hash도
    // module_hash 다. blob store의 content hash(bundle 바이트의 sha256)와 별개다.
    // 옛 version의 module이 내장과 같으면 내장 StoredModule을, 아니면
    // 등록된 참조의 바이트를 돌려 준다(R20 최신 module로 대체하지 않음).
    // 여기서는 directive 주석의 contract 1을 0으로 바꿔 옛 module을 재현하고
    // 다시 사라지지 않음을 본다.
    const oldBundle = new TextDecoder().decode(bytes).replace(
      "contract 1",
      "contract 0",
    );
    const oldBytes = new TextEncoder().encode(oldBundle);
    const oldHash = moduleHash(oldBundle);
    assert(oldHash !== BUILTIN_MODULE_HASH);
    const oldPrepared = await core.prepareBlob({
      principal: "user-1",
      purpose: "format_module",
      bytes: new ReadableStream({
        start(controller) {
          controller.enqueue(oldBytes);
          controller.close();
        },
      }),
    });
    assert(oldPrepared.ok, oldPrepared.ok ? "" : oldPrepared.error.message);
    const attachedOld = await post(core.port, "/v1/moduleref/attach", {
      input: {
        owner_key: "mod:old",
        prepared: oldPrepared.value,
      },
      idempotency_key: "attach-module-old",
      compare: {},
      prepared: [],
    }, token);
    assertEquals(attachedOld.status, 200, JSON.stringify(attachedOld.body));
    const oldReadBytes = new Uint8Array(oldBytes.length);
    let oldOffset = 0;
    while (oldOffset < oldBytes.length) {
      const read = await post(core.port, "/v1/blobs/read", {
        owner_kind: "format_module",
        owner_key: "mod:old",
        field: "bundle",
        offset_bytes: oldOffset,
        length_bytes: Math.min(WINDOW, oldBytes.length - oldOffset),
      }, token);
      assertEquals(read.status, 200, JSON.stringify(read.body));
      const body = read.body as {
        status: string;
        bytes?: string;
      };
      assertEquals(body.status, "available");
      assert(body.bytes !== undefined);
      const raw = atob(body.bytes);
      const chunk = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) chunk[i] = raw.charCodeAt(i);
      oldReadBytes.set(chunk, oldOffset);
      oldOffset += chunk.length;
    }
    assertEquals(oldOffset, oldBytes.length);
    const restored: ModuleBytes = {
      read(hash) {
        return Promise.resolve(
          hash === oldHash
            ? ok({ hash, sizeBytes: oldReadBytes.length, bytes: oldReadBytes })
            : err({ code: "not_found", message: "blob이 없다" }),
        );
      },
    };
    const found = await moduleFrom(oldHash, restored);
    assert(found.found);
    assertEquals(found.module.hash, oldHash);
    // TextDecoder는 4바이트 UTF-8을 2 code unit으로 세므로 byte length로 비교한다.
    assertEquals(
      new TextEncoder().encode(found.module.bundle).length,
      oldBytes.length,
    );
    // 되찾은 bundle도 계약 hash가 같다(같은 묶음이다).
    assertEquals(
      moduleHash(found.module.bundle),
      oldHash,
    );
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("documents/formats#R20: 등록되지 않은 module hash는 누락이고 최신 module로 대체하지 않는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-module-blob-missing-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createCoreRegistration } as TeamModule],
    teamModules: [
      new URL("./testing/module-registration.ts", import.meta.url)
        .href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(1),
    testCredentials: true,
  });
  assert(started.ok);
  const core = started.value;
  try {
    assert(core.acceptTestCredential);
    const token = "a".repeat(43);
    const context = {
      principal: "user-1",
      actor: "user" as const,
      credential_ref: "cred_moduleblob2",
      scope: {
        operations: ["moduleref.attach", "blobs/read"],
        targets: {},
      },
      conditions: {},
    };
    const accepted = await core.acceptTestCredential(context, token);
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const recorded = await core.record(context);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);

    // 참조가 없는 owner의 read는 not_found다.
    const read = await post(core.port, "/v1/blobs/read", {
      owner_kind: "format_module",
      owner_key: "mod:absent",
      field: "bundle",
      offset_bytes: 0,
      length_bytes: 1024,
    }, token);
    assertEquals(read.status, 404, JSON.stringify(read.body));
    assertEquals(
      (read.body as { error?: { code?: string } }).error?.code,
      "not_found",
    );

    // 되찾기도 누락이다. 최신 module(내장)로 대체하지 않는다.
    const absent: ModuleBytes = {
      read() {
        return Promise.resolve(
          err({ code: "not_found", message: "blob이 없다" }),
        );
      },
    };
    const unknown = "b".repeat(64);
    const looked = await moduleFrom(unknown, absent);
    assertEquals(looked, { found: false, reason: "missing" });
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("documents/formats#R20 probe: 작은 module 묶음 read는 available이다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-module-probe-" });
  const small = new TextEncoder().encode("tiny bundle");
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createCoreRegistration } as TeamModule],
    teamModules: [
      new URL("./testing/module-registration.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(1),
    testCredentials: true,
  });
  assert(started.ok);
  const core = started.value;
  try {
    assert(core.acceptTestCredential);
    const token = "a".repeat(43);
    const context = {
      principal: "user-1",
      actor: "user" as const,
      credential_ref: "cred_probe1",
      scope: { operations: ["moduleref.attach", "blobs/read"], targets: {} },
      conditions: {},
    };
    const accepted = await core.acceptTestCredential(context, token);
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const recorded = await core.record(context);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);
    const prepared = await core.prepareBlob({
      principal: "user-1",
      purpose: "format_module",
      bytes: new ReadableStream({
        start(c) {
          c.enqueue(small);
          c.close();
        },
      }),
    });
    assert(prepared.ok, prepared.ok ? "" : prepared.error.message);
    const attached = await post(core.port, "/v1/moduleref/attach", {
      input: { owner_key: "mod:probe", prepared: prepared.value },
      idempotency_key: "probe-1",
      compare: {},
      prepared: [],
    }, token);
    assertEquals(attached.status, 200, JSON.stringify(attached.body));
    const read = await post(core.port, "/v1/blobs/read", {
      owner_kind: "format_module",
      owner_key: "mod:probe",
      field: "bundle",
      offset_bytes: 0,
      length_bytes: small.length,
    }, token);
    assertEquals(read.status, 200, JSON.stringify(read.body));
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

async function post(
  port: number,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
