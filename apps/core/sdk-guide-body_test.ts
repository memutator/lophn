// coding connection은 일반 `blobs/read` 없이 `packages.guide_body` 하나로 SDK 안내 원문을 읽는다
// (coding-agent#T36, coding-agent/mcp-server#R22). 이 route는 owner_kind·field가 고정이라 다른 blob을
// 가리킬 수 없고, 등록되지 않은 version·안내 byte 없는 version은 없는 것과 같은 답이다.
// temp LOPHN_HOME에서만 돈다.
import { assert, assertEquals } from "@std/assert";
import {
  manualClock,
  seededRandom,
  sha256Hex,
} from "../../packages/base/mod.ts";
import { operationCeiling } from "../../packages/core/server/identity/mod.ts";
import { startCore } from "./core.ts";
import { createLedgerRegistration } from "./apps.ts";
import { appsOperationPolicies } from "./apps-control.ts";

const GUIDE = new TextEncoder().encode(
  "# @lophn/ui-table\n\n## API\n표 component의 공개 API다.\n",
);
const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
const NAME = "@lophn/ui-table";

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

Deno.test("coding-agent/mcp-server#R22: coding connection은 packages.guide_body로 안내 원문을 읽고 다른 blob·blobs/read는 읽지 못한다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-sdk-guide-body-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createLedgerRegistration }],
    teamModules: [new URL("./apps.ts", import.meta.url).href],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(2),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  try {
    assert(core.acceptTestCredential);
    const machine = {
      principal: "machine:install",
      actor: "machine" as const,
      credential_ref: "cred_guidebody_m",
      scope: { operations: ["package.register_version"], targets: {} },
      conditions: {},
    };
    const coding = {
      principal: `coding_agent:${CAC}`,
      actor: `coding_agent:${CAC}` as const,
      credential_ref: "cred_guidebody_c",
      scope: { operations: ["packages.guide_body"], targets: {} },
      conditions: {},
    };
    // 일반 blob 읽기만 가진 자격이다. 이 route의 operation이 따로임을 보인다.
    const general = {
      principal: "machine:general",
      actor: "machine" as const,
      credential_ref: "cred_guidebody_g",
      scope: { operations: ["blobs/read"], targets: {} },
      conditions: {},
    };
    const machineToken = "m".repeat(43);
    const codingToken = "c".repeat(43);
    const generalToken = "g".repeat(43);
    for (
      const [context, token] of [
        [machine, machineToken],
        [coding, codingToken],
        [general, generalToken],
      ] as const
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
    const register = async (
      version: string,
      guideHash: string,
      blob?: unknown,
    ) => {
      const registered = await post(
        core.port,
        "/v1/packages/register_version",
        {
          input: {
            name: NAME,
            description: "정렬과 선택이 되는 표 component",
            kind: "component",
            version,
            bundle_hash: "a".repeat(64),
            guide_hash: guideHash,
            ...(blob === undefined ? {} : { guide_blob: blob }),
          },
          idempotency_key: `register-${version}`,
          compare: {},
          prepared: [],
        },
        machineToken,
      );
      assertEquals(registered.status, 200, JSON.stringify(registered.body));
    };
    await register("1.2.0", await sha256Hex(GUIDE), prepared.value);
    // 안내 byte 없이 hash만 등록한 version이다.
    await register("1.3.0", "e".repeat(64));

    const ask = (token: string, body: unknown) =>
      post(core.port, "/v1/packages/guide_body", body, token);
    const span = { offset_bytes: 0, length_bytes: GUIDE.length };

    // coding connection이 안내 원문을 읽는다.
    const read = await ask(codingToken, {
      name: NAME,
      version: "1.2.0",
      ...span,
    });
    assertEquals(read.status, 200, JSON.stringify(read.body));
    const answer = read.body as { status: string; bytes?: string };
    assertEquals(answer.status, "available");
    assertEquals(
      new TextDecoder().decode(
        Uint8Array.from(atob(answer.bytes ?? ""), (c) => c.charCodeAt(0)),
      ),
      new TextDecoder().decode(GUIDE),
    );

    // 등록되지 않은 version·안내 byte 없는 version·다른 package는 모두 같은 답이다.
    const absent = [
      await ask(codingToken, { name: NAME, version: "9.9.9", ...span }),
      await ask(codingToken, { name: NAME, version: "1.3.0", ...span }),
      await ask(codingToken, {
        name: "@lophn/other",
        version: "1.2.0",
        ...span,
      }),
    ];
    assert(absent[0].status >= 400, JSON.stringify(absent[0].body));
    for (const item of absent) {
      assertEquals(item.status, absent[0].status, JSON.stringify(item.body));
      assertEquals(item.body, absent[0].body);
    }

    // 입력으로 다른 owner·field·blob을 가리킬 수 없다(고정 field라 입력에 없다).
    for (
      const extra of [
        { owner_kind: "document_version", owner_key: "doc", field: "file" },
        { field: "bundle" },
        { hash: "a".repeat(64) },
      ]
    ) {
      const forged = await ask(codingToken, {
        name: NAME,
        version: "1.2.0",
        ...span,
        ...extra,
      });
      assertEquals(forged.status, 400, JSON.stringify(forged.body));
    }
    const owner = await ask(codingToken, {
      name: "doc_01arz3ndektsv4rrffq69g5fb9",
      version: "1.2.0",
      ...span,
    });
    assertEquals(owner.status, 400, JSON.stringify(owner.body));

    // coding 자격에는 일반 blobs/read가 없다. 같은 안내도 그 route로는 읽지 못한다.
    const general_read = await post(core.port, "/v1/blobs/read", {
      owner_kind: "package_version",
      owner_key: `${NAME}@1.2.0`,
      field: "guide",
      ...span,
    }, codingToken);
    assertEquals(general_read.status, 403, JSON.stringify(general_read.body));
    const generalOnRoute = await ask(generalToken, {
      name: NAME,
      version: "1.2.0",
      ...span,
    });
    assertEquals(
      generalOnRoute.status,
      403,
      JSON.stringify(generalOnRoute.body),
    );

    // 제품의 coding_agent operation 상한에도 일반 blob 읽기는 없고 이 route만 있다.
    const ceiling = operationCeiling(
      `coding_agent:${CAC}`,
      appsOperationPolicies(),
    );
    assert(ceiling.includes("packages.guide_body"));
    for (const name of ceiling) {
      assert(!/^blobs?[./]/.test(name), name);
    }
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
