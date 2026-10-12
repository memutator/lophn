import { assert, assertEquals } from "@std/assert";

import type { CoreCall } from "../../../ipc/core.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import { coreAppDetailSource, type OpenDecision } from "./core-source.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fd01";
const REL = "rel_01h455vb4pex5v6nkc6gd5fd04";

function core(values: Record<string, unknown>) {
  const calls: CoreCall[] = [];
  const source: CoreSource = {
    subscribe: () => () => {},
    call(input) {
      calls.push(input);
      const key = `${input.resource}/${input.method}`;
      return Promise.resolve(
        key in values
          ? { ok: true, value: values[key] }
          : { ok: false, error: { code: "not_found", message: "x" } },
      );
    },
  };
  return { source, calls };
}

Deno.test("shell/wording#R4: core의 release·grant 응답을 Version·접근 모양으로 옮기고 정확한 원문은 그대로 둔다", async () => {
  const fake = core({
    "releases/list": {
      releases: [
        {
          id: "rel_01h455vb4pex5v6nkc6gd5fd03",
          number: 3,
          status: "active",
          created_at: "2026-10-01T09:00:00Z",
          ticket_source: null,
          tests: ["vrf_01h455vb4pex5v6nkc6gd5fd01"],
          failure: null,
          data_schema: 2,
        },
        {
          id: REL,
          number: 4,
          status: "failed",
          created_at: "2026-10-02T09:00:00Z",
          ticket_source: { ticket: "tkt_01h455vb4pex5v6nkc6gd5fd01" },
          tests: ["vrf_01h455vb4pex5v6nkc6gd5fd02"],
          failure: { summary: "start check failed" },
          data_schema: 3,
        },
      ],
      next_cursor: null,
    },
    "apps/get": {
      app: {
        name: "Grocery budget",
        active_release: "rel_01h455vb4pex5v6nkc6gd5fd03",
      },
    },
    "grants/list": {
      grants: [
        {
          id: "grt_01h455vb4pex5v6nkc6gd5fd01",
          kind: "fs.read",
          scope: {
            kind: "fs.read",
            path: "/home/pat/receipts",
            recursive: true,
          },
          status: "active",
        },
        {
          id: "grt_01h455vb4pex5v6nkc6gd5fd02",
          kind: "net.fetch",
          scope: { kind: "net.fetch", host: "api.example.com", port: 443 },
          status: "revoked",
        },
        {
          id: "grt_01h455vb4pex5v6nkc6gd5fd03",
          kind: "automation.run",
          scope: {
            kind: "automation.run",
            automation: "weekly",
            command: "send",
            input_hash: "a".repeat(64),
            when: { kind: "on_start" },
          },
          status: "active",
        },
      ],
      next_cursor: null,
      display: {
        requirements: [{
          kind: "secret.use",
          scope: { name: "BANK_TOKEN" },
          reason: "Signs in",
          granted: false,
        }],
        combination_warnings: [{
          key: "permissions.warning.file-read-and-network",
        }],
      },
    },
  });
  const source = coreAppDetailSource(fake.source, undefined);

  const versions = await source.versions(APP);
  assert(versions.ok);
  assertEquals(versions.value.current, "rel_01h455vb4pex5v6nkc6gd5fd03");
  // 새것부터 정렬하고 실패 근거와 Task 출처를 옮긴다.
  assertEquals(versions.value.versions.map((row) => row.number), [4, 3]);
  assertEquals(versions.value.versions[0].failure, "start check failed");
  assertEquals(
    versions.value.versions[0].ticket,
    "tkt_01h455vb4pex5v6nkc6gd5fd01",
  );
  assertEquals(
    fake.calls.find((call) => call.resource === "releases")?.body,
    { app: APP, limit: 200 },
  );

  const access = await source.access(APP);
  assert(access.ok);
  assertEquals(
    access.value.grants.map((grant) => [grant.kind, grant.exact, grant.active]),
    [
      ["fs.read", "/home/pat/receipts", true],
      ["net.fetch", "api.example.com:443", false],
      ["automation.run", "weekly", true],
    ],
  );
  assertEquals(access.value.grants[2].inputHash, "a".repeat(64));
  assertEquals(access.value.requirements[0].exact, "BANK_TOKEN");
  assertEquals(access.value.warnings, [
    "permissions.warning.file-read-and-network",
  ]);
});

Deno.test("shell/wording#R10: 범위 밖이거나 없는 blueprint는 null이고 읽기 실패는 code만 돌려준다", async () => {
  const fake = core({});
  const source = coreAppDetailSource(fake.source, undefined);
  assertEquals(await source.blueprint(APP), { ok: true, value: null });
  assertEquals(await source.appName(APP), null);
  const failed = await source.compare(REL);
  assertEquals(failed, { ok: false, code: "not_found" });
});

Deno.test("shell/wording#R10: 결정은 보호 창 열기로만 보내고 정확한 값은 창이 다시 읽으며, 창이 없으면 열 수 없다고 답한다", async () => {
  const intents: unknown[] = [];
  const open: OpenDecision = (intent) => {
    intents.push(intent);
    return Promise.resolve({ windowId: "w1" });
  };
  const fake = core({});
  const source = coreAppDetailSource(fake.source, open);
  assertEquals(
    await source.decide({ kind: "use_version", app: APP, release: REL }),
    {
      ok: true,
      value: true,
    },
  );
  await source.decide({
    kind: "remove_access",
    app: APP,
    grant: "grt_01h455vb4pex5v6nkc6gd5fd01",
  });
  assertEquals(intents, [
    {
      request: {
        kind: "owner_decision",
        concern: "apps/releases",
        decision: "start_activation",
        targets: [REL],
      },
      parentWindow: "requesting-window",
    },
    {
      request: {
        kind: "owner_decision",
        concern: "apps/permissions",
        decision: "revoke_grant",
        targets: [APP, "grt_01h455vb4pex5v6nkc6gd5fd01"],
      },
      parentWindow: "requesting-window",
    },
  ]);
  // 결정 창을 여는 일 말고 core를 바꾸는 호출은 없다.
  assertEquals(fake.calls.filter((call) => call.kind === "command"), []);

  const closed = coreAppDetailSource(
    fake.source,
    () => Promise.resolve({ code: "forbidden" }),
  );
  assertEquals(await closed.decide({ kind: "change_access", app: APP }), {
    ok: false,
    code: "forbidden",
  });
  const none = coreAppDetailSource(fake.source, undefined);
  assertEquals(await none.decide({ kind: "connect_apps", app: APP }), {
    ok: false,
    code: "unavailable",
  });
});

Deno.test("shell/wording#R10: preview는 준비될 때까지 기다린 뒤에만 열고 준비되지 못하면 열지 않는다", async () => {
  const calls: string[] = [];
  let polls = 0;
  const source: CoreSource = {
    subscribe: () => () => {},
    call(input) {
      calls.push(`${input.resource}/${input.method}`);
      if (input.method === "get" && input.resource === "releases") {
        return Promise.resolve({
          ok: true,
          value: { release: { bundle_hash: "c".repeat(64) } },
        });
      }
      if (input.method === "start") {
        return Promise.resolve({ ok: true, value: { process_nonce: "n1" } });
      }
      polls += 1;
      return Promise.resolve({
        ok: true,
        value: {
          observation: polls < 2 ? { ready: false } : { ready: true },
        },
      });
    },
  };
  const detail = coreAppDetailSource(source, undefined);
  assertEquals(await detail.startPreview(APP, REL), {
    ok: true,
    value: { nonce: "n1" },
  });
  assertEquals(calls, [
    "releases/get",
    "previews/start",
    "previews/get",
    "previews/get",
  ]);
  const failing = coreAppDetailSource({
    subscribe: () => () => {},
    call: (input) =>
      Promise.resolve(
        input.method === "get" && input.resource === "releases"
          ? { ok: true, value: { release: { bundle_hash: "c".repeat(64) } } }
          : input.method === "start"
          ? { ok: true, value: { process_nonce: "n2" } }
          : {
            ok: true,
            value: { observation: { ready: false, reason: { code: "x" } } },
          },
      ),
  }, undefined);
  assertEquals(await failing.startPreview(APP, REL), {
    ok: false,
    code: "unavailable",
  });
});

Deno.test("apps/automations#R13: automation 끄기는 화면에서 읽은 grant·automation·CAS를 확인 창 없이 보낸다", async () => {
  const grant = "grt_01h455vb4pex5v6nkc6gd5fd03";
  const fake = core({
    "grants/list": {
      grants_seq: "18",
      grants: [{
        id: grant,
        kind: "automation.run",
        scope: {
          automation: "weekly",
          command: "send",
          input_hash: "a".repeat(64),
        },
        status: "active",
      }],
    },
    "grants/revoke_automation": {},
  });
  const source = coreAppDetailSource(fake.source, () => {
    throw new Error("no confirmation");
  });
  assertEquals(await source.turnOffAutomation(grant), {
    ok: false,
    code: "not_found",
  });
  await source.access(APP);
  assertEquals(await source.turnOffAutomation(grant), {
    ok: true,
    value: true,
  });
  assertEquals(fake.calls.at(-1)?.body, {
    input: { app: APP, grant, automation: "weekly" },
    compare: { grants_seq: "18" },
    prepared: [],
    idempotency_key: `automation-off:${grant}:18`,
  });
});

Deno.test("apps/blueprint#R2: Version preview는 선택한 release의 blueprint를 읽는다", async () => {
  const fake = core({});
  await coreAppDetailSource(fake.source).blueprint(APP, REL);
  assertEquals(fake.calls[0].body, { app: APP, release: REL });
});
