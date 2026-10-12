import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../protocol/server/mod.ts";

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
const machine = credential("machine");

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
  defaults_revision: string,
): CommandEnvelope {
  return {
    command: "ApplySettings",
    input: { changes: mutations },
    idempotency_key: key,
    compare: { revision, defaults_revision },
    prepared: [],
  };
}

function reloadEnvelope(
  key: string,
  defaults_revision: string,
): CommandEnvelope {
  return {
    command: "ReloadSettings",
    input: {},
    idempotency_key: key,
    compare: { revision: 0, defaults_revision },
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
    defaults_revision: String(
      rows[0]?.["defaults_revision"] ??
        definitions.defaults_revision,
    ),
  };
}

// registry 판을 read로 조회해 compare에 쓴다. handler는 registry.defaultsRevision과
// 비교하므로 read가 공개하는 값이 곧 compare의 기준이다.
async function defaultsRevision(harness: LedgerHarness): Promise<string> {
  const definitions = value(
    await harness.read(
      { resource: "settings", method: "definitions" },
      user,
      {},
    ),
  ) as { defaults_revision: string };
  return definitions.defaults_revision;
}

Deno.test("platform/settings#R21: reload는 저장 선택과 현재 기본값을 처음부터 병합해 하나의 적용값으로 교체한다", async () => {
  const opened = await createLedgerHarness({
    registrationModules: [registration],
    credentials: [user, machine],
  });
  if (!opened.ok) throw new Error(opened.error.code);
  const harness = opened.value;
  try {
    // 첫 시작은 저장 판이 없다. settings_state row가 없고 read는 registry 판을 쓴다(R23).
    const defaults = await defaultsRevision(harness);
    // reload는 user와 machine 모두 한다(route actors). 첫 reload가 유효 판을 기록한다.
    const reloaded = value(
      await harness.command(machine, reloadEnvelope("reload-first", defaults)),
    );
    const result = reloaded.result as {
      revision: number;
      changed: boolean;
      applied: { key: string }[];
    };
    // 선택 없는 시작 revision 0에서 첫 reload가 판 1을 남긴다(R21).
    assertEquals(result.revision, 1);
    assertEquals(result.changed, true);
    // 같은 판의 reload는 새 판이 아니다(R20).
    const again = value(
      await harness.command(machine, reloadEnvelope("reload-again", defaults)),
    );
    assertEquals((again.result as { changed: boolean }).changed, false);
    assertEquals((await state(harness)).revision, 1);
    // 화면과 CLI가 같은 플랫폼 결과를 쓴다(R21). get read가 reload 뒤 같은 판을 준다.
    const read = value(
      await harness.read({ resource: "settings", method: "get" }, user, {}),
    ) as { revision: number };
    assertEquals(read.revision, 1);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/settings#R22: reload 실패는 마지막 성공 판을 유지하고 일부 적용·기본값 복귀를 하지 않는다", async () => {
  const opened = await createLedgerHarness({
    registrationModules: [registration],
    credentials: [user, machine],
  });
  if (!opened.ok) throw new Error(opened.error.code);
  const harness = opened.value;
  try {
    const defaults = await defaultsRevision(harness);
    value(
      await harness.command(
        user,
        applyEnvelope(
          "apply-good",
          [
            {
              layer: "common",
              key: "shell.reading_width",
              action: "set",
              value: 70,
            },
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
    // 저장 선택에 범위 밖 값이 남으면 probeWrite로 심는다. 저장은되어 있지만
    // 현재 schema를 지나지 않는다. reload 전체를 거절한다(R22).
    value(
      await harness.command(user, {
        command: "settings.tests.record_choice",
        input: { key: "shell.reading_width", value: "9" },
        compare: {},
        idempotency_key: "seed-broken",
        prepared: [],
      }),
    );
    const before = await state(harness);
    const rejected = failure(
      await harness.command(machine, reloadEnvelope("reload-broken", defaults)),
    );
    assertEquals(rejected.code, "invalid_input");
    // 마지막 성공 판이 유지된다(R22).
    const kept = await state(harness);
    assertEquals(kept.revision, before.revision);
    assertEquals(kept.defaults_revision, before.defaults_revision);
    // 저장 선택도 그대로다. 일부 적용이나 기본값 복귀가 없다(R22).
    const rows = value(
      await harness.inspect(
        "select key, value from setting_choices order by key",
        [],
      ),
    );
    const keptChoices = new Map(
      rows.map((row) => [String(row["key"]), JSON.parse(String(row["value"]))]),
    );
    assertEquals(keptChoices.get("shell.reading_width"), 9);
    assertEquals(keptChoices.get("documents.tracking"), {
      patterns: ["user/*.md"],
    });
  } finally {
    await harness.close();
  }
});

Deno.test("platform/settings#R23: 첫 시작에 유효한 판이 없어도 read와 수정 준비는 열려 있다", async () => {
  const opened = await createLedgerHarness({
    registrationModules: [registration],
    credentials: [user, machine],
  });
  if (!opened.ok) throw new Error(opened.error.code);
  const harness = opened.value;
  try {
    // 첫 시작: apply나 reload가 없다. revision 0이고 settings_state row가 없다.
    const before = await state(harness);
    assertEquals(before.revision, 0);
    // read는 유효 판 없이 열린다(R23). 설정 수정(apply)도 열려 있다.
    const read = value(
      await harness.read({ resource: "settings", method: "get" }, user, {}),
    ) as { revision: number };
    assertEquals(read.revision, 0);
    const defaults = await defaultsRevision(harness);
    value(
      await harness.command(
        user,
        applyEnvelope(
          "apply-from-empty",
          [
            {
              layer: "common",
              key: "shell.reading_width",
              action: "set",
              value: 60,
            },
          ],
          0,
          defaults,
        ),
      ),
    );
    assertEquals((await state(harness)).revision, 1);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/settings#R24, platform/settings#R25: 적용 결과는 즉시 효력과 다음 run 효력을 구별한다", async () => {
  const opened = await createLedgerHarness({
    registrationModules: [registration],
    credentials: [user, machine],
  });
  if (!opened.ok) throw new Error(opened.error.code);
  const harness = opened.value;
  try {
    const defaults = await defaultsRevision(harness);
    // 두 항목의 apply 시점이 다르다. current_check와 next_run이 나뉜다(R24, R25).
    const applied = value(
      await harness.command(
        user,
        applyEnvelope(
          "apply-mixed",
          [
            {
              layer: "common",
              key: "shell.reading_width",
              action: "set",
              value: 90,
            },
            {
              layer: "common",
              key: "coding.harness",
              action: "set",
              value: "codex",
            },
          ],
          0,
          defaults,
        ),
      ),
    );
    const result = applied.result as {
      revision: number;
      applied: { key: string; apply_at: string }[];
    };
    // 즉시 효력(current_check)과 다음 run 효력(next_run)이 나뉜다(R25).
    const width = result.applied.find((entry) =>
      entry.key === "shell.reading_width"
    );
    const harness_ = result.applied.find((entry) =>
      entry.key === "coding.harness"
    );
    assertEquals(width?.apply_at, "current_check");
    assertEquals(harness_?.apply_at, "next_run");
    // event의 적용 시점도 같다. reload가 next_run 항목만 다시 연결하지 않는다(R25).
    const history = value(
      await harness.read({ resource: "settings", method: "history" }, user, {}),
    ) as { revisions: { revision: number }[] };
    assert(history.revisions.some((entry) => entry.revision === 1));
  } finally {
    await harness.close();
  }
});
