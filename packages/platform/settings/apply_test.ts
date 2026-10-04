import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../contracts/platform/mod.ts";

// merge_test.ts와 같은 타입 경계다. platform ledger 모듈과 settings 모듈의
// 전체 타입을 부르지 않는다(packages/documents/projects/ledger_test.ts 관례).
type CommandEnvelope = {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: readonly string[];
};
type LedgerHarness = {
  command(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<{ result: unknown; replayed: boolean }>>;
  read(
    route: { resource: string; method: string },
    ctx: AuthenticatedContext,
    input: unknown,
  ): Promise<Result<unknown>>;
  inspect(
    query: string,
    params?: readonly unknown[],
  ): Promise<Result<SqlRow[]>>;
  close(): Promise<void>;
};
async function createLedgerHarness(options: {
  registrationModules: readonly URL[];
  credentials?: readonly AuthenticatedContext[];
}): Promise<Result<LedgerHarness>> {
  const specifier = "../../../apps/core/testing/ledger.ts";
  const harness = await import(specifier);
  return harness.createLedgerHarness(options);
}

const registration = new URL("./harness-fixture_test.ts", import.meta.url);

const OPERATIONS = [
  "SettingsDefinitions",
  "GetSettings",
  "SettingsHistory",
  "ApplySettings",
  "ReloadSettings",
  "settings.tests.record_choice",
];

function credential(actor = "user"): AuthenticatedContext {
  return {
    actor,
    principal: "test-user",
    credential_ref: `test:test-user:${actor}`,
    scope: { operations: [...OPERATIONS], targets: {} },
    conditions: {},
  };
}

const user = credential();

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function failure<T>(result: Result<T>): { code: string; message: string } {
  assert(!result.ok, "거절을 기다렸다");
  return { code: result.error.code, message: result.error.message };
}

function applyEnvelope(
  key: string,
  mutations: unknown,
  revision: number,
  defaults: string,
): CommandEnvelope {
  return {
    command: "ApplySettings",
    input: { changes: mutations },
    idempotency_key: key,
    compare: { revision, defaults_revision: defaults },
    prepared: [],
  };
}

function reloadEnvelope(
  key: string,
  revision: number,
  defaults: string,
): CommandEnvelope {
  return {
    command: "ReloadSettings",
    input: {},
    idempotency_key: key,
    compare: { revision, defaults_revision: defaults },
    prepared: [],
  };
}

async function state(
  harness: LedgerHarness,
): Promise<{ revision: number; defaults_revision: string }> {
  const rows = value(
    await harness.inspect(
      "select revision, defaults_revision from settings_state where key = 1",
      [],
    ),
  );
  // settings_state 첫 행은 첫 apply가 기록한다. 그 전 read는 registry 판을 쓴다(R23).
  const definitions = value(
    await harness.read(
      { resource: "settings", method: "definitions" },
      user,
      {},
    ),
  ) as { defaults_revision: string };
  return {
    revision: Number(rows[0]?.["revision"] ?? 0),
    defaults_revision: String(rows[0]?.["defaults_revision"] ??
      definitions.defaults_revision),
  };
}

async function choices(
  harness: LedgerHarness,
): Promise<Map<string, unknown>> {
  const rows = value(
    await harness.inspect(
      "select key, value from setting_choices",
      [],
    ),
  );
  return new Map(rows.map((row) => [String(row["key"]), JSON.parse(String(row["value"]))]));
}

async function historyCount(harness: LedgerHarness): Promise<number> {
  const rows = value(
    await harness.inspect("select count(*) as count from setting_revisions", []),
  );
  return Number(rows[0]?.["count"]);
}

Deno.test("platform/settings#R17, platform/settings#R18: 명시 apply만 판을 바꾸고 한 항목의 오류는 전체를 거절한다", async () => {
  const opened = await createLedgerHarness({
    registrationModules: [registration],
    credentials: [user],
  });
  if (!opened.ok) throw new Error(opened.error.code);
  const harness = opened.value;
  try {
    const before = await state(harness);
    assertEquals(before.revision, 0);
    // apply 없이는 판이 없다(R17). record_choice를 써도 command event·revision은 없다.
    value(
      await harness.command(
        user,
        {
          command: "settings.tests.record_choice",
          input: { key: "shell.reading_width", value: "95" },
          compare: {},
          idempotency_key: "no-apply",
          prepared: [],
        },
      ),
    );
    assertEquals((await state(harness)).revision, 0);
    // 정상 apply. 두 항목을 한 번에 바꾼다(R18).
    const defaults = (await state(harness)).defaults_revision;
    const applied = value(
      await harness.command(
        user,
        applyEnvelope(
          "apply-two",
          [
            { layer: "common", key: "shell.reading_width", action: "set", value: 90 },
            {
              layer: "common",
              key: "documents.tracking",
              action: "set",
              value: { patterns: ["user/*.md"] },
            },
          ],
          0,
          defaults,
        ),
      ),
    );
    const result = applied.result as {
      revision: number;
      changed: boolean;
      applied: { key: string; apply_at: string }[];
    };
    assertEquals(result.revision, 1);
    assertEquals(result.changed, true);
    // apply 시점 효력을 구별한다(R25 절반). current_check와 next_run이 같은 applied에 나뉜다.
    const width = result.applied.find((entry) =>
      entry.key === "shell.reading_width"
    );
    const tracking = result.applied.find((entry) =>
      entry.key === "documents.tracking"
    );
    assertEquals(width?.apply_at, "current_check");
    assertEquals(tracking?.apply_at, "next_run");
    // 하나를 잘못 입력하면 어떤 선택도 바뀌지 않는다(R18).
    const rejected = failure(
      await harness.command(
        user,
        applyEnvelope(
          "apply-broken",
          [
            { layer: "common", key: "shell.reading_width", action: "set", value: 91 },
            { layer: "common", key: "shell.reading_width", action: "set", value: "wide" },
          ],
          1,
          defaults,
        ),
      ),
    );
    assertEquals(rejected.code, "invalid_input");
    const kept = (await state(harness)).revision;
    assertEquals(kept, 1);
    const after = await choices(harness);
    assertEquals(after.get("shell.reading_width"), 90);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/settings#R19: 편집을 시작한 판이 현재 판과 다르면 충돌하고 최신 선택을 읽을 수 있다", async () => {
  const opened = await createLedgerHarness({
    registrationModules: [registration],
    credentials: [user],
  });
  if (!opened.ok) throw new Error(opened.error.code);
  const harness = opened.value;
  try {
    const defaults = (await state(harness)).defaults_revision;
    // 첫 편집이 apply한다.
    value(
      await harness.command(
        user,
        applyEnvelope(
          "apply-first",
          [
            { layer: "common", key: "shell.reading_width", action: "set", value: 70 },
          ],
          0,
          defaults,
        ),
      ),
    );
    // 오래된 판(0)으로 apply하면 충돌이다(R19).
    const stale = failure(
      await harness.command(
        user,
        applyEnvelope(
          "apply-stale",
          [
            { layer: "common", key: "shell.reading_width", action: "set", value: 100 },
          ],
          0,
          defaults,
        ),
      ),
    );
    assertEquals(stale.code, "conflict");
    // 충돌 뒤 최신 선택을 읽을 수 있다(R19).
    const read = value(
      await harness.read({ resource: "settings", method: "get" }, user, {
        keys: ["shell.reading_width"],
      }),
    ) as { settings: { value: unknown }[]; revision: number };
    assertEquals(read.settings[0].value, 70);
    assertEquals(read.revision, 1);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/settings#R20: 이력은 주체·시각·항목·전후·영향 concern·새 판을 남기고 같은 apply는 새 판이 아니다", async () => {
  const opened = await createLedgerHarness({
    registrationModules: [registration],
    credentials: [user],
  });
  if (!opened.ok) throw new Error(opened.error.code);
  const harness = opened.value;
  try {
    const defaults = (await state(harness)).defaults_revision;
    value(
      await harness.command(
        user,
        applyEnvelope(
          "apply-history",
          [
            { layer: "common", key: "shell.reading_width", action: "set", value: 100 },
          ],
          0,
          defaults,
        ),
      ),
    );
    const history = value(
      await harness.read({ resource: "settings", method: "history" }, user, {}),
    ) as {
      revisions: {
        revision: number;
        previous_revision: number | null;
        changes: {
          key: string;
          before_present: boolean;
          before: unknown;
          action: string;
          after: unknown;
        }[];
        affected_concerns: string[];
        actor: string;
      }[];
    };
    assertEquals(history.revisions.length, 2);
    // revision 0 초기 record(선택 없는 시작)와 apply 판이 같이 읽힌다.
    const revision = history.revisions.find((entry) =>
      entry.revision === 1
    );
    assert(revision !== undefined);
    assertEquals(revision.revision, 1);
    assertEquals(revision.previous_revision, 0);
    assertEquals(revision.actor, "user");
    assertEquals(revision.affected_concerns, ["shell/workspace"]);
    assertEquals(revision.changes.length, 1);
    assertEquals(revision.changes[0].key, "shell.reading_width");
    assertEquals(revision.changes[0].before_present, false);
    assertEquals(revision.changes[0].before, null);
    assertEquals(revision.changes[0].action, "set");
    assertEquals(revision.changes[0].after, 100);
    // 같은 내용의 apply는 새 판이 아니다(R20). 초기 record와 apply 판 하나뿐이다.
    value(
      await harness.command(
        user,
        applyEnvelope(
          "apply-same",
          [
            { layer: "common", key: "shell.reading_width", action: "set", value: 100 },
          ],
          1,
          defaults,
        ),
      ),
    );
    assertEquals(await historyCount(harness), 2);
    assertEquals((await state(harness)).revision, 1);
  } finally {
    await harness.close();
  }
});
