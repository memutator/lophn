import { assert, assertEquals } from "@std/assert";
import type { Clock } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import { diagnosticCheckResultSchema } from "../../protocol/server/mod.ts";
import { observeDoctor } from "./worker/doctor.ts";
import {
  classifySecurity,
  diagnosticsCheckRead,
  type DoctorObservation,
  type DoctorSource,
  safeDetail,
  SECURITY_DIAGNOSTIC_KINDS,
  storageFailure,
  warmPatternRevision,
} from "./mod.ts";

const at = "2026-10-04T00:00:00.000Z";
const clock: Clock = { now: () => at, nowMs: () => Date.parse(at) };
const hash = "a".repeat(64);
const other = "b".repeat(64);

const ctx = {} as AuthenticatedContext;

function source(observation: DoctorObservation): DoctorSource {
  return { observe: () => observation };
}

function empty(): DoctorObservation {
  return { grants: [], sdk: [], logLines: [] };
}

async function check(
  observation: DoctorObservation,
  checks?: string[],
): Promise<Record<string, unknown>> {
  await warmPatternRevision();
  const result = diagnosticsCheckRead(source(observation), clock)(
    ctx,
    checks ? { checks } : {},
  );
  assert(!(result instanceof Promise));
  assert(result.ok);
  return result.value as Record<string, unknown>;
}

function results(value: Record<string, unknown>) {
  const parsed = (value.results as unknown[]).map((item) =>
    diagnosticCheckResultSchema.parse(item)
  );
  return Object.fromEntries(parsed.map((item) => [item.check, item]));
}

Deno.test("platform/diagnostics#R4: 디스크 부족과 ledger 손상은 플랫폼 실패다", () => {
  for (const reason of ["disk_full", "ledger_corrupt"] as const) {
    const failure = storageFailure(reason);
    assert(!failure.ok);
    assertEquals(failure.error.code, "unavailable");
    assert(failure.error.message.length > 0);
    assertEquals(failure.error.details, { reason });
    // 성공 응답도 앱 problem도 아니다. 플랫폼 실패만 남는다.
    assert(!("problem" in failure.error));
  }
});

Deno.test("platform/diagnostics#R5: 진단 상세는 redaction을 통과한 내용만 제공한다", () => {
  const passed = safeDetail({
    message: "Platform internal failure observed.",
    redacted: true,
  });
  assertEquals(passed.omitted, false);
  assertEquals(passed.message, "Platform internal failure observed.");

  const raw = safeDetail({
    message: "token sk-ant-secret at /home/person/.lophn",
    redacted: false,
  });
  assertEquals(raw.message, null);
  assertEquals(raw.omitted, true);
  assert(raw.reason);
  // 가공하지 못한 원문·stack·경로는 결과에 없다.
  assert(!JSON.stringify(raw).includes("sk-ant-secret"));
  assert(!JSON.stringify(raw).includes("/home/person"));
});

Deno.test("platform/diagnostics#R6: 보안 사건을 보안 진단으로 구별하고 원본은 소유 concern이다", () => {
  const kinds = [
    ["permission_grant", "apps/permissions"],
    ["permission_revoke", "apps/permissions"],
    ["secret_use", "platform/secrets"],
    ["authentication_failure", "platform/identity"],
    ["origin_rejected", "platform/identity"],
    ["out_of_scope_access", "platform/identity"],
  ] as const;
  assertEquals(kinds.map(([kind]) => kind), [...SECURITY_DIAGNOSTIC_KINDS]);
  for (const [kind, owner] of kinds) {
    const diagnostic = classifySecurity(kind, at);
    assertEquals(diagnostic.kind, kind);
    assertEquals(diagnostic.source, owner);
    assertEquals(diagnostic.at, at);
    // secret 원문도 범위 밖 대상도 담지 않는다.
    assertEquals(Object.keys(diagnostic).sort(), ["at", "kind", "source"]);
  }
});

Deno.test("platform/diagnostics#R9: 같은 version SDK의 hash 차이를 package 이름과 version으로 보고한다", async () => {
  const value = await check({
    ...empty(),
    sdk: [{
      name: "@lophn/sdk",
      version: "1.2.3",
      bundle_hash: hash,
      installed_hash: other,
    }],
  });
  const found = results(value).sdk_hash;
  assert(found.finding);
  assertEquals(found.finding.code, "sdk_hash_mismatch");
  assert(found.finding.message?.includes("@lophn/sdk@1.2.3"));
  assertEquals(found.observed_at, at);
  // hash 원문은 결과에 없다.
  assert(!JSON.stringify(found).includes(hash));
  assert(!JSON.stringify(found).includes(other));
});

Deno.test("platform/diagnostics#R9: hash가 같으면 SDK 불일치를 보고하지 않는다", async () => {
  const value = await check({
    ...empty(),
    sdk: [{
      name: "@lophn/sdk",
      version: "1.2.3",
      bundle_hash: hash,
      installed_hash: hash,
    }],
  });
  assertEquals(results(value).sdk_hash.finding, null);
});

Deno.test("platform/diagnostics#R10: 실행 자격 보관이 소유자 밖에도 읽히면 보고한다", async () => {
  const open = await check({
    ...empty(),
    credentialPermission: { mode: 0o644 },
  });
  const found = results(open).credential_permission;
  assert(found.finding);
  assertEquals(found.finding.code, "credential_permission");
  assertEquals(found.observed_at, at);

  const closed = await check({
    ...empty(),
    credentialPermission: { mode: 0o600 },
  });
  assertEquals(results(closed).credential_permission.finding, null);
});

Deno.test("platform/diagnostics#R10: 너무 넓은 grant를 개수로 보고한다", async () => {
  const value = await check({
    ...empty(),
    grants: [
      {
        app: "app_1",
        kind: "fs.read",
        file: true,
        network: false,
        broad: true,
        last_used_at: at,
      },
      {
        app: "app_2",
        kind: "fs.read",
        file: true,
        network: false,
        broad: false,
        last_used_at: at,
      },
    ],
  });
  const found = results(value).broad_grant;
  assert(found.finding);
  assert(found.finding.message?.includes("1"));
  // grant 대상 원문은 결과에 없다.
  assert(!JSON.stringify(found).includes("app_1"));
});

Deno.test("platform/diagnostics#R10: file과 network grant를 함께 가진 앱을 보고한다", async () => {
  const value = await check({
    ...empty(),
    grants: [
      {
        app: "app_1",
        kind: "fs.read",
        file: true,
        network: false,
        broad: false,
        last_used_at: at,
      },
      {
        app: "app_1",
        kind: "net.fetch",
        file: false,
        network: true,
        broad: false,
        last_used_at: at,
      },
    ],
  });
  const found = results(value).file_and_network_grant;
  assert(found.finding);
  assertEquals(found.finding.code, "file_and_network_grant");
  assert(!JSON.stringify(found).includes("app_1"));
});

Deno.test("platform/diagnostics#R10: 오래 쓰지 않은 grant를 보고한다", async () => {
  const value = await check({
    ...empty(),
    grants: [{
      app: "app_1",
      kind: "fs.read",
      file: true,
      network: false,
      broad: false,
      last_used_at: "2020-01-01T00:00:00.000Z",
    }],
  });
  const found = results(value).unused_grant;
  assert(found.finding);
  assertEquals(found.finding.code, "unused_grant");
  assertEquals(found.observed_at, at);
});

Deno.test("platform/diagnostics#R10: log의 미가공 key 패턴을 원문 없이 보고한다", async () => {
  const secret = "sk-" + "a".repeat(24);
  const value = await check({
    ...empty(),
    logLines: [`info ${secret} leaked`],
  });
  const found = results(value).raw_key_pattern;
  assert(found.finding);
  assertEquals(found.finding.code, "raw_key_pattern");
  const text = JSON.stringify(found);
  assert(!text.includes(secret));
  assert(!text.includes("leaked"));

  const clean = await check({
    ...empty(),
    logLines: ["Platform internal failure observed."],
  });
  assertEquals(results(clean).raw_key_pattern.finding, null);
});

Deno.test("platform/diagnostics#R10: 위험이 없으면 모든 검사가 비어 있다", async () => {
  const value = await check(empty());
  for (const item of Object.values(results(value))) {
    assertEquals(item.finding, null);
    assertEquals(item.observed_at, at);
  }
});

Deno.test("platform/diagnostics#R9 platform/diagnostics#R10: worker가 데이터 root에서 관측을 모은다", async () => {
  const root = await Deno.makeTempDir({ prefix: "doctor-" });
  try {
    const credential = `${root}/credential`;
    await Deno.writeTextFile(credential, "sealed");
    await Deno.chmod(credential, 0o644);
    await Deno.writeTextFile(
      `${root}/grants.json`,
      JSON.stringify([{
        app: "app_1",
        kind: "fs.read",
        file: true,
        network: false,
        broad: true,
        last_used_at: null,
      }]),
    );
    await Deno.writeTextFile(
      `${root}/sdk.json`,
      JSON.stringify([{
        name: "@lophn/sdk",
        version: "1.2.3",
        bundle_hash: hash,
        installed_hash: other,
      }]),
    );
    await Deno.mkdir(`${root}/logs`);
    await Deno.writeTextFile(
      `${root}/logs/platform-0.jsonl`,
      `{"message":"sk-${"c".repeat(24)}"}\n`,
    );
    const observation = await observeDoctor({
      credentialPath: credential,
      grantsPath: `${root}/grants.json`,
      sdkPath: `${root}/sdk.json`,
      logDirectory: `${root}/logs`,
    });
    assertEquals(observation.credentialPermission?.mode, 0o644);
    assertEquals(observation.grants.length, 1);
    assertEquals(observation.sdk[0].name, "@lophn/sdk");
    assert(observation.logLines.length > 0);

    const value = await check(observation);
    const found = results(value);
    assert(found.sdk_hash.finding);
    assert(found.credential_permission.finding);
    assert(found.broad_grant.finding);
    assert(found.unused_grant.finding);
    assert(found.raw_key_pattern.finding);
    // 보고에는 원문 key·경로·문서 원문이 없다.
    const text = JSON.stringify(value);
    assert(!text.includes(root));
    assert(!text.includes("sk-"));
    assert(!text.includes("sealed"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
