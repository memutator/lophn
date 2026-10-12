import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { SecretAllowanceRequest } from "../../../protocol/platform/mod.ts";
import { currentDeclarations } from "../declarations.ts";
import { createSecretAllowance } from "../secret-allowance.ts";
import {
  createSecretUseService,
  type RedactionGate,
  type SecretDelivery,
  type SecretDeliveryRequest,
} from "./secrets.ts";
import {
  APP,
  child,
  createAccessFixture,
  HASH,
  OTHER_APP,
  RELEASE,
  requirement,
  serveLocal as serve,
  withChild,
} from "../testing/broker.ts";

const INV = "inv_01h455vb4pex5v6nkc6gd5fdw1";
const NAME = "calendar.token";
// 원값은 시험의 전송 대역 안에만 있다. 이 값이 어디에도 새지 않아야 한다.
const SECRET_VALUE = "s3cret-VALUE-9f2a";

function fixture(portNumber: number) {
  const access = createAccessFixture({
    permissions: [
      requirement("secret.use", { name: NAME }),
      requirement("net.fetch", { host: "127.0.0.1", port: portNumber }),
    ],
  });
  access.grant({ kind: "secret.use", name: NAME });
  access.grant({ kind: "net.fetch", host: "127.0.0.1", port: portNumber });
  return access;
}

function useBody(port: number, over: Record<string, unknown> = {}) {
  return withChild({
    release: RELEASE,
    invocation: INV,
    command: "sync",
    input_hash: HASH,
    name: NAME,
    destination: { scheme: "https", host: "127.0.0.1", port },
    ...over,
  });
}

const redactionOk: RedactionGate = { ensure: () => ok(undefined) };

// 플랫폼 전송부 대역. 값은 이 안에서만 전송 callback 메모리로 쓰이고 반환값에는 없다.
// redirect를 직접 따라가며 한 번마다 recheck를 부른다(platform/security#R9).
function transmitter(requests: SecretDeliveryRequest[]): SecretDelivery {
  return {
    async use(request) {
      requests.push(request);
      let url = new URL(
        `http://${request.destination.host}:${request.destination.port}/send`,
      );
      for (let hop = 0; hop < 5; hop += 1) {
        const response = await fetch(url, {
          redirect: "manual",
          headers: { authorization: `Bearer ${SECRET_VALUE}` },
        });
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (response.status < 300 || response.status >= 400 || !location) {
          return response.ok
            ? ok({ sent: true as const })
            : err({ code: "unavailable", message: "send failed" });
        }
        const next = new URL(location, url);
        const checked = await request.recheck({
          scheme: request.destination.scheme,
          host: next.hostname,
          port: Number(next.port),
        });
        if (!checked.ok) return checked;
        url = next;
      }
      return err({ code: "unavailable", message: "too many redirects" });
    },
  };
}

Deno.test("apps/permissions#R14: 같은 grant로 사람 화면·agent·automation·다른 앱이 부른 command도 secret이 붙고 회수하면 다음 사용부터 거절한다", async () => {
  const target = serve(() => new Response("ok"));
  try {
    const access = createAccessFixture({
      permissions: [
        requirement("secret.use", { name: NAME }),
        requirement("net.fetch", { host: "127.0.0.1", port: target.port }),
      ],
    });
    const secret = access.grant({ kind: "secret.use", name: NAME });
    access.grant({ kind: "net.fetch", host: "127.0.0.1", port: target.port });
    const requests: SecretDeliveryRequest[] = [];
    const service = createSecretUseService({
      access,
      delivery: transmitter(requests),
      redaction: redactionOk,
      platformPorts: [],
    });
    // 호출한 쪽은 broker 입력에 없다. 사람 화면·agent·automation·다른 앱이 부른 command는 모두
    // 같은 입력 모양으로 오고 호출마다 사람 확인도 받지 않는다.
    for (
      const [index, caller] of ["human", "agent", "automation", "app"].entries()
    ) {
      const used = await service.use(
        child(),
        useBody(target.port, {
          invocation: `inv_01h455vb4pex5v6nkc6gd5fdw${index + 1}`,
        }),
      );
      assert(used.ok, `${caller}: ${used.ok ? "" : used.error.message}`);
      assertEquals(used.value, { used: true });
    }
    assertEquals(requests.length, 4);
    assertEquals(
      target.seen.map((r) => r.headers.get("authorization")),
      Array(4).fill(`Bearer ${SECRET_VALUE}`),
    );

    access.revoke(secret);
    const after = await service.use(child(), useBody(target.port));
    assert(!after.ok);
    assertEquals(after.error.code, "forbidden");
    assertEquals(requests.length, 4);
    assertEquals(target.seen.length, 4);
  } finally {
    await target.stop();
  }
});

Deno.test("apps/permissions#R14: 선언 이름이 아니거나 목적지가 net.fetch 범위 밖이면 거절한다", async () => {
  const target = serve(() => new Response("ok"));
  try {
    const access = fixture(target.port);
    const requests: SecretDeliveryRequest[] = [];
    const service = createSecretUseService({
      access,
      delivery: transmitter(requests),
      redaction: redactionOk,
      platformPorts: [],
    });
    const other = await service.use(
      child(),
      useBody(target.port, { name: "other.token" }),
    );
    assert(!other.ok);
    assertEquals(other.error.code, "forbidden");
    assertEquals(other.error.details?.permission, "secret.use");
    const elsewhere = await service.use(
      child(),
      useBody(target.port + 1),
    );
    assert(!elsewhere.ok);
    assertEquals(elsewhere.error.details?.permission, "net.fetch");
    const wrongRelease = await service.use(
      child(),
      useBody(target.port, { release: "rel_01h455vb4pex5v6nkc6gd5fdw2" }),
    );
    assert(!wrongRelease.ok);
    const unknownCommand = await service.use(
      child(),
      useBody(target.port, { command: "not-declared" }),
    );
    assert(!unknownCommand.ok);
    assertEquals(requests.length, 0);
    assertEquals(target.seen.length, 0);
  } finally {
    await target.stop();
  }
});

Deno.test("apps/permissions#R15: 응답·오류·전달 요청 어디에도 secret 원값이 없고 live가 아닌 자식은 쓰지 못한다", async () => {
  const target = serve(() => new Response("ok"));
  try {
    const access = fixture(target.port);
    const requests: SecretDeliveryRequest[] = [];
    const service = createSecretUseService({
      access,
      delivery: transmitter(requests),
      redaction: redactionOk,
      platformPorts: [],
    });
    const outputs: unknown[] = [];
    outputs.push(await service.use(child(), useBody(target.port)));
    // 준비 모드·preview·test는 같은 grant가 있어도 운영 secret 문맥이 없다.
    for (const mode of ["preview", "test"] as const) {
      const who = child({ mode, release: null });
      const result = await service.use(
        who,
        withChild({
          release: RELEASE,
          invocation: null,
          command: "sync",
          input_hash: HASH,
          name: NAME,
          destination: {
            scheme: "https",
            host: "127.0.0.1",
            port: target.port,
          },
        }, who),
      );
      assert(!result.ok);
      assertEquals(result.error.code, "forbidden");
      outputs.push(result);
    }
    outputs.push(await service.use(child(), { ...useBody(target.port), x: 1 }));
    assertEquals(requests.length, 1);
    assertEquals(target.seen.length, 1);
    for (const output of outputs) {
      assertFalse(JSON.stringify(output).includes(SECRET_VALUE));
    }
    // 전달 요청은 이름·목적지·입력 hash만 갖는다.
    assertFalse(JSON.stringify(requests).includes(SECRET_VALUE));
    // 원값을 읽거나 바꾸는 입력은 schema에 없다.
    const read = await service.use(child(), {
      ...useBody(target.port),
      value: SECRET_VALUE,
    });
    assert(!read.ok);
    assertEquals(read.error.code, "invalid_input");
  } finally {
    await target.stop();
  }
});

Deno.test("apps/permissions#R16: redaction 등록에 실패하면 전달하지 않는다", async () => {
  const target = serve(() => new Response("ok"));
  try {
    const access = fixture(target.port);
    const requests: SecretDeliveryRequest[] = [];
    const service = createSecretUseService({
      access,
      delivery: transmitter(requests),
      redaction: {
        ensure: () => err({ code: "unavailable", message: "registry failed" }),
      },
      platformPorts: [],
    });
    const used = await service.use(child(), useBody(target.port));
    assert(!used.ok);
    assertEquals(used.error.code, "unavailable");
    assertEquals(requests.length, 0);
    assertEquals(target.seen.length, 0);
  } finally {
    await target.stop();
  }
});

Deno.test("apps/permissions#R16: 다른 host로 redirect하면 secret 전달이 멈춘다", async () => {
  const landing = serve(() => new Response("landed"));
  const first = serve((_request) =>
    new Response(null, {
      status: 302,
      headers: { location: `http://localhost:${landing.port}/next` },
    })
  );
  try {
    // 도착 지점도 grant가 있어도(범위 안이어도) 다른 host이면 인증을 넘기지 않는다.
    const access = createAccessFixture({
      permissions: [
        requirement("secret.use", { name: NAME }),
        requirement("net.fetch", { host: "127.0.0.1", port: first.port }),
        requirement("net.fetch", { host: "localhost", port: landing.port }),
      ],
    });
    access.grant({ kind: "secret.use", name: NAME });
    access.grant({ kind: "net.fetch", host: "127.0.0.1", port: first.port });
    access.grant({ kind: "net.fetch", host: "localhost", port: landing.port });
    const requests: SecretDeliveryRequest[] = [];
    const service = createSecretUseService({
      access,
      delivery: transmitter(requests),
      redaction: redactionOk,
      platformPorts: [],
    });
    const used = await service.use(child(), useBody(first.port));
    assert(!used.ok);
    assertEquals(used.error.code, "forbidden");
    assertEquals(first.seen.length, 1);
    assertEquals(landing.seen.length, 0);
  } finally {
    await first.stop();
    await landing.stop();
  }
});

Deno.test("apps/permissions#R16: 같은 host의 redirect도 grant 밖 port로는 가지 않는다", async () => {
  const landing = serve(() => new Response("landed"));
  const first = serve((_request) =>
    new Response(null, {
      status: 302,
      headers: { location: `http://127.0.0.1:${landing.port}/next` },
    })
  );
  try {
    const access = fixture(first.port);
    const requests: SecretDeliveryRequest[] = [];
    const service = createSecretUseService({
      access,
      delivery: transmitter(requests),
      redaction: redactionOk,
      platformPorts: [],
    });
    const used = await service.use(child(), useBody(first.port));
    assert(!used.ok);
    assertEquals(used.error.code, "forbidden");
    assertEquals(landing.seen.length, 0);
  } finally {
    await first.stop();
    await landing.stop();
  }
});

// --- platform SecretAllowance port의 apps 구현 -------------------------------------------------

function tx(access: ReturnType<typeof createAccessFixture>) {
  const declared = access.declarations;
  return {
    sql: {
      all: (_sql: string, params: readonly unknown[]) =>
        access.grants
          .filter((grant) =>
            grant.app === params[0] && grant.status === params[1]
          )
          .map((grant) => ({
            ...grant,
            scope: JSON.stringify(grant.scope),
          })),
      get: () => undefined,
    },
    portLookup: { present: (key: object) => key === currentDeclarations },
    port: () => ({
      get: (_sql: unknown, app: string) =>
        ok(app === APP ? declared : null) as Result<typeof declared>,
    }),
  };
}

function allowanceRequest(
  over: Partial<SecretAllowanceRequest> = {},
  principal = `app:${APP}`,
): SecretAllowanceRequest {
  return {
    context: {
      principal,
      actor: "machine",
      scope: { operations: ["secret.send"], targets: {} },
      conditions: { process: NONCE_PROCESS, task: "app-ops" },
      credential_ref: "cred",
    },
    name: NAME,
    purpose: "app_secret",
    destination: { kind: "https", origin: "https://api.example.com" },
    ...over,
  };
}
const NONCE_PROCESS = "nonce-1";

Deno.test("apps/permissions#R14: platform SecretAllowance는 현재 선언 이름과 net.fetch 목적지가 grant 안일 때만 허용하고 회수하면 거절한다", () => {
  const access = createAccessFixture({
    permissions: [
      requirement("secret.use", { name: NAME }),
      requirement("net.fetch", { host: "api.example.com", port: 443 }),
    ],
  });
  const secret = access.grant({ kind: "secret.use", name: NAME });
  const check = createSecretAllowance(
    tx(access) as unknown as Parameters<typeof createSecretAllowance>[0],
  );
  // net grant가 없으면 선언 이름이 있어도 거절한다.
  assertEquals(check(allowanceRequest()).ok, false);
  access.grant({ kind: "net.fetch", host: "api.example.com", port: 443 });
  assert(check(allowanceRequest()).ok);
  // 이름·목적지·앱이 다르면 거절한다.
  assertEquals(check(allowanceRequest({ name: "other.token" })).ok, false);
  assertEquals(
    check(allowanceRequest({
      destination: { kind: "https", origin: "https://api.example.com:8443" },
    })).ok,
    false,
  );
  assertEquals(check(allowanceRequest({}, `app:${OTHER_APP}`)).ok, false);
  assertEquals(check(allowanceRequest({}, "agent:run")).ok, false);
  assertEquals(
    check(allowanceRequest({ purpose: "provider_credential" })).ok,
    false,
  );
  access.revoke(secret);
  const revoked = check(allowanceRequest());
  assert(!revoked.ok);
  assertEquals(revoked.error.code, "forbidden");
});
