import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import {
  ACTOR_KINDS,
  type CommandDefinition,
  defineCommand,
  defineEvent,
} from "../../contracts/platform/mod.ts";
import type { LedgerTestRegistration } from "../../../apps/core/testing/ledger.ts";
import {
  createPresetCommands,
  createPresetReads,
  presetSchemaSteps,
} from "../presets/mod.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
  createAssignmentReads,
} from "../assignments/mod.ts";
import {
  createRunCommands,
  createRunReads,
  runSchemaSteps,
} from "../harness/run-loop/mod.ts";
import { presetValidateDeps } from "../harness/run-loop/testing/mod.ts";
import { toolsSchemaSteps } from "../harness/tools/mod.ts";
import { createToolCommands } from "../harness/tools/commands.ts";
import { createAuditOwners } from "./audit-owners.ts";
import { createAppRevertOwner } from "./app-revert.ts";
import {
  type GroupDraft,
  type RevertOwner,
  sortSeqs,
  subjectEvents,
} from "./model.ts";
import { createRevertCommands } from "./commands.ts";
import { createRevertReads } from "./reads.ts";
import { revertSchemaSteps } from "./schema.ts";

// revert ledger 테스트 등록. run·assignment 표와 같은 wire에 revert 명령·읽기를 붙이고, 소유
// concern의 복원 command는 시험용 소유자 둘로 대신한다. 이 파일은 revert engine의 전체 사전
// 검사와 원자 적용을 본다: 문서의 실제 판정은 apps/core/revert_test.ts가 실제 documents로 본다.
//
// notes 소유자: 값 하나를 가진 메모. `RecordNote`가 바꾸고 event(`NoteChanged`)를 남기며,
//   `RestoreNote`(dispatchable)가 복원 기준(revision)이 그대로일 때만 되돌린다. `TouchNote`는
//   event 없이 revision만 옮겨 owner의 숨은 상태 변화를 흉내 낸다(사전 검사를 지나친 뒤의 거절).
// mail 소유자: 보낸 메일. 되돌릴 방법이 없는 외부 효과다.
// 분류되지 않은 event(`StrangerHappened`)는 어느 owner도 맡지 않는다.

export const noteChanged = defineEvent("NoteChanged", {
  subject: z.string(),
  payload: z.object({
    before: z.string(),
    value: z.string(),
    needs_prepared: z.boolean().optional(),
    mail: z.string().optional(),
  }),
});
export const noteRestored = defineEvent("NoteRestored", {
  subject: z.string(),
  payload: z.object({ value: z.string() }),
});
export const mailSent = defineEvent("MailSent", {
  subject: z.string(),
  payload: z.object({}),
});
export const strangerHappened = defineEvent("StrangerHappened", {
  subject: z.string(),
  payload: z.object({}),
});
// 앱 command 원래 호출의 완료 event fixture다. 증거 행(tool_calls.app_command·result)은
// h.inspect SQL로 둔다.
export const fixtureAppCalled = defineEvent("FixtureAppCalled", {
  subject: z.string(),
  payload: z.object({ run: z.string() }),
});

// platform/settings의 저장 선택 표와 같은 모양이다. StartRun이 읽는 한도 표만 같은 SQL로 둔다.
export const seedSettingChoiceRoute = defineCommand({
  resource: "setting-choice-fixture",
  method: "seed",
  name: "SeedSettingChoice",
  input: z.strictObject({ key: z.string(), value: z.unknown() }),
  output: z.strictObject({ key: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

const noteInput = z.strictObject({
  note: z.string(),
  value: z.string(),
  needs_prepared: z.boolean().optional(),
  mail: z.string().optional(),
});
const subjectInput = z.strictObject({ subject: z.string() });

export const recordNoteRoute = defineCommand({
  resource: "note-fixture",
  method: "record",
  name: "RecordNote",
  input: noteInput,
  output: z.strictObject({ revision: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});
export const touchNoteRoute = defineCommand({
  resource: "note-fixture",
  method: "touch",
  name: "TouchNote",
  input: z.strictObject({ note: z.string() }),
  output: z.strictObject({ revision: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});
export const restoreNoteRoute = defineCommand({
  resource: "note-fixture",
  method: "restore",
  name: "RestoreNote",
  input: z.strictObject({ note: z.string(), value: z.string() }),
  output: z.strictObject({ revision: z.string() }),
  compare: z.strictObject({ revision: z.string() }),
  actors: ["user", "machine"],
  errors: ["conflict", "not_found"],
});
export const recordMailRoute = defineCommand({
  resource: "note-fixture",
  method: "mail",
  name: "RecordMail",
  input: subjectInput,
  output: z.strictObject({ subject: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});
export const recordStrangerRoute = defineCommand({
  resource: "note-fixture",
  method: "stranger",
  name: "RecordStranger",
  input: subjectInput,
  output: z.strictObject({ subject: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

function notesOwner(): RevertOwner {
  return {
    concern: "fixture/notes",
    claims: (type) => type === noteChanged.type,
    classify({ events, lookup }) {
      const bySubject = new Map<string, typeof events[number][]>();
      for (const event of events) {
        const list = bySubject.get(event.subject as string) ?? [];
        list.push(event);
        bySubject.set(event.subject as string, list);
      }
      const drafts: GroupDraft[] = [];
      for (const [note, own] of bySubject) {
        const seqs = own.map((event) => event.seq);
        const ownSet = new Set(seqs);
        const foreign = subjectEvents(lookup, note).some((event) =>
          !ownSet.has(event.seq) && BigInt(event.seq) > BigInt(seqs[0])
        );
        const first = noteChanged.payload.parse(own[0].payload);
        const last = noteChanged.payload.parse(own[own.length - 1].payload);
        const revision = seqs[seqs.length - 1];
        const mail = last.mail;
        drafts.push({
          owner: "fixture/notes",
          target: note,
          source_seqs: sortSeqs(seqs),
          capability: foreign ? "conflict" : "reversible",
          reason: foreign ? "later_change" : null,
          comparison: { kind: "note", note, revision },
          before_ref: foreign ? null : {
            kind: "note",
            before: first.before,
            needs_prepared: first.needs_prepared === true,
          },
          dependencies: mail === undefined
            ? []
            : [{ owner: "fixture/mail", target: mail, comparison: {} }],
        });
      }
      return drafts;
    },
    ready(group, input) {
      const needs = group.before_ref?.["needs_prepared"] === true;
      return ok(
        needs && input.comparison["prepared"] === undefined
          ? "blocked_not_prepared"
          : null,
      );
    },
    restore(tx, group) {
      const result = tx.call(restoreNoteRoute, {
        note: group.target as string,
        value: String(group.before_ref?.["before"]),
      }, { revision: String(group.comparison?.["revision"]) });
      return result.ok ? ok(undefined) : err(result.error);
    },
  };
}

function mailOwner(): RevertOwner {
  return {
    concern: "fixture/mail",
    claims: (type) => type === mailSent.type,
    classify({ events }) {
      return events.map((event): GroupDraft => ({
        owner: "fixture/mail",
        target: event.subject,
        source_seqs: [event.seq],
        capability: "irreversible",
        reason: "external_effect",
        comparison: null,
        before_ref: null,
        dependencies: [],
      }));
    },
    restore() {
      return err({ code: "invalid_input", message: "a sent mail stays sent" });
    },
  };
}

// revert가 같은 transaction에서 부르는 소유 command다(dispatchable).
const restoreNote: CommandDefinition<typeof restoreNoteRoute> = {
  route: restoreNoteRoute,
  dispatchable: true,
  handle(tx, _ctx, input, compare) {
    const row = tx.sql.get(
      "select cast(revision as text) as revision from fixture_notes where id = ?",
      [input.note],
    );
    if (row === undefined) {
      return err({ code: "not_found", message: "note not found" });
    }
    if (String(row["revision"]) !== compare.revision) {
      return err({ code: "conflict", message: "note changed" });
    }
    const seq = tx.emit(noteRestored, input.note, { value: input.value });
    tx.sql.run(
      "update fixture_notes set value = ?, revision = ? where id = ?",
      [
        input.value,
        BigInt(seq),
        input.note,
      ],
    );
    return ok({ revision: seq });
  },
};

const seedSettingChoice: CommandDefinition<typeof seedSettingChoiceRoute> = {
  route: seedSettingChoiceRoute,
  handle(tx, _ctx, input) {
    tx.sql.run(
      "insert into setting_choices (layer, key, value) values ('common', ?, ?) on conflict (layer, key) do update set value = excluded.value",
      [input.key, JSON.stringify(input.value)],
    );
    return ok({ key: input.key });
  },
};

const recordNote: CommandDefinition<typeof recordNoteRoute> = {
  route: recordNoteRoute,
  handle(tx, _ctx, input) {
    const row = tx.sql.get("select value from fixture_notes where id = ?", [
      input.note,
    ]);
    const before = row === undefined ? "" : String(row["value"]);
    const seq = tx.emit(noteChanged, input.note, {
      before,
      value: input.value,
      ...(input.needs_prepared === true ? { needs_prepared: true } : {}),
      ...(input.mail === undefined ? {} : { mail: input.mail }),
    });
    tx.sql.run(
      `insert into fixture_notes (id, value, revision) values (?, ?, ?)
       on conflict (id) do update set value = excluded.value, revision = excluded.revision`,
      [input.note, input.value, BigInt(seq)],
    );
    return ok({ revision: seq });
  },
};

const touchNote: CommandDefinition<typeof touchNoteRoute> = {
  route: touchNoteRoute,
  handle(tx, _ctx, input) {
    tx.sql.run(
      "update fixture_notes set revision = revision + 1000000 where id = ?",
      [input.note],
    );
    return ok({ revision: "touched" });
  },
};

const recordMail: CommandDefinition<typeof recordMailRoute> = {
  route: recordMailRoute,
  handle(tx, _ctx, input) {
    tx.emit(mailSent, input.subject, {});
    return ok({ subject: input.subject });
  },
};

const recordStranger: CommandDefinition<typeof recordStrangerRoute> = {
  route: recordStrangerRoute,
  handle(tx, _ctx, input) {
    tx.emit(strangerHappened, input.subject, {});
    return ok({ subject: input.subject });
  },
};

// 앱 call 증거 fixture. 앱 command 원래 호출과 그 완료 event를 남긴다(T48). app_command 원문은
// 되돌림 근거(revert_command)를 포함한 계약이고, result.content.revert는 receipt다(T44).
const appCallInput = z.strictObject({
  run: z.string(),
  tool_call: z.string(),
  app: z.string(),
  release: z.string(),
  command: z.string(),
  revert_command: z.string().nullable(),
  invocation: z.string().nullable(),
  receipt: z.string().nullable(),
  expected_revision: z.string().nullable(),
  subject: z.string().optional(),
});
export const recordAppCallRoute = defineCommand({
  resource: "tool-call-fixture",
  method: "app-call",
  name: "RecordAppCall",
  input: appCallInput,
  output: z.strictObject({ tool_call: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: [],
});

const recordAppCall: CommandDefinition<typeof recordAppCallRoute> = {
  route: recordAppCallRoute,
  handle(tx, _ctx, input) {
    tx.emit(fixtureAppCalled, input.tool_call, { run: input.run });
    return ok({ tool_call: input.tool_call });
  },
};

export function createLedgerTestRegistration(): LedgerTestRegistration {
  const presetCommands = createPresetCommands(presetValidateDeps());
  const presetReads = createPresetReads();
  const assignmentCommands = createAssignmentCommands();
  const assignmentReads = createAssignmentReads();
  // 미반영 steering을 담는 입력 표는 conversation의 것이다. 이 시험에는 사람 입력이 없다.
  const runCommands = createRunCommands({ hasUnappliedSteering: () => false });
  const runReads = createRunReads();
  const toolCommands = createToolCommands();
  const owners = [
    createAppRevertOwner(),
    notesOwner(),
    mailOwner(),
    ...createAuditOwners(),
  ];
  const revert = createRevertCommands({ owners });
  const reads = createRevertReads({ owners });
  return {
    schemaSteps: [
      ...presetSchemaSteps,
      ...assignmentSchemaSteps,
      ...runSchemaSteps,
      ...toolsSchemaSteps,
      ...revertSchemaSteps,
      {
        id: "revert.test.setting-choices",
        sql:
          "create table setting_choices (layer text not null check (layer = 'common'), key text not null, value json not null, primary key (layer, key))",
      },
      {
        id: "revert.test.notes",
        sql:
          "create table fixture_notes (id text primary key, value text not null, revision integer not null)",
      },
    ],
    commands: [
      presetCommands.registerDefault,
      presetCommands.create,
      presetCommands.revise,
      assignmentCommands.createBuiltin,
      assignmentCommands.createAppEngineer,
      assignmentCommands.applyOperator,
      assignmentCommands.changePreset,
      assignmentCommands.pause,
      assignmentCommands.resume,
      assignmentCommands.withdraw,
      runCommands.accept,
      runCommands.start,
      runCommands.checkpoint,
      runCommands.finish,
      runCommands.stop,
      runCommands.confirmNext,
      revert.run,
      revert.checkpoint,
      revert.finish,
      restoreNote,
      toolCommands.request,
      toolCommands.decide,
      toolCommands.start,
      toolCommands.finish,
    ],
    testCommands: [
      seedSettingChoice,
      recordNote,
      touchNote,
      recordMail,
      recordStranger,
      recordAppCall,
    ],
    reads: [
      presetReads.read,
      presetReads.list,
      presetReads.instructionAttachments,
      assignmentReads.read,
      assignmentReads.list,
      assignmentReads.outputs,
      runReads.read,
      runReads.list,
      runReads.result,
      reads.preview,
      reads.list,
    ],
  };
}
