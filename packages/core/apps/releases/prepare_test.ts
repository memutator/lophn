// release.prepare 확정(apps/releases#R5, R6, R7, R18, apps/sdk#R22). 같은 bundle hash의 통과한 app test와
// 현재 ticket claim을 같은 transaction에서 다시 확인하고, 불변 prepared Release를 남긴다.
import { assert, assertEquals } from "@std/assert";
import {
  releasePrepare,
  releasePrepareBundle,
  releasesGet,
} from "../../../protocol/apps/mod.ts";
import { createReleaseCommands } from "./commands.ts";
import { createReleaseReads } from "./reads.ts";
import {
  APP,
  blueprint,
  CAC,
  command,
  machineContext,
  OTHER_APP,
  prepareInput,
  type ReleasesLedger,
  releasesLedger,
  sha256,
  TICKET,
  userContext,
  VRF,
} from "./testing/mod.ts";

const prepare = createReleaseCommands().prepare;

function run(
  ledger: ReleasesLedger,
  input: Record<string, unknown>,
  ctx = machineContext(),
) {
  return prepare.handle(
    ledger.tx(),
    ctx,
    releasePrepare.input.parse(input),
    {},
  );
}

function passingTest(ledger: ReleasesLedger, input: Record<string, unknown>) {
  ledger.verifications.set(VRF, {
    id: VRF,
    app: APP,
    kind: "app_test",
    result: "pass",
    bundle_hash: String(input.bundle_hash),
  });
}

function rejected(
  result: { ok: boolean; error?: { code: string } },
  code: string,
): void {
  assert(!result.ok, JSON.stringify(result));
  assertEquals(result.error?.code, code);
}

const CLAIM = { ticket: TICKET, claim_seq: "7" };
const CODING = `coding_agent:${CAC}`;

Deno.test("apps/releases#R5: release 없이 테스트한 bundle은 같은 hash의 pass만 준비된다", () => {
  const ledger = releasesLedger();
  try {
    const input = prepareInput(blueprint());
    passingTest(ledger, input);
    const prepared = run(ledger, input);
    assert(prepared.ok, JSON.stringify(prepared));
    assertEquals(prepared.value.release.status, "prepared");
    assertEquals(prepared.value.release.number, 1);
    assertEquals(prepared.value.release.tests, [VRF]);
    assertEquals(prepared.value.release.ticket_source, null);
    assertEquals(ledger.emitted.map((event) => event.type), [
      "ReleasePrepared",
    ]);
    // 같은 ledger의 읽기가 불변 release를 그대로 준다.
    const read = createReleaseReads().get.handle(
      ledger.snapshot(),
      userContext(),
      releasesGet.input.parse({ release: prepared.value.release.id }),
    );
    assert(read.ok);
    assertEquals(read.value.release, prepared.value.release);
  } finally {
    ledger.close();
  }
});

Deno.test("apps/releases#R5: 한 byte 바꾼 bundle과 자가 제출 결과는 거절한다", () => {
  const ledger = releasesLedger();
  try {
    const tested = prepareInput(blueprint());
    passingTest(ledger, tested);
    // 한 byte가 다른 bundle은 hash가 달라 그 test가 근거가 되지 못한다.
    const changed = prepareInput(
      blueprint({ description: "Keeps two calendars" }),
    );
    rejected(run(ledger, changed), "invalid_input");
    // 이 hash의 test라는 주장만 있고 runner 기록이 없는 id는 근거가 아니다.
    const claimed = prepareInput(blueprint(), {
      tests: ["vrf_01h455vb4pex5v6nkc6gd5fdw9"],
    });
    rejected(run(ledger, claimed), "invalid_input");
    // 다른 앱의 통과, 다른 종류의 통과도 같은 거절이다.
    ledger.verifications.set(VRF, {
      id: VRF,
      app: OTHER_APP,
      kind: "app_test",
      result: "pass",
      bundle_hash: String(tested.bundle_hash),
    });
    rejected(run(ledger, tested), "invalid_input");
    ledger.verifications.set(VRF, {
      id: VRF,
      app: APP,
      kind: "reproduction",
      result: "pass",
      bundle_hash: String(tested.bundle_hash),
    });
    rejected(run(ledger, tested), "invalid_input");
    // 같은 hash여도 통과하지 못했으면 준비되지 않는다.
    ledger.verifications.set(VRF, {
      id: VRF,
      app: APP,
      kind: "app_test",
      result: "fail",
      bundle_hash: String(tested.bundle_hash),
    });
    rejected(run(ledger, tested), "unavailable");
    assertEquals(ledger.emitted, []);
  } finally {
    ledger.close();
  }
});

Deno.test("apps/releases#R1: machine 확정만 받고 hash·manifest가 맞지 않는 결과는 거절한다", () => {
  const ledger = releasesLedger();
  try {
    const input = prepareInput(blueprint());
    passingTest(ledger, input);
    rejected(run(ledger, input, userContext()), "forbidden");
    rejected(
      run(ledger, { ...input, blueprint_hash: "d".repeat(64) }),
      "invalid_input",
    );
    rejected(
      run(ledger, { ...input, bundle_hash: "d".repeat(64) }),
      "invalid_input",
    );
    // bundle 안 blueprint.json이 다른 hash를 고정하면 거절이다.
    const manifest = input.manifest as {
      files: { path: string; hash: string }[];
    };
    const tampered = {
      ...manifest,
      files: manifest.files.map((file) =>
        file.path === "blueprint.json"
          ? { ...file, hash: "e".repeat(64) }
          : file
      ),
    };
    rejected(run(ledger, { ...input, manifest: tampered }), "invalid_input");
    // 구조 검증기를 통과하지 못한 blueprint는 hash가 같아도 거절이다.
    rejected(
      run(ledger, { ...input, blueprint: { name: "", extra: true } }),
      "invalid_input",
    );
    assertEquals(ledger.emitted, []);
  } finally {
    ledger.close();
  }
});

Deno.test("apps/releases#R19: 이어진 migration 경로만 받고 도착이 release의 schema다", () => {
  const ledger = releasesLedger();
  try {
    const input = prepareInput(blueprint());
    passingTest(ledger, input);
    const change = (from: number, to: number) => ({
      from,
      to,
      script_hash: sha256(`${from}-${to}`),
      description: `drops a column ${from}->${to}`,
    });
    rejected(
      run(ledger, {
        ...input,
        data_schema: 3,
        data_changes: [change(0, 1), change(2, 3)],
      }),
      "invalid_input",
    );
    rejected(
      run(ledger, { ...input, data_schema: 3, data_changes: [change(0, 2)] }),
      "invalid_input",
    );
    const fine = run(ledger, {
      ...input,
      data_schema: 2,
      data_changes: [change(0, 1), change(1, 2)],
    });
    assert(fine.ok, JSON.stringify(fine));
    assertEquals(fine.value.release.data_changes.length, 2);
  } finally {
    ledger.close();
  }
});

Deno.test("apps/sdk#R22: capability package를 쓰는 blueprint가 요구 permission을 빠뜨리면 준비를 거절한다", () => {
  const ledger = releasesLedger();
  try {
    const cases: { name: string; permission: string }[] = [
      { name: "@lophn/cap-net", permission: "net.fetch" },
      { name: "@lophn/cap-save", permission: "document.save" },
      { name: "@lophn/cap-fs", permission: "fs.read" },
    ];
    for (const item of cases) {
      const input = prepareInput(blueprint({
        sdk_dependencies: [{ name: item.name, version: "1.0.0" }],
      }));
      passingTest(ledger, input);
      const refused = run(ledger, input);
      rejected(refused, "invalid_input");
      assert(
        !refused.ok &&
          (refused.error.details as { package: string }).package === item.name,
      );
    }
    // 요구를 선언하면 준비된다. cap-secret은 secret.use와 net.fetch 둘 다 필요하다.
    const secret = prepareInput(blueprint({
      sdk_dependencies: [{ name: "@lophn/cap-secret", version: "1.0.0" }],
      permissions: [{
        kind: "secret.use",
        scope: { name: "calendar-token" },
        reason: "reads the calendar",
      }],
    }));
    passingTest(ledger, secret);
    rejected(run(ledger, secret), "invalid_input");
    const complete = prepareInput(blueprint({
      sdk_dependencies: [{ name: "@lophn/cap-secret", version: "1.0.0" }],
      permissions: [
        {
          kind: "net.fetch",
          scope: { host: "api.example.com", port: 443 },
          reason: "calls the calendar api",
        },
        {
          kind: "secret.use",
          scope: { name: "calendar-token" },
          reason: "reads the calendar",
        },
      ],
    }));
    passingTest(ledger, complete);
    const prepared = run(ledger, complete);
    assert(prepared.ok, JSON.stringify(prepared));
  } finally {
    ledger.close();
  }
});

Deno.test("apps/releases#R6: 새 coding 준비는 ticket 출처가 필수이고 claim이 현재가 아니면 요청 때도 확정 때도 거절한다", () => {
  const ledger = releasesLedger();
  try {
    const input = prepareInput(blueprint(), { created_by: CODING });
    passingTest(ledger, input);
    // 출처 없는 coding 준비는 기존 claim 없는 수리 fallback을 입구로 쓰는 것이다.
    rejected(run(ledger, input), "invalid_input");
    const withSource = { ...input, ticket_source: CLAIM };
    // 사람·machine 준비에 coding ticket을 붙일 수는 없다.
    rejected(
      run(ledger, { ...withSource, created_by: "machine" }),
      "invalid_input",
    );
    for (
      const reason of [
        "missing",
        "expired",
        "released",
        "revoked",
        "changed",
        "wrong_connection",
      ]
    ) {
      ledger.claims.script = () => ok({ ok: false, reason });
      const refused = run(ledger, withSource);
      rejected(refused, "conflict");
      assert(!refused.ok && refused.error.message.includes(reason));
    }
    // 요청 때 현재였던 claim이 긴 준비 뒤 확정 때 바뀌었으면 거절이다. 같은 검사를 두 번 부른다.
    const seen: unknown[] = [];
    let current = true;
    ledger.claims.script = (call) => {
      seen.push(call);
      return current
        ? ok({ ok: true, expires_at: "2026-10-06T01:00:00.000Z", app: APP })
        : ok({ ok: false, reason: "changed" });
    };
    const atRequest = checkPreparationClaim(ledger.tx(), CODING, CLAIM, APP);
    assert(atRequest.ok);
    current = false;
    rejected(run(ledger, withSource), "conflict");
    assertEquals(ledger.emitted, []);
    // connection·claim seq·기한은 요청한 connection의 현재 claim으로 묻는다.
    assertEquals(seen[0], {
      ticket: TICKET,
      claim_seq: "7",
      connection: CAC,
      now: "2026-10-06T00:00:00.000Z",
    });
  } finally {
    ledger.close();
  }
});

Deno.test("apps/releases#R6: claim이 현재면 출처를 불변으로 남기고 claim이 풀린 뒤에도 그대로 읽는다", () => {
  const ledger = releasesLedger();
  try {
    const input = prepareInput(blueprint(), {
      created_by: CODING,
      ticket_source: CLAIM,
    });
    passingTest(ledger, input);
    ledger.claims.script = () =>
      ok({ ok: true, expires_at: "2026-10-06T01:00:00.000Z", app: APP });
    const prepared = run(ledger, input);
    assert(prepared.ok, JSON.stringify(prepared));
    assertEquals(prepared.value.release.ticket_source, CLAIM);
    assertEquals(prepared.value.release.created_by, CODING);
    // claim이 풀리거나 ticket이 취소돼도 준비 때의 출처는 release에 남은 사실이다.
    ledger.claims.script = () => ok({ ok: false, reason: "released" });
    const read = createReleaseReads().get.handle(
      ledger.snapshot(),
      userContext(),
      releasesGet.input.parse({ release: prepared.value.release.id }),
    );
    assert(read.ok);
    assertEquals(read.value.release?.ticket_source, CLAIM);
    // 준비한 내용은 바꿀 수 없다.
    assertThrowsImmutable(ledger, prepared.value.release.id);
  } finally {
    ledger.close();
  }
});

function assertThrowsImmutable(ledger: ReleasesLedger, id: string): void {
  let blocked = false;
  try {
    ledger.db.prepare("UPDATE releases SET bundle_hash = ? WHERE id = ?").run(
      "f".repeat(64),
      id,
    );
  } catch {
    blocked = true;
  }
  assert(blocked);
}

Deno.test("apps/releases#R7: 옛 ticket 없는 release는 가짜 출처 없이 null로 읽고 선택할 수 있다", () => {
  const ledger = releasesLedger();
  try {
    // 과거 이력: 출처 없이 준비된 release.
    const legacy = prepareInput(blueprint());
    passingTest(ledger, legacy);
    const prepared = run(ledger, legacy);
    assert(prepared.ok, JSON.stringify(prepared));
    assertEquals(prepared.value.release.ticket_source, null);
    // 새 coding 준비는 이 이력과 상관없이 새 claim을 요구한다.
    const next = prepareInput(blueprint({ description: "Keeps calendars" }), {
      created_by: CODING,
      key: "prepare-key-0002",
    });
    ledger.verifications.set(VRF, {
      id: VRF,
      app: APP,
      kind: "app_test",
      result: "pass",
      bundle_hash: String(next.bundle_hash),
    });
    rejected(run(ledger, next), "invalid_input");
    // 옛 release 읽기에는 새 ticket을 강제하지 않는다.
    const listed = createReleaseReads().list.handle(
      ledger.snapshot(),
      userContext(),
      { app: APP },
    );
    assert(listed.ok);
    assertEquals(listed.value.releases.map((r) => r.ticket_source), [null]);
  } finally {
    ledger.close();
  }
});

Deno.test("apps/releases#R1: 없는 앱과 범위 밖 앱·보관된 앱은 준비되지 않고 앞의 둘은 같은 답이다", () => {
  const ledger = releasesLedger();
  try {
    const input = prepareInput(blueprint());
    passingTest(ledger, input);
    const absent = run(ledger, {
      ...input,
      app: "app_01h455vb4pex5v6nkc6gd5fdw9",
    });
    ledger.hidden.add(APP);
    const outside = run(ledger, input);
    assertEquals(outside, absent);
    ledger.hidden.delete(APP);
    ledger.db.prepare("UPDATE apps SET status = 'archived' WHERE id = ?").run(
      APP,
    );
    rejected(run(ledger, input), "conflict");
  } finally {
    ledger.close();
  }
});

Deno.test("apps/releases#R18: 열린 problem의 code 삭제는 준비를 막지 않고 비교의 경고로만 남는다", () => {
  const ledger = releasesLedger();
  try {
    const code = {
      code: "calendar_sync_failed",
      message_key: "app.calendar.sync_failed",
      message: "The calendar could not be synced",
      fixer: "coding_agent" as const,
    };
    const first = prepareInput(blueprint({ problem_codes: [code] }));
    passingTest(ledger, first);
    const one = run(ledger, first);
    assert(one.ok, JSON.stringify(one));
    // 선언을 삭제한 새 release는 준비된다. 닫힘은 problems/closing이 따로 판단한다.
    const removed = prepareInput(blueprint(), { key: "prepare-key-0003" });
    passingTest(ledger, removed);
    const two = run(ledger, removed);
    assert(two.ok, JSON.stringify(two));
    const compared = createReleaseReads().compare.handle(
      ledger.snapshot(),
      userContext(),
      {
        release: two.value.release.id,
        previous_release: one.value.release.id,
      },
    );
    assert(compared.ok, JSON.stringify(compared));
    assertEquals(compared.value.comparison.added_problem_code_warnings, [
      "removed:calendar_sync_failed",
    ]);
    // 경고는 닫힘 근거가 아니므로 release는 problem을 건드리지 않는다.
    assertEquals(ledger.emitted.map((event) => event.type), [
      "ReleasePrepared",
      "ReleasePrepared",
    ]);
  } finally {
    ledger.close();
  }
});

Deno.test("apps/releases#R1: 준비한 release의 선언 사실은 command·automation·problem code를 현재 선언으로 낸다", () => {
  const ledger = releasesLedger();
  try {
    const value = blueprint({
      commands: [
        command("sync", "external", {
          input: {
            type: "object",
            properties: { days: { type: "integer", default: 7 } },
            additionalProperties: false,
          },
        }),
        command("list"),
      ],
      automatic_tasks: [{
        key: "nightly",
        label: "Nightly sync",
        when: { kind: "interval", interval_ms: 3_600_000 },
        command: "sync",
        input: {},
      }],
    });
    const input = prepareInput(value);
    passingTest(ledger, input);
    const prepared = run(ledger, input);
    assert(prepared.ok, JSON.stringify(prepared));
    ledger.db.prepare("UPDATE releases SET status = 'active' WHERE id = ?").run(
      prepared.value.release.id,
    );
    const facts = JSON.parse(
      String(
        ledger.db.prepare("SELECT declarations FROM releases").get()
          ?.declarations,
      ),
    );
    assertEquals(facts.commands, ["list", "sync"]);
    assertEquals(facts.automations.length, 1);
    assertEquals(facts.automations[0].external, true);
    // default를 채운 정규 입력의 hash다.
    assertEquals(facts.automations[0].input_hash, sha256('{"days":7}'));
  } finally {
    ledger.close();
  }
});

Deno.test("apps/releases#R6: 다른 앱의 ticket claim으로 이 앱의 release를 준비하지 못하고 없는 ticket과 같은 거절이다", () => {
  const ledger = releasesLedger();
  try {
    const input = prepareInput(blueprint(), {
      created_by: CODING,
      ticket_source: CLAIM,
    });
    passingTest(ledger, input);
    ledger.claims.script = () =>
      ok({
        ok: true,
        expires_at: "2026-10-06T01:00:00.000Z",
        app: OTHER_APP,
      });
    const elsewhere = run(ledger, input);
    rejected(elsewhere, "conflict");
    ledger.claims.script = () => ok({ ok: false, reason: "missing" });
    const absent = run(ledger, input);
    assertEquals(
      !elsewhere.ok && elsewhere.error.message,
      !absent.ok && absent.error.message,
    );
    // 앱을 알려 주지 않는 검사 결과는 믿지 않는다.
    ledger.claims.script = () =>
      ok({ ok: true, expires_at: "2026-10-06T01:00:00.000Z" });
    rejected(run(ledger, input), "conflict");
    assertEquals(ledger.emitted, []);
  } finally {
    ledger.close();
  }
});

Deno.test("apps/releases#R9: compare 읽기는 명시한 이전 release나 채택한 release를 기준으로 하고 다른 앱의 release는 없는 것과 같다", () => {
  const ledger = releasesLedger();
  try {
    const reads = createReleaseReads();
    const prepareOne = (
      value: Parameters<typeof blueprint>[0],
      key: string,
    ) => {
      const input = prepareInput(blueprint(value), { key });
      passingTest(ledger, input);
      const prepared = run(ledger, input);
      assert(prepared.ok, JSON.stringify(prepared));
      return prepared.value.release;
    };
    const first = prepareOne({}, "prepare-key-0010");
    // 채택된 release가 없으면 이전이 없는 처음 release와의 비교다.
    const alone = reads.compare.handle(ledger.snapshot(), userContext(), {
      release: first.id,
    });
    assert(alone.ok);
    assertEquals(alone.value.comparison.previous_release, null);
    ledger.db.prepare("UPDATE releases SET status = 'active' WHERE id = ?")
      .run(first.id);
    const second = prepareOne(
      { commands: [command("list"), command("export")] },
      "prepare-key-0011",
    );
    const against = reads.compare.handle(ledger.snapshot(), userContext(), {
      release: second.id,
    });
    assert(against.ok, JSON.stringify(against));
    assertEquals(against.value.comparison.previous_release, first.id);
    assertEquals(against.value.comparison.added_commands, ["export"]);
    // 같은 앱의 다른 release를 기준으로 고를 수도 있다.
    const chosen = reads.compare.handle(ledger.snapshot(), userContext(), {
      release: first.id,
      previous_release: second.id,
    });
    assert(chosen.ok);
    assertEquals(chosen.value.comparison.removed_commands, ["export"]);
    // 다른 앱의 release는 기준으로 쓸 수 없고 없는 release와 같은 답이다.
    // 준비한 release는 앱을 바꿀 수 없다. 다른 앱의 release와 같은 모양을 만들려고 보호를 푼다.
    ledger.db.exec("DROP TRIGGER releases_immutable");
    ledger.db.prepare("UPDATE releases SET app = ? WHERE id = ?").run(
      OTHER_APP,
      first.id,
    );
    const elsewhere = reads.compare.handle(ledger.snapshot(), userContext(), {
      release: second.id,
      previous_release: first.id,
    });
    const absent = reads.compare.handle(ledger.snapshot(), userContext(), {
      release: second.id,
      previous_release: "rel_01h455vb4pex5v6nkc6gd5fdw9",
    });
    assertEquals(elsewhere, absent);
    assert(!elsewhere.ok && elsewhere.error.code === "not_found");
  } finally {
    ledger.close();
  }
});

import { ok } from "../../../base/mod.ts";
import { checkPreparationClaim } from "./commands.ts";

Deno.test("apps/releases#R6: 준비 접수는 요청 때 claim·앱 범위·source 연결을 확인하고 아무것도 기록하지 않는다", () => {
  const ledger = releasesLedger();
  try {
    const bundle = createReleaseCommands().prepareBundle;
    const ask = (
      overrides: Record<string, unknown> = {},
      ctx = machineContext(),
    ) =>
      bundle.handle(
        ledger.tx(),
        ctx,
        releasePrepareBundle.input.parse({
          app: APP,
          commit: "1".repeat(40),
          request_key: "prep-1",
          ...overrides,
        }),
        {},
      );
    // source가 연결되지 않은 앱과 없는 앱은 같은 거절이다.
    const unconnected = ask();
    rejected(unconnected, "forbidden");
    assertEquals(unconnected, ask({ app: "app_01h455vb4pex5v6nkc6gd5fdw9" }));
    ledger.tx().sql.run("UPDATE apps SET source_path = ? WHERE id = ?", [
      "/work/calendar",
      APP,
    ]);
    const accepted = ask();
    assert(accepted.ok, JSON.stringify(accepted));
    assertEquals(accepted.value.status, "preparing");
    assertEquals(ledger.emitted, []);
    // 사람은 준비를 접수하지 못한다.
    rejected(ask({}, userContext()), "forbidden");
    // coding 접수의 ticket claim은 요청 때도 현재여야 한다.
    const coding = { ...machineContext(), actor: CODING };
    const withSource = { ticket_source: CLAIM };
    for (const reason of ["missing", "expired", "released", "changed"]) {
      ledger.claims.script = () => ok({ ok: false, reason });
      const refused = ask(withSource, coding);
      rejected(refused, "conflict");
      assert(!refused.ok && refused.error.message.includes(reason));
    }
    ledger.claims.script = () =>
      ok({ ok: true, expires_at: "2026-10-06T01:00:00.000Z", app: APP });
    assert(ask(withSource, coding).ok);
    // 다른 앱의 ticket claim으로 이 앱의 준비를 접수하지 못한다.
    ledger.claims.script = () =>
      ok({ ok: true, expires_at: "2026-10-06T01:00:00.000Z", app: OTHER_APP });
    rejected(ask(withSource, coding), "conflict");
    // 사람·machine 접수에 coding ticket을 붙일 수 없다.
    rejected(ask(withSource), "invalid_input");
    assertEquals(ledger.emitted, []);
  } finally {
    ledger.close();
  }
});
