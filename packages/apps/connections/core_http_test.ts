// 실제 core(임시 LOPHN_HOME)의 앱 쌍 연결 준비 route(`apps/pair_prepare`·`pair_observe`)를 본다. core의
// 준비 서비스가 ledger의 현재 release 선언·active grant와 supervisor 관측으로 서명하는 것을 확인한다.
// supervisor 관측만 시험 출처로 바꿔 끼운다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import { canonicalize } from "../../base/canonical-json.ts";
import {
  call,
  codeOf,
  command,
  count,
  decide,
} from "../../../apps/core/testing/approvals-fixture.ts";
import {
  type CoreHarness,
  createCoreHarness,
} from "../../../apps/core/testing/core.ts";
import { appConnectOutputSchema } from "../../protocol/apps/mod.ts";
import type {
  ProcessObservation,
  ProcessQuery,
  ProcessSource,
} from "../runtime/mod.ts";
import {
  blueprint,
  command as declared,
  prepareInput,
} from "../releases/testing/mod.ts";

const VRF_A = "vrf_01h455vb4pex5v6nkc6gd5fdw1";
const VRF_B = "vrf_01h455vb4pex5v6nkc6gd5fdw2";

function sourceOf(
  observations: Map<string, ProcessObservation>,
): ProcessSource {
  return {
    current(query: ProcessQuery) {
      const found = observations.get(query.app);
      return Promise.resolve(
        ok(
          found !== undefined && found.mode === query.mode ? found : undefined,
        ),
      );
    },
    restart: () => Promise.resolve(err({ code: "unavailable", message: "no" })),
  };
}

async function open(observations: Map<string, ProcessObservation>) {
  const documents = await import("../../../apps/core/documents.ts");
  const apps = await import("../../../apps/core/apps.ts");
  const fixtures = await import("../releases/testing/mod.ts");
  const opened = await createCoreHarness({
    nowMs: Date.now(),
    io: true,
    teams: [
      { createLedgerRegistration: documents.createLedgerRegistration },
      { createLedgerRegistration: apps.createLedgerRegistration },
      { createLedgerRegistration: fixtures.createLedgerRegistration },
    ],
    teamModules: [
      new URL("../../../apps/core/documents.ts", import.meta.url).href,
      new URL("../../../apps/core/apps.ts", import.meta.url).href,
      new URL("../releases/testing/mod.ts", import.meta.url).href,
    ],
    apps: { process: sourceOf(observations) },
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  return opened.value;
}

async function login(
  harness: CoreHarness,
  actor: "user" | "machine",
  operations: string[],
): Promise<string> {
  const issued = await harness.credential({
    actor,
    principal: `${actor}-${operations.length}`,
    scope: { operations, targets: {} },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return issued.value.token;
}

const USER = ["app.create"];
const MACHINE = [
  "release.prepare",
  "releases.tests.add_verification",
  "releases.tests.adopt",
  "releases.tests.add_grant",
  "app.pair_prepare",
  "app.pair_observe",
  "app.pair_confirm_request",
  "app.pair_confirm_poll",
];

type World = {
  harness: CoreHarness;
  machine: string;
  a: string;
  b: string;
  observations: Map<string, ProcessObservation>;
  releases: { a: string; b: string };
};

function observation(
  app: string,
  release: string,
  nonce: string,
  commands: string[],
): ProcessObservation {
  return {
    app,
    mode: "live",
    release,
    bundleHash: "ab".repeat(32),
    processNonce: nonce,
    endpoint: `/tmp/${nonce}.sock`,
    ready: true,
    accepting: true,
    commands,
    screens: {},
  };
}

// 두 앱과 채택된 release를 만든다. A는 B의 usage.read를 부르겠다고 선언한다.
async function world(
  grant = true,
  granted: string[] = ["usage.read"],
): Promise<World> {
  const observations = new Map<string, ProcessObservation>();
  const harness = await open(observations);
  const user = await login(harness, "user", USER);
  const machine = await login(harness, "machine", MACHINE);
  const ids: string[] = [];
  for (const slug of ["caller", "target"]) {
    const created = await call(
      harness,
      "apps/create",
      user,
      command({ slug, name: slug, description: `${slug} app` }),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    ids.push(String(created.body["id"]));
  }
  const [a, b] = ids;
  const releases = { a: "", b: "" };
  const plans: [string, string, ReturnType<typeof blueprint>][] = [
    [
      a,
      VRF_A,
      blueprint({
        app_connections: [{
          app: b,
          commands: granted,
          reason: "reads",
        }],
      }),
    ],
    [
      b,
      VRF_B,
      blueprint({
        commands: [
          declared("usage.read"),
          declared("usage.admin", "write", {
            confirm: true,
          }),
        ],
      }),
    ],
  ];
  for (const [app, vrf, value] of plans) {
    const input = { ...prepareInput(value), app, tests: [vrf] };
    const stored = await call(
      harness,
      "releases_tests/add_verification",
      machine,
      command({
        id: vrf,
        app,
        kind: "app_test",
        result: "pass",
        bundle_hash: input.bundle_hash,
      }),
    );
    assertEquals(stored.status, 200, JSON.stringify(stored.body));
    const prepared = await call(
      harness,
      "releases/prepare",
      machine,
      command(input),
    );
    assertEquals(prepared.status, 200, JSON.stringify(prepared.body));
    const release = String((prepared.body["release"] as { id: string }).id);
    await call(harness, "releases_tests/adopt", machine, command({ release }));
    if (app === a) releases.a = release;
    else releases.b = release;
  }
  if (grant) {
    const stored = await call(
      harness,
      "releases_tests/add_grant",
      machine,
      command({
        id: "grt_01h455vb4pex5v6nkc6gd5fd01",
        app: a,
        kind: "app.call",
        scope: { app: b, commands: granted },
        approval: "apr_01h455vb4pex5v6nkc6gd5fd01",
      }),
    );
    assertEquals(stored.status, 200, JSON.stringify(stored.body));
  }
  observations.set(a, observation(a, releases.a, "nonce-a", []));
  observations.set(
    b,
    observation(b, releases.b, "nonce-b", ["usage.read", "usage.admin"]),
  );
  return { harness, machine, a, b, observations, releases };
}

function prepareBody(w: World, over: Record<string, unknown> = {}) {
  return {
    source: {
      app: w.a,
      release: w.releases.a,
      mode: "live",
      process_nonce: "nonce-a",
    },
    app: w.b,
    commands: ["usage.read"],
    parent_invocation: null,
    ...over,
  };
}

Deno.test("apps/connections#R1, apps/connections#R4: core의 준비 서비스가 선언∩grant 범위의 연결을 서명하고 선언 밖 command는 서명하지 않는다", async () => {
  const w = await world();
  try {
    const reply = await call(
      w.harness,
      "apps/pair_prepare",
      w.machine,
      prepareBody(w),
    );
    assertEquals(reply.status, 200, JSON.stringify(reply.body));
    const output = appConnectOutputSchema.parse(reply.body);
    assertEquals(output.connection.app, w.b);
    assertEquals(output.connection.process_nonce, "nonce-b");
    assertEquals(output.connection.actor, `app:${w.a}`);
    assertEquals(output.connection.commands, ["usage.read"]);
    assertEquals(output.endpoint, "/tmp/nonce-b.sock");
    // 선언도 grant도 없는 command는 허락 밖이다.
    const outside = await call(
      w.harness,
      "apps/pair_prepare",
      w.machine,
      prepareBody(w, { commands: ["usage.admin"] }),
    );
    assert(outside.status === 403 || outside.status === 404);
  } finally {
    await w.harness.close();
  }
});

Deno.test("apps/connections#R2: 이 자식이 현재 프로세스가 아니거나 release가 바뀐 요청은 거절하고 grant가 없는 대상은 없는 앱과 같다", async () => {
  const w = await world();
  try {
    const stale = await call(
      w.harness,
      "apps/pair_prepare",
      w.machine,
      prepareBody(w, {
        source: {
          app: w.a,
          release: w.releases.a,
          mode: "live",
          process_nonce: "old-nonce",
        },
      }),
    );
    assertEquals(stale.status, 401, JSON.stringify(stale.body));
    const replaced = await call(
      w.harness,
      "apps/pair_prepare",
      w.machine,
      prepareBody(w, {
        source: {
          app: w.a,
          release: w.releases.b,
          mode: "live",
          process_nonce: "nonce-a",
        },
      }),
    );
    assert(replaced.status >= 400);
    // 선언한 target이 아닌 앱과 없는 앱은 같은 답이다.
    const unknown = await call(
      w.harness,
      "apps/pair_prepare",
      w.machine,
      prepareBody(w, { app: "app_01h455vb4pex5v6nkc6gd5fdw9" }),
    );
    const undeclared = await call(
      w.harness,
      "apps/pair_prepare",
      w.machine,
      prepareBody(w, { app: w.a }),
    );
    assertEquals(unknown.status, 404);
    assertEquals(undeclared, unknown);
  } finally {
    await w.harness.close();
  }
});

Deno.test("apps/connections#R3: grant가 없으면 선언한 대상도 허락 밖이고 machine이 아닌 자격은 이 route에 닿지 않는다", async () => {
  const w = await world(false);
  try {
    const none = await call(
      w.harness,
      "apps/pair_prepare",
      w.machine,
      prepareBody(w),
    );
    assert(none.status === 403 || none.status === 404, JSON.stringify(none));
    const user = await login(w.harness, "user", ["app.create"]);
    const refused = await call(
      w.harness,
      "apps/pair_prepare",
      user,
      prepareBody(w),
    );
    assert(refused.status === 403 || refused.status === 404);
    assert(codeOf(refused) !== undefined);
    // grant가 없으면 confirm 준비도 같은 허락 밖이다.
    const confirm = await call(
      w.harness,
      "apps/pair_confirm_request",
      w.machine,
      {
        source: prepareBody(w).source,
        app: w.b,
        command: "usage.admin",
        target_release: w.releases.b,
        target_process_nonce: "nonce-b",
        parent_invocation: null,
      },
    );
    assert(confirm.status === 403 || confirm.status === 404);
  } finally {
    await w.harness.close();
  }
});

// core의 공개 검증 key로 서명을 확인한다. 앱 entrypoint가 쓰는 검증과 같다.
async function verifySigned(
  verifyKey: string,
  signed: { payload: unknown; signature: string },
): Promise<boolean> {
  const raw = fromBase64Url(verifyKey);
  const sig = fromBase64Url(signed.signature);
  const key = await crypto.subtle.importKey("raw", raw, "Ed25519", false, [
    "verify",
  ]);
  return await crypto.subtle.verify(
    "Ed25519",
    key,
    sig,
    new TextEncoder().encode(canonicalize(signed.payload)),
  );
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function callerOf(body: unknown): Record<string, unknown> {
  return appConnectOutputSchema.parse(body).connection.caller as Record<
    string,
    unknown
  >;
}

Deno.test("apps/connections#R7: 알려진 호출의 path가 다음 연결의 부모로 이어진다", async () => {
  const w = await world();
  try {
    const parent = "inv_01h455vb4pex5v6nkc6gd5fdw1";
    const unknownParent = await call(
      w.harness,
      "apps/pair_prepare",
      w.machine,
      prepareBody(w, { parent_invocation: parent }),
    );
    assertEquals(unknownParent.status, 200, JSON.stringify(unknownParent.body));
    // 모르는 부모는 지어 채우지 않고 부모 없음으로 시작한다.
    assertEquals(
      callerOf(unknownParent.body),
      {
        kind: "app",
        app: w.a,
        release: w.releases.a,
        process_nonce: "nonce-a",
        grant: callerOf(unknownParent.body).grant,
        parent_invocation: null,
        path: [w.a],
      },
    );
    const told = await call(w.harness, "apps/pair_observe", w.machine, {
      event: "start",
      process_nonce: "nonce-a",
      invocation: parent,
      caller: { kind: "user" },
    });
    assertEquals(told.status, 200, JSON.stringify(told.body));
    const known = await call(
      w.harness,
      "apps/pair_prepare",
      w.machine,
      prepareBody(w, { parent_invocation: parent }),
    );
    assertEquals(known.status, 200, JSON.stringify(known.body));
    assertEquals(
      callerOf(known.body).parent_invocation,
      parent,
    );
    // 자식이 끝나면 그 자식의 기억이 비워진다.
    await call(w.harness, "apps/pair_observe", w.machine, {
      event: "exit",
      process_nonce: "nonce-a",
    });
    const forgotten = await call(
      w.harness,
      "apps/pair_prepare",
      w.machine,
      prepareBody(w, { parent_invocation: parent }),
    );
    assertEquals(
      callerOf(forgotten.body).parent_invocation,
      null,
    );
  } finally {
    await w.harness.close();
  }
});

Deno.test("apps/connections#R3: confirm=true command는 사람이 허락한 approval을 적용한 뒤에만 core가 서명한 proof를 내고 거절·선언 밖 command는 proof가 없다", async () => {
  const w = await world(true, ["usage.read", "usage.admin"]);
  try {
    const user = await login(w.harness, "user", [
      "GetApproval",
      "grant_approval_request",
      "reject_approval_request",
    ]);
    const source = prepareBody(w).source;
    const request = (command: string) =>
      call(w.harness, "apps/pair_confirm_request", w.machine, {
        source,
        app: w.b,
        command,
        input: undefined,
        target_release: w.releases.b,
        target_process_nonce: "nonce-b",
        parent_invocation: null,
      });
    const poll = (approval: string, wait_ms = 0) =>
      call(w.harness, "apps/pair_confirm_poll", w.machine, {
        source,
        approval,
        wait_ms,
      });
    // confirm 선언이 없는 command는 approval을 만들지 않는다.
    const plain = await request("usage.read");
    assertEquals(plain.status, 400, JSON.stringify(plain.body));
    const asked = await request("usage.admin");
    assertEquals(asked.status, 200, JSON.stringify(asked.body));
    const approval = String(asked.body["approval"]);
    assertEquals(asked.body["state"], "pending");
    // 사람이 결정하기 전에는 proof가 없다.
    assertEquals((await poll(approval)).body["state"], "pending");
    // approval의 요청자는 호출한 앱 자신이다.
    const read = await call(w.harness, "approvals/get", user, { approval });
    assertEquals(read.status, 200, JSON.stringify(read.body));
    const stored = read.body["request"] as {
      requester: string;
      status: string;
    };
    assertEquals(stored.requester, `app:${w.a}`);
    assertEquals(stored.status, "pending");
    const decided = await decide(
      w.harness,
      user,
      read.body["request"] as never,
      "grant",
    );
    assertEquals(decided.status, 200, JSON.stringify(decided.body));
    const granted = await poll(approval);
    assertEquals(granted.status, 200, JSON.stringify(granted.body));
    assertEquals(granted.body["state"], "granted");
    const proof = (granted.body as {
      proof: { payload: Record<string, unknown>; signature: string };
    }).proof;
    assertEquals(proof.payload["command"], "usage.admin");
    assertEquals(proof.payload["release"], w.releases.b);
    assertEquals(proof.payload["process_nonce"], "nonce-b");
    assertEquals(proof.payload["invocation"], granted.body["invocation"]);
    assertEquals(
      (proof.payload["caller"] as { app: string }).app,
      w.a,
    );
    // 서명은 core가 한다.
    assert(await verifySigned(w.harness.appsControl.verifyKey, proof));
    // 접수는 core에 한 번 남는다. 같은 approval로 새 접수가 생기지 않는다.
    const accepted = count(
      w.harness,
      "SELECT COUNT(*) AS n FROM invocations WHERE approval = ?",
      [approval],
    );
    assertEquals(accepted, 1);

    // 사람이 거절한 approval은 proof가 없다.
    const second = await request("usage.admin");
    assertEquals(second.status, 200, JSON.stringify(second.body));
    const secondApproval = String(second.body["approval"]);
    const secondRead = await call(w.harness, "approvals/get", user, {
      approval: secondApproval,
    });
    const rejected = await decide(
      w.harness,
      user,
      secondRead.body["request"] as never,
      "reject",
    );
    assertEquals(rejected.status, 200, JSON.stringify(rejected.body));
    assertEquals((await poll(secondApproval)).body["state"], "rejected");
    // 다른 자식의 approval은 없는 것과 같다.
    const stranger = await call(
      w.harness,
      "apps/pair_confirm_poll",
      w.machine,
      {
        source: { ...source, process_nonce: "other-nonce" },
        approval: secondApproval,
        wait_ms: 0,
      },
    );
    assertEquals(stranger.status, 404);
  } finally {
    await w.harness.close();
  }
});
