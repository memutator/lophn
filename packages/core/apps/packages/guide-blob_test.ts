// SDK version 사용 안내 blob의 제품 경로 시험이다(apps/sdk#R3, coding-agent#T36). 설치 machine이 안내 byte를
// core.prepareBlob(pipe)으로 준비하고 `package.register_version`이 같은 transaction에서 `package_version/guide`
// field로 등록하면 `/v1/blobs/read`가 그 원문을 돌려준다. 준비하지 않은 byte의 hash를 guide_hash로 주장하는
// 등록은 거절이고, 등록하지 않은 version의 안내는 읽히지 않는다. temp LOPHN_HOME에서만 돈다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../../base/mod.ts";
import { sha256Hex } from "../../../base/mod.ts";
import { startCore } from "../../main/daemon/core.ts";
import { createLedgerRegistration } from "../register.ts";

const GUIDE = new TextEncoder().encode(
  "# @lophn/ui-table\n\n## API\n표 component의 공개 API다.\n",
);

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

Deno.test("apps/sdk#R3: 준비한 안내 blob은 register_version이 등록하고 /v1/blobs/read가 원문을 돌려주며 준비하지 않은 hash는 거절된다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-sdk-guide-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createLedgerRegistration }],
    teamModules: [new URL("../register.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(1),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  try {
    assert(core.acceptTestCredential);
    const machine = {
      principal: "machine:install",
      actor: "machine" as const,
      credential_ref: "cred_sdkguide_m",
      scope: { operations: ["package.register_version"], targets: {} },
      conditions: {},
    };
    const reader = {
      principal: "coding_agent:cac_01h455vb4pex5v6nkc6gd5fdw1",
      actor: "coding_agent:cac_01h455vb4pex5v6nkc6gd5fdw1" as const,
      credential_ref: "cred_sdkguide_r",
      scope: { operations: ["blobs/read"], targets: {} },
      conditions: {},
    };
    const machineToken = "m".repeat(43);
    const readerToken = "r".repeat(43);
    for (
      const [context, token] of [[machine, machineToken], [
        reader,
        readerToken,
      ]] as const
    ) {
      const accepted = await core.acceptTestCredential(context, token);
      assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
      const recorded = await core.record(context);
      assert(recorded.ok, recorded.ok ? "" : recorded.error.message);
    }
    const prepared = await core.prepareBlob({
      principal: machine.principal,
      purpose: "sdk_guide",
      bytes: new ReadableStream({
        start(controller) {
          controller.enqueue(GUIDE);
          controller.close();
        },
      }),
    });
    assert(prepared.ok, prepared.ok ? "" : prepared.error.message);
    const guideHash = await sha256Hex(GUIDE);
    assertEquals(prepared.value.hash, guideHash);
    const input = (guideBlob: unknown, guide = guideHash) => ({
      input: {
        name: "@lophn/ui-table",
        description: "정렬과 선택이 되는 표 component",
        kind: "component",
        version: "1.2.0",
        bundle_hash: "a".repeat(64),
        guide_hash: guide,
        guide_blob: guideBlob,
      },
      idempotency_key: `register-${guide.slice(0, 6)}`,
      compare: {},
      prepared: [],
    });

    // 준비하지 않은 byte의 hash를 안내로 주장하는 등록은 거절이고 아무것도 남지 않는다.
    const forged = await post(
      core.port,
      "/v1/packages/register_version",
      input(prepared.value, "f".repeat(64)),
      machineToken,
    );
    assertEquals(forged.status, 400, JSON.stringify(forged.body));
    const missing = await post(core.port, "/v1/blobs/read", {
      owner_kind: "package_version",
      owner_key: "@lophn/ui-table@1.2.0",
      field: "guide",
      offset_bytes: 0,
      length_bytes: GUIDE.length,
    }, readerToken);
    assert(missing.status >= 400, JSON.stringify(missing.body));

    const registered = await post(
      core.port,
      "/v1/packages/register_version",
      input(prepared.value),
      machineToken,
    );
    assertEquals(registered.status, 200, JSON.stringify(registered.body));
    const read = await post(core.port, "/v1/blobs/read", {
      owner_kind: "package_version",
      owner_key: "@lophn/ui-table@1.2.0",
      field: "guide",
      offset_bytes: 0,
      length_bytes: GUIDE.length,
    }, readerToken);
    assertEquals(read.status, 200, JSON.stringify(read.body));
    const body = read.body as { status: string; bytes?: string };
    assertEquals(body.status, "available");
    assertEquals(
      new TextDecoder().decode(
        Uint8Array.from(atob(body.bytes ?? ""), (c) => c.charCodeAt(0)),
      ),
      new TextDecoder().decode(GUIDE),
    );
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
