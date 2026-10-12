import { assert, assertEquals } from "@std/assert";
import { ok, type Result } from "../../../../base/mod.ts";
import {
  createDocumentSaveService,
  type DocumentSaveOutput,
  type DocumentsSave,
  type DocumentsSaveRequest,
} from "./documents.ts";
import {
  APP,
  child,
  createAccessFixture,
  OTHER_APP,
  requirement,
  withChild,
} from "../testing/broker.ts";

const VER1 = "ver_01h455vb4pex5v6nkc6gd5fdw1";

function fixture() {
  const access = createAccessFixture({
    permissions: [
      requirement("document.save", { key: "weekly-report" }),
    ],
  });
  // documents#T31이 들어오기 전의 저장 contract 대역이다. (앱 자리, key)마다 문서 하나를 두고
  // 같은 재전송 key는 같은 version을 돌려주며 새 key는 같은 문서에 version을 쌓는다.
  const calls: DocumentsSaveRequest[] = [];
  const documents = new Map<string, string[]>();
  const retries = new Map<string, string>();
  const port: DocumentsSave = {
    save(request): Promise<Result<DocumentSaveOutput>> {
      calls.push(request);
      const target = `${request.place.app}/${request.key}`;
      const retry = `${target}/${request.idempotencyKey}`;
      const known = retries.get(retry);
      if (known !== undefined) {
        return Promise.resolve(ok({ saved: true, version: known }));
      }
      const versions = documents.get(target) ?? [];
      const version = `ver_${
        (versions.length + 1).toString().padStart(26, "0")
      }`;
      versions.push(version);
      documents.set(target, versions);
      retries.set(retry, version);
      return Promise.resolve(ok({ saved: true, version }));
    },
  };
  const service = createDocumentSaveService({ access, documents: port });
  return { access, calls, documents, service };
}

function save(key: string, retry = "retry-1", base: string | null = null) {
  return withChild({ key, base_version: base, idempotency_key: retry });
}

Deno.test("apps/permissions#R13: 미선언 문서 key의 저장은 grant가 있어도 거절한다", async () => {
  const { access, calls, service } = fixture();
  access.grant({ kind: "document.save", key: "weekly-report" });
  access.grant({ kind: "document.save", key: "undeclared" });
  const refused = await service.save(child(), save("undeclared"));
  assert(!refused.ok);
  assertEquals(refused.error.code, "forbidden");
  assertEquals(refused.error.details, {
    permission: "document.save",
    scope: { key: "undeclared" },
  });
  assertEquals(calls.length, 0);
});

Deno.test("apps/permissions#R13: 선언했지만 grant 밖인 문서의 저장은 거절하고 grant 뒤에만 허용한다", async () => {
  const { access, calls, service } = fixture();
  const declaredOnly = await service.save(child(), save("weekly-report"));
  assert(!declaredOnly.ok);
  assertEquals(declaredOnly.error.code, "forbidden");
  assertEquals(calls.length, 0);

  const grant = access.grant({ kind: "document.save", key: "weekly-report" });
  const saved = await service.save(child(), save("weekly-report"));
  assert(saved.ok);
  assertEquals(calls.length, 1);

  // 회수하면 다음 저장부터 거절된다.
  access.revoke(grant);
  const after = await service.save(child(), save("weekly-report", "retry-2"));
  assert(!after.ok);
  assertEquals(after.error.code, "forbidden");
  assertEquals(calls.length, 1);
});

Deno.test("apps/permissions#R13: 준비 모드·preview·test 자식은 문서를 저장하지 못한다", async () => {
  const { access, calls, service } = fixture();
  access.grant({ kind: "document.save", key: "weekly-report" });
  for (const mode of ["preview", "test"] as const) {
    const who = child({ mode, release: null });
    const refused = await service.save(
      who,
      withChild({
        key: "weekly-report",
        base_version: null,
        idempotency_key: "r",
      }, who),
    );
    assert(!refused.ok);
    assertEquals(refused.error.code, "forbidden");
  }
  assertEquals(calls.length, 0);
});

Deno.test("apps/blueprint#R13: 같은 선언 key로 두 번 저장하면 같은 (앱 자리, key)로 가고 같은 문서에 version이 쌓인다", async () => {
  const { access, calls, documents, service } = fixture();
  access.grant({ kind: "document.save", key: "weekly-report" });
  const first = await service.save(child(), save("weekly-report", "retry-1"));
  assert(first.ok);
  const second = await service.save(
    child(),
    save("weekly-report", "retry-2", first.value.version),
  );
  assert(second.ok);
  assertEquals(calls.map((call) => call.place), [
    { kind: "app", app: APP },
    { kind: "app", app: APP },
  ]);
  assertEquals(calls.map((call) => call.key), [
    "weekly-report",
    "weekly-report",
  ]);
  assertEquals(calls[1]?.baseVersion, first.value.version);
  // 같은 문서(앱 자리, key)에 version이 둘 쌓였다.
  assertEquals(documents.get(`${APP}/weekly-report`)?.length, 2);
  // 같은 요청의 재전송은 같은 재전송 key로 가서 version이 늘지 않는다.
  const resend = await service.save(
    child(),
    save("weekly-report", "retry-2", first.value.version),
  );
  assert(resend.ok);
  assertEquals(calls[2]?.idempotencyKey, "retry-2");
  assertEquals(resend.value.version, second.value.version);
  assertEquals(documents.get(`${APP}/weekly-report`)?.length, 2);
});

Deno.test("apps/blueprint#R13: 다른 앱 place를 가리키는 저장 요청은 거절한다", async () => {
  const { access, calls, service } = fixture();
  access.grant({ kind: "document.save", key: "weekly-report" });
  for (
    const extra of [
      { app: OTHER_APP },
      { place: { kind: "app", app: OTHER_APP } },
      { document: VER1 },
    ]
  ) {
    const refused = await service.save(child(), {
      ...save("weekly-report"),
      ...extra,
    });
    assert(!refused.ok);
    assertEquals(refused.error.code, "invalid_input");
  }
  assertEquals(calls.length, 0);
});
