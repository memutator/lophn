// 제품 경로의 blob 준비·등록·읽기(platform/blob-store#R4, R5).
// harness의 notePrepared나 ledger 직접 insert는 쓰지 않는다.
// 준비는 core.prepareBlob(pipe)이고, 등록은 command transaction이며, 읽기는 /v1/blobs/read다.

import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import { startCore } from "./core.ts";
import { createCoreRegistration } from "./testing/blob-registration.ts";

const BODY = new TextEncoder().encode("blob body");

Deno.test("platform/blob-store#R4 #R5: 준비 뒤 command가 등록하고 read가 그 바이트를 돌려준다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-blob-flow-" });
  const nowMs = Date.UTC(2024, 0, 1);
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createCoreRegistration }],
    teamModules: [
      new URL("./testing/blob-registration.ts", import.meta.url)
        .href,
    ],
    clock: manualClock(nowMs),
    random: seededRandom(1),
    testCredentials: true,
  });
  assert(started.ok);
  const core = started.value;
  try {
    // credential 기록은 writer가 현재 자격을 다시 볼 때 필요하다.
    assert(core.acceptTestCredential);
    const token = "a".repeat(43);
    const context = {
      principal: "user-1",
      actor: "user" as const,
      credential_ref: "cred_blobflow1",
      scope: {
        operations: ["blobref.attach", "blobs/read"],
        targets: {},
      },
      conditions: {},
    };
    const accepted = await core.acceptTestCredential(context, token);
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const recorded = await core.record(context);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);

    const prepared = await core.prepareBlob({
      principal: "user-1",
      purpose: "document_file",
      bytes: new ReadableStream({
        start(controller) {
          controller.enqueue(BODY);
          controller.close();
        },
      }),
    });
    assert(prepared.ok, prepared.ok ? "" : prepared.error.message);

    const attached = await post(core.port, "/v1/blobref/attach", {
      input: {
        owner_key: "ver:1",
        prepared: prepared.value,
      },
      idempotency_key: "attach-1",
      compare: {},
      prepared: [],
    }, token);
    assertEquals(attached.status, 200, JSON.stringify(attached.body));

    const read = await post(core.port, "/v1/blobs/read", {
      owner_kind: "document_version",
      owner_key: "ver:1",
      field: "file",
      offset_bytes: 0,
      length_bytes: BODY.length,
    }, token);
    assertEquals(read.status, 200, JSON.stringify(read.body));
    const body = read.body as {
      status: string;
      bytes?: string;
      truncated?: boolean;
      size_bytes?: number;
    };
    assertEquals(body.status, "available");
    assertEquals(body.bytes, btoa("blob body"));
    assertEquals(body.truncated, false);
    assertEquals(body.size_bytes, BODY.length);
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
