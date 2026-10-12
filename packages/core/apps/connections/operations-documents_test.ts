// 제품 coding_agent operation 상한(coding-agent#T36)이 문서 읽기를 싣는 뒤에도, 앱 하나 범위의 실제
// coding token은 다른 앱 문서를 없는 문서와 같은 답으로만 본다(connection#R5). 실제 core(임시
// LOPHN_HOME)와 실제 coding credential 발급·인증(fake keychain)을 쓴다. 문서는 시험 전용 전체 범위
// 자격이 저장한다. 사람의 실제 keychain·데이터 root는 열지 않는다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../../base/mod.ts";
import { createCoreClient } from "../../../coding-agent/connection/client/core.ts";
import {
  saveFromPaths,
  uploadPrepareBytes,
} from "../../../coding-agent/connection/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import { codingExternalCredential } from "../../server/identity/mod.ts";
import { codingCredentialRef, createFakeKeychain } from "../../secrets/mod.ts";
import { createLedgerRegistration as createAppsRegistration } from "../register.ts";
import { codingAgentConnectionDefinitions } from "../../server/identity/coding-connection.ts";
import { lophnAgentDefinitions } from "../../lophn-agent/register.ts";
import { startCore } from "../../main/daemon/core.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "../../projects/register.ts";
import { DOCUMENT_OPERATIONS } from "../../testing/coding-agent-scope.ts";

const CAC_SEED = "cac_01arz3ndektsv4rrffq69g5fax";
const ABSENT_DOC = "doc_01arz3ndektsv4rrffq69g5fb9";
const decoder = new TextDecoder();

Deno.test("coding-agent/connection#R5: 앱 하나 범위 coding token은 문서 읽기 상한에 닿아도 다른 앱 문서를 없는 문서와 같은 답으로만 본다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-ceiling-docs-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-ceiling-work-" }),
  );
  const keychain = createFakeKeychain();
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [
      { createLedgerRegistration: createDocumentsRegistration },
      { createLedgerRegistration: createAppsRegistration },
      { codingAgentConnectionDefinitions },
      { lophnAgentDefinitions },
    ],
    teamModules: [
      new URL("../../projects/register.ts", import.meta.url).href,
      new URL("../register.ts", import.meta.url).href,
      new URL("../../server/identity/coding-connection.ts", import.meta.url)
        .href,
      new URL("../../lophn-agent/register.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(78),
    testCredentials: true,
    codingKeychain: keychain,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  const baseUrl = `http://127.0.0.1:${core.port}`;
  try {
    assert(core.acceptTestCredential && core.codingCredentials);
    await core.codingCredentialsReady;
    const accept = async (context: AuthenticatedContext, token: string) => {
      const accepted = await core.acceptTestCredential!(context, token);
      assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
      const recorded = await core.record(context);
      assert(recorded.ok, recorded.ok ? "" : recorded.error.message);
    };
    const userToken = "u".repeat(43);
    await accept({
      principal: "user",
      actor: "user",
      scope: {
        operations: ["app.create", "CreateCodingAgentConnection"],
        targets: {},
      },
      conditions: {},
      credential_ref: "cred-user",
    }, userToken);
    const send = async (path: string, token: string, body: unknown) => {
      const response = await fetch(`${baseUrl}/v1/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: await response.json() as Record<string, unknown>,
      };
    };
    const apps: string[] = [];
    for (const slug of ["notes", "ledger"]) {
      const created = await send("apps/create", userToken, {
        input: { slug, name: slug, description: `${slug} app` },
        idempotency_key: `app-${slug}`,
        compare: {},
        prepared: [],
      });
      assertEquals(created.status, 200, JSON.stringify(created.body));
      apps.push(String(created.body["id"]));
    }
    const [appA, appB] = apps;
    // 문서는 시험 전용 전체 범위 자격이 앱 B 자리에 저장한다.
    const seeder = codingExternalCredential(CAC_SEED, {
      kind: "all",
      app: null,
    });
    const seedToken = "s".repeat(43);
    await accept({
      principal: seeder.principal,
      actor: seeder.actor,
      scope: { operations: [...DOCUMENT_OPERATIONS], targets: seeder.targets },
      conditions: seeder.conditions,
      credential_ref: "cred-seed",
    }, seedToken);
    const client = createCoreClient({
      baseUrl,
      connection: CAC_SEED,
      provider: () =>
        Promise.resolve({ ok: true, value: { token: seedToken } }),
    });
    await Deno.writeTextFile(`${work}/plan.md`, "# 계획\n\n## 개요\n본문\n");
    const saved = await saveFromPaths({
      client,
      scope: { root: work, forbidden: [home] },
      prepareBytes: uploadPrepareBytes(client),
    }, { paths: ["plan.md"], place: { kind: "app", id: appB }, slug: "plan" });
    assert(saved.ok, saved.ok ? "" : JSON.stringify(saved.error));
    const doc = saved.value.saved;

    // 실제 발급: 앱 A 하나 범위 연결과 전체 범위 연결.
    const connect = async (
      label: string,
      scope: { kind: "all"; app: null } | { kind: "app"; app: string },
    ) => {
      const connected = await core.codingCredentials!.connect(
        { label, scope },
        async (submission): Promise<Result<unknown>> => {
          const sent = await send(
            "coding_agent_connections/create",
            userToken,
            {
              input: submission,
              idempotency_key: `c-${label}`,
              compare: {},
              prepared: [],
            },
          );
          return sent.status === 200
            ? ok(sent.body)
            : err({ code: "conflict", message: `${sent.status}` });
        },
      );
      assert(connected.ok, connected.ok ? "" : connected.error.message);
      return decoder.decode(
        keychain.stored.get(codingCredentialRef(connected.value.connection)!)!,
      );
    };
    const scopedToken = await connect("scoped", { kind: "app", app: appA });
    const allToken = await connect("all", { kind: "all", app: null });

    const ask = async (token: string, document: string) => {
      const response = await fetch(`${baseUrl}/v1/documents/get`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ document, version: doc.version }),
      });
      return { status: response.status, body: await response.json() };
    };
    // 전체 범위 실제 token은 상한 안에서 읽는다. 앱 A 범위는 앱 B 문서를 없는 문서처럼 본다.
    assertEquals((await ask(allToken, doc.document)).status, 200);
    const foreign = await ask(scopedToken, doc.document);
    const absent = await ask(scopedToken, ABSENT_DOC);
    assertNotEquals(foreign.status, 200, JSON.stringify(foreign.body));
    assertNotEquals(foreign.status, 403);
    assertEquals(foreign.status, absent.status);
    assertEquals(foreign.body, absent.body);
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(work, { recursive: true });
  }
});
