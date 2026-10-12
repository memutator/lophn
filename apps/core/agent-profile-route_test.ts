// lophn-agent/agents#R13 [agent-I17]: profile 이미지 route(`/v1/agent-profiles/upload`,
// `/v1/agent-profiles/read`)는 실제 core에 붙어 처리기까지 닿는다. 처리기는 자리와 assignment를 읽기
// concern에 묻는다. 형식이 맞지 않는 바이트는 처리기의 invalid_input으로, 없는 자리는 reader의 not_found로
// 온다. 처리기가 붙지 않은 route는 unavailable(503)이라 이 답들로 연결을 확인한다. core는 temp
// LOPHN_HOME에서 실제 자식 process와 함께 뜬다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/server/mod.ts";
import { type Core, startCore } from "./core.ts";
import {
  createLedgerRegistration as createLophnAgentRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";
import { createLedgerRegistration } from "./documents.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const TOKEN = "d".repeat(43);
const AT = Date.UTC(2024, 0, 1);
// 자리가 없는 project다. 처리기는 형식을 먼저 보고 자리는 reader에 묻는다.
const PROJECT = { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" };
const ASG = "asg_01arz3ndektsv4rrffq69g5fa6";
const PNG = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0,
  0,
  0,
  0,
]);
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"/>',
);
const OPERATIONS = [
  "UploadAgentProfileImage",
  "ReadAgentProfileImage",
  "ReadAgent",
];

function base64url(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

async function open(): Promise<{ core: Core; home: string }> {
  const home = await Deno.makeTempDir({ prefix: "lophn-agent-profile-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [
      { createLedgerRegistration },
      { lophnAgentDefinitions },
      { createLedgerRegistration: createLophnAgentRegistration },
    ],
    teamModules: [
      new URL("./documents.ts", import.meta.url).href,
      new URL("./lophn-agent.ts", import.meta.url).href,
    ],
    clock: manualClock(AT),
    random: seededRandom(31),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
    await Deno.remove(home, { recursive: true });
  });
  const core = started.value;
  const context: AuthenticatedContext = {
    principal: "user-1",
    actor: "user",
    scope: { operations: OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: "cred-agent-profile",
  };
  assert((await core.acceptTestCredential?.(context, TOKEN))?.ok);
  assert((await core.record(context)).ok);
  guard.keep();
  return { core, home };
}

function upload(
  core: Core,
  body: Uint8Array<ArrayBuffer>,
  contentType: string,
): Promise<Response> {
  const input = {
    place: PROJECT,
    assignment: ASG,
    content_type: contentType,
    bytes: body.length,
  };
  return fetch(`http://127.0.0.1:${core.port}/v1/agent-profiles/upload`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-lophn-input": base64url(JSON.stringify(input)),
      authorization: `Bearer ${TOKEN}`,
    },
    body,
  });
}

Deno.test("lophn-agent/agents#R13 [agent-I17]: the upload route reaches its handler, which refuses bytes that do not match the declared type and a place that is not there", async () => {
  const { core, home } = await open();
  try {
    const mismatched = await upload(core, SVG, "image/png");
    const mismatchedBody = await mismatched.json() as {
      error: { code: string };
    };
    assertEquals(mismatched.status, 400, JSON.stringify(mismatchedBody));
    assertEquals(mismatchedBody.error.code, "invalid_input");

    const missing = await upload(core, PNG, "image/png");
    const missingBody = await missing.json() as { error: { code: string } };
    assertEquals(missing.status, 404, JSON.stringify(missingBody));
    assertEquals(missingBody.error.code, "not_found");
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: the read route reaches its handler, which answers not_found for a place that is not there", async () => {
  const { core, home } = await open();
  try {
    const response = await fetch(
      `http://127.0.0.1:${core.port}/v1/agent-profiles/read`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({ place: PROJECT, assignment: ASG }),
      },
    );
    const body = await response.json() as { error: { code: string } };
    assertEquals(response.status, 404, JSON.stringify(body));
    assertEquals(body.error.code, "not_found");
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
