// platform/secrets#R1, platform/redaction#R1: provider credential이 가리키는 secret 참조를
// core의 알려진 값 registry에 등록하는 통로의 이 concern 쪽. 표는 이 concern만 읽고 값은 표에
// 없다. 실제 표 정의(schema step)에 SQLite 메모리 DB를 쓴다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  changeProviderCredentials,
  refreshProviderCredential,
  registerProviderCredential,
} from "../../../contracts/lophn-agent/mod.ts";
import {
  createProviderSecretRefSource,
  PROVIDER_SECRET_OWNER,
  providerSchemaSteps,
  providerSecretDestination,
} from "./mod.ts";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const step of providerSchemaSteps) db.exec(step.sql);
  db.prepare(
    `insert into providers (id, name, definition_key, definition, endpoint, protocol, enabled, revision)
     values ('pvd_a', 'A', 'anthropic', '{}', 'https://example.test', 'anthropic-messages', 1, 1)`,
  ).run();
  return db;
}

function credential(
  db: DatabaseSync,
  key: string,
  order: number,
  kind: "api_key" | "none",
  ref: string | null,
  state: "available" | "revoked" = "available",
) {
  db.prepare(
    `insert into provider_credentials
      (provider, key, kind, label, secret_name, secret_sealed_ref, secret_revision,
       revision, order_index, enabled, state, unavailable_reason)
     values ('pvd_a', ?, ?, 'label', ?, ?, ?, 1, ?, 1, ?, ?)`,
  ).run(
    key,
    kind,
    ref === null ? null : "provider.a",
    ref,
    ref === null ? null : 1,
    order,
    state,
    state === "available" ? null : "authentication",
  );
}

const sqlOf = (db: DatabaseSync) => ({
  all: (text: string, params: readonly (string | number)[]) =>
    db.prepare(text).all(...params) as Record<string, string>[],
});

Deno.test("platform/secrets#R1: provider credential의 secret 참조를 이름과 함께 읽고 참조 없는 credential은 건너뛴다", () => {
  const db = database();
  credential(db, "main", 0, "api_key", "seal-main");
  credential(db, "local", 1, "none", null);
  // 회수한 credential도 참조가 남아 있는 동안은 알려진 값이다: 로컬 회수는 외부 key 폐기가
  // 아니라서 값이 출력에 나오면 안 된다.
  credential(db, "old", 2, "api_key", "seal-old", "revoked");
  const source = createProviderSecretRefSource();
  const read = source.read(sqlOf(db) as never);
  assert(read.ok);
  assertEquals(read.value, [
    { name: "pvd_a/main", sealedRef: "seal-main" },
    { name: "pvd_a/old", sealedRef: "seal-old" },
  ]);
  assertEquals(source.owner, PROVIDER_SECRET_OWNER);
  db.close();
});

Deno.test("platform/secrets#R1: 참조를 만들거나 바꾸는 provider command가 다시 맞추는 계기다", () => {
  const source = createProviderSecretRefSource();
  assertEquals(
    [...source.commands].sort(),
    [
      changeProviderCredentials.name,
      refreshProviderCredential.name,
      registerProviderCredential.name,
    ].sort(),
  );
});

Deno.test("platform/secrets#R8: 표를 읽지 못하면 비어 있는 것으로 꾸미지 않고 unavailable이다", () => {
  const read = createProviderSecretRefSource().read({
    all() {
      throw new Error("no such table");
    },
  });
  assert(!read.ok);
  assertEquals(read.error.code, "unavailable");
});

Deno.test("lophn-agent/harness/provider#R5 platform/secrets#R5: credential 값은 HTTPS origin이나 같은 기계의 loopback HTTP origin에만 가고 그 밖의 HTTP·모르는 형식에는 목적지가 없다", () => {
  assertEquals(providerSecretDestination("https://api.openai.com/v1"), {
    kind: "https",
    origin: "https://api.openai.com",
  });
  assertEquals(providerSecretDestination("http://127.0.0.1:11434/v1"), {
    kind: "loopback_http",
    origin: "http://127.0.0.1:11434",
  });
  assertEquals(providerSecretDestination("http://localhost:1234"), {
    kind: "loopback_http",
    origin: "http://localhost:1234",
  });
  assertEquals(
    providerSecretDestination("http://192.168.0.5:11434"),
    undefined,
  );
  assertEquals(providerSecretDestination("http://api.openai.com"), undefined);
  assertEquals(
    providerSecretDestination("https://user:pw@api.openai.com"),
    undefined,
  );
  assertEquals(providerSecretDestination("ftp://localhost"), undefined);
  assertEquals(providerSecretDestination("not a url"), undefined);
});
