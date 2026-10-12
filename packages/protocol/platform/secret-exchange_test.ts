import { assert, assertEquals } from "@std/assert";
import {
  ProcessLiveness,
  SecretAllowance,
  secretExport,
  secretExportInputSchema,
  secretExportOutputSchema,
  secretImport,
  secretImportInputSchema,
  secretImportOutputSchema,
} from "./secret-exchange.ts";

const context = {
  principal: "secret-exchange",
  actor: "machine",
  scope: { operations: ["secret.export"], targets: {} },
  conditions: { process: "process-a", task: "task-a" },
  credential_ref: "credential-a",
};
const selected = {
  name: "service.key",
  sealed_ref: "sealed-a",
  purpose: "app_secret",
  owner: "service.key",
};
const preparation = {
  preparation: "prep-a",
  sealed_ref: "sealed-b",
  purpose: "app_secret",
  owner: "service.key",
};

Deno.test("platform/secrets#R9: 보호 export는 machine pipe op이고 고른 참조만 받으며 값·암호 field가 없다", () => {
  assertEquals(secretExport.name, "secret.export");
  assertEquals(secretExport.actors, ["machine"]);
  assert(
    secretExportInputSchema.safeParse({ context, secrets: [selected] }).success,
  );
  for (
    const bad of [
      { context, secrets: [] },
      { context, secrets: [selected, selected] },
      { context, secrets: [{ ...selected, value: "plain" }] },
      { context, secrets: [selected], passphrase: "pw" },
      { context: { ...context, actor: "user" }, secrets: [selected] },
    ]
  ) {
    assert(!secretExportInputSchema.safeParse(bad).success);
  }
  assert(
    secretExportOutputSchema.safeParse({ format: 1, ciphertext_bytes: 64 })
      .success,
  );
  assert(
    !secretExportOutputSchema.safeParse({ format: 1, ciphertext_bytes: 0 })
      .success,
  );
});

Deno.test("platform/secrets#R9: 보호 import는 현재 참조와 기록 CAS를 가진 준비 목록만 돌려준다", () => {
  assertEquals(secretImport.name, "secret.import");
  assertEquals(secretImport.actors, ["machine"]);
  const current = [{
    name: "service.key",
    sealed_ref: "sealed-a",
    revision: 2,
  }];
  assert(secretImportInputSchema.safeParse({ context, current }).success);
  assert(
    !secretImportInputSchema.safeParse({
      context,
      current: [...current, ...current],
    }).success,
  );
  assert(
    !secretImportInputSchema.safeParse({ context, current, ciphertext: "x" })
      .success,
  );
  const commits = [
    {
      name: "service.key",
      preparation,
      compare: { sealed_ref: "sealed-a", revision: 2 },
    },
    {
      name: "other.key",
      preparation: { ...preparation, owner: "other.key" },
      compare: { sealed_ref: null, revision: null },
    },
  ];
  assert(secretImportOutputSchema.safeParse({ commits }).success);
  assert(
    !secretImportOutputSchema.safeParse({
      commits: [{ ...commits[0], compare: { sealed_ref: null, revision: 2 } }],
    }).success,
  );
  assert(
    !secretImportOutputSchema.safeParse({ commits: [commits[0], commits[0]] })
      .success,
  );
});

Deno.test("platform/secrets#R5: 앱 사용 허용과 process 생존은 owner가 주입하는 port다", () => {
  assertEquals(SecretAllowance.name, "SecretAllowance");
  assertEquals(ProcessLiveness.name, "ProcessLiveness");
  assert(Object.isFrozen(SecretAllowance) && Object.isFrozen(ProcessLiveness));
});
