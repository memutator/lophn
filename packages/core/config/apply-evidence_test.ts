// settings apply의 질문 근거 apply 테스트(platform/settings#R29).
// merge_test.ts와 같은 타입 경계다. 실제 임시 ledger에 lophn-agent의
// QuestionCreated·QuestionAnswered event 모양을 심고 machine apply를 부른다.

import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../protocol/server/mod.ts";

// apply_test.ts와 같은 타입 경계다. platform ledger 모듈의 전체 타입을
// 부르지 않는다.
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
  const specifier = "../testing/ledger.ts";
  const harness = await import(specifier);
  return harness.createLedgerHarness(options);
}

const registration = new URL("./harness-fixture_test.ts", import.meta.url);

// fixture의 settings command, record_choice seed, 질문 event 심기 command가
// 모두 부른다.
const OPERATIONS = [
  "SettingsDefinitions",
  "GetSettings",
  "SettingsHistory",
  "ApplySettings",
  "ReloadSettings",
  "settings.tests.record_choice",
  "settings.tests.seed_question",
];

function credential(
  actor = "user",
  principal = "test-user",
): AuthenticatedContext {
  return {
    actor,
    principal,
    credential_ref: `test:${principal}:${actor}`,
    scope: { operations: [...OPERATIONS], targets: {} },
    conditions: {},
  };
}

const user = credential();
const machine = credential("machine", "test-machine");

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function failure<T>(result: Result<T>): { code: string; message: string } {
  assert(!result.ok, "거절을 기다렸다");
  return { code: result.error.code, message: result.error.message };
}

// lophn-agent의 QuestionCreated 질문 묶음 선택지 action(settings 변경 목록 모양)과
// QuestionAnswered 사람 답 모양이다.
const WIDTH_CHANGES = [
  {
    layer: "common",
    key: "shell.reading_width",
    action: "set",
    value: 90,
  },
];

async function state(
  harness: LedgerHarness,
): Promise<{ revision: number; defaults_revision: string }> {
  const rows = value(
    await harness.inspect(
      "select revision, defaults_revision from settings_state where key = 1",
      [],
    ),
  );
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

function applyEnvelope(
  input: unknown,
  key: string,
  defaults: string,
): CommandEnvelope {
  return {
    command: "ApplySettings",
    input,
    idempotency_key: key,
    compare: { revision: 0, defaults_revision: defaults },
    prepared: [],
  };
}

async function seedQuestion(
  harness: LedgerHarness,
  options: {
    question: string;
    group?: string;
    optionKey: string;
    changes: unknown;
    withAnswer?: boolean;
    answerActor?: string;
    answerOption?: string | null;
  },
): Promise<void> {
  const seeder = credential("user", "test-seeder");
  value(
    await harness.command(
      seeder,
      {
        command: "settings.tests.seed_question",
        input: {
          group: options.group ?? `qgr_${options.question.slice(4)}`,
          question: options.question,
          option_key: options.optionKey,
          changes: options.changes,
          with_answer: options.withAnswer ?? true,
          answer_actor: options.answerActor ?? "user",
          answer_option: options.answerOption === undefined
            ? options.optionKey
            : options.answerOption,
        },
        compare: {},
        idempotency_key: `seed-${options.question}`,
        prepared: [],
      },
    ),
  );
}

function evidence(changes: unknown, question: string, option: string) {
  return { changes, evidence: { question, option } };
}

// domain-model/platform/ledger.md ID 접두사 표의 qst 모양(접두사 뒤 26자)이다.
const Q_ADOPT = "qst_01arz3ndektsv4rrffq69g5fav";
const Q_UNANSWERED = "qst_01brz3ndektsv4rrffq69g5fav";
const Q_NONHUMAN = "qst_01crz3ndektsv4rrffq69g5fav";
const Q_OTHER_OPTION = "qst_01drz3ndektsv4rrffq69g5fav";

Deno.test(
  "platform/settings#R29: 사람이 고른 option의 근거를 검증한 machine apply만 판을 바꾼다",
  async () => {
    const opened = await createLedgerHarness({
      registrationModules: [registration],
      credentials: [user, machine, credential("user", "test-seeder")],
    });
    if (!opened.ok) throw new Error(opened.error.code);
    const harness = opened.value;
    try {
      const defaults = (await state(harness)).defaults_revision;
      // 사람이 실제로 option을 고른다(QuestionCreated + 사람(user) 답).
      await seedQuestion(harness, {
        question: Q_ADOPT,
        optionKey: "adopt",
        changes: WIDTH_CHANGES,
      });
      // 근거 없는 machine apply는 거절이다(R29).
      const bare = failure(
        await harness.command(
          machine,
          applyEnvelope({ changes: WIDTH_CHANGES }, "r29-bare", defaults),
        ),
      );
      assertEquals(bare.code, "forbidden");
      // 사람이 고른 option의 근거를 검증한 machine apply는 받는다(R29).
      const applied = value(
        await harness.command(
          machine,
          applyEnvelope(
            evidence(WIDTH_CHANGES, Q_ADOPT, "adopt"),
            "r29-apply",
            defaults,
          ),
        ),
      );
      const result = applied.result as { revision: number; changed: boolean };
      assertEquals(result.revision, 1);
      assertEquals(result.changed, true);
      // 같은 질문 option의 재적용은 예약이 거절이다(R29 일회 적용).
      const replay = failure(
        await harness.command(
          machine,
          applyEnvelope(
            evidence(WIDTH_CHANGES, Q_ADOPT, "adopt"),
            "r29-replay",
            defaults,
          ),
        ),
      );
      assertEquals(replay.code, "conflict");
      // 사람 apply는 근거 없이도 받는다(기존 동작이다, R29).
      const human = value(
        await harness.command(
          user,
          {
            command: "ApplySettings",
            input: {
              changes: [
                {
                  layer: "common",
                  key: "shell.reading_width",
                  action: "set",
                  value: 70,
                },
              ],
            },
            idempotency_key: "r29-human",
            compare: { revision: 1, defaults_revision: defaults },
            prepared: [],
          },
        ),
      );
      const humanResult = human.result as {
        revision: number;
        changed: boolean;
      };
      assertEquals(humanResult.revision, 2);
      assertEquals(humanResult.changed, true);
    } finally {
      await harness.close();
    }
  },
);

Deno.test(
  "platform/settings#R29: 키·값이 다른 제출과 답 없음·다른 option은 거절이다",
  async () => {
    const opened = await createLedgerHarness({
      registrationModules: [registration],
      credentials: [user, machine, credential("user", "test-seeder")],
    });
    if (!opened.ok) throw new Error(opened.error.code);
    const harness = opened.value;
    try {
      const defaults = (await state(harness)).defaults_revision;
      // 고정 action: reading_width 90.
      await seedQuestion(harness, {
        question: Q_ADOPT,
        optionKey: "adopt",
        changes: WIDTH_CHANGES,
      });
      // 값이 다른 제출은 거절이다(R29).
      const otherValue = failure(
        await harness.command(
          machine,
          applyEnvelope(
            evidence([{ ...WIDTH_CHANGES[0], value: 100 }], Q_ADOPT, "adopt"),
            "r29-value",
            defaults,
          ),
        ),
      );
      assertEquals(otherValue.code, "forbidden");
      // 항목이 다른 제출도 거절이다(R29).
      const otherKey = failure(
        await harness.command(
          machine,
          applyEnvelope(
            evidence(
              [
                {
                  layer: "common",
                  key: "documents.tracking",
                  action: "set",
                  value: { patterns: ["user/*.md"] },
                },
              ],
              Q_ADOPT,
              "adopt",
            ),
            "r29-key",
            defaults,
          ),
        ),
      );
      assertEquals(otherKey.code, "forbidden");
      // 답하지 않은 질문의 근거는 거절이다(R29).
      await seedQuestion(harness, {
        question: Q_UNANSWERED,
        optionKey: "adopt",
        changes: WIDTH_CHANGES,
        withAnswer: false,
      });
      const unanswered = failure(
        await harness.command(
          machine,
          applyEnvelope(
            evidence(WIDTH_CHANGES, Q_UNANSWERED, "adopt"),
            "r29-unanswered",
            defaults,
          ),
        ),
      );
      assertEquals(unanswered.code, "forbidden");
      // 사람 아닌 답(actor가 user가 아니면)은 거절이다(R29).
      await seedQuestion(harness, {
        question: Q_NONHUMAN,
        optionKey: "adopt",
        changes: WIDTH_CHANGES,
        answerActor: "machine",
      });
      const nonHuman = failure(
        await harness.command(
          machine,
          applyEnvelope(
            evidence(WIDTH_CHANGES, Q_NONHUMAN, "adopt"),
            "r29-nonhuman",
            defaults,
          ),
        ),
      );
      assertEquals(nonHuman.code, "forbidden");
      // 사람이 다른 option을 고했다면 거절이다(R29).
      await seedQuestion(harness, {
        question: Q_OTHER_OPTION,
        optionKey: "adopt",
        changes: WIDTH_CHANGES,
        answerOption: "defer",
      });
      const otherOption = failure(
        await harness.command(
          machine,
          applyEnvelope(
            evidence(WIDTH_CHANGES, Q_OTHER_OPTION, "adopt"),
            "r29-other-option",
            defaults,
          ),
        ),
      );
      assertEquals(otherOption.code, "forbidden");
    } finally {
      await harness.close();
    }
  },
);
