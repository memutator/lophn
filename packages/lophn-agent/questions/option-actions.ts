import { createHash } from "node:crypto";
import {
  canonicalize,
  err,
  formatSeq,
  ok,
  type Result,
} from "../../base/mod.ts";
import { appCreate } from "../../contracts/apps/mod.ts";
import {
  documentMove,
  documentRename,
  type PlaceRef,
  termDefine,
} from "../../contracts/documents/mod.ts";
import {
  applyQuestionOption,
  type OptionAction,
  optionActionSchema,
} from "../../contracts/lophn-agent/mod.ts";
import {
  applySettings,
  type ChosenOptionCall,
  type CommandDefinition,
  type CommandRoute,
  type Input,
  type JsonObject,
  parseActor,
  type SettingMutation,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { loadQuestion, type QuestionRow } from "./model.ts";
import { protectedSetting } from "./protected-settings.ts";

// 사람이 고른 선택지의 고정 action을 소유 command로 적용한다(domain model lophn-agent/questions
// `apply_question_option`, requirements questions#R13–R16).
//
// - 소유 command는 등록된 것만 부른다(OPTION_ACTION_OWNERS). 자유 답·일반 tool 결과·추천은
//   동작으로 해석하지 않는다: action은 질문을 만들 때 선택지에 고정된 값뿐이다(R15).
// - 사람 결정의 증거는 질문 정본이다. 답한 사람이 고른 option key와 고정 action 전체가 제출 값과
//   같고, 같은 질문 option을 아직 적용하지 않았을 때만 한 번 통과한다(platform/identity#R14).
//   증거 기록(question_evidence)은 소유 변경과 같은 transaction이라 소유 command가 실패하면 함께
//   되돌아가고, 그 option은 다시 적용할 수 있는 상태로 남는다.
// - 소유 command는 같은 Tx에서 부른다. 소유 command가 user만 받으므로(documents move·rename)
//   Tx의 callChosenOption이 질문 정본과 대조한 뒤 그 호출 한 번만 user 자격(event actor=user,
//   run=null)으로 넘긴다. 바깥 ApplyQuestionOption의 요청 자격(machine)은 그대로다.
// - 소유 command의 전제(CAS)가 달라졌으면 답은 그대로 두고 동작은 적용하지 않으며, 달라진 대상과
//   이유를 오류 details로 돌려준다(R14). 소유 변경이 일부만 남지 않도록 오류는 transaction 전체를
//   되돌린다.

export type OptionActionOwner = {
  // action.concern과 action.command의 정본 이름(소유 concern과 route 이름).
  concern: string;
  command: string;
  route: CommandRoute;
  // 고정 action에서 소유 command의 입력과 CAS를 만든다. 모양·대상이 틀리면 invalid_input이다.
  // 질문을 만들 때와 적용할 때 같은 함수를 쓴다(표시와 적용은 같은 고정 action에서 만든다).
  prepare(
    question: string,
    action: OptionAction,
  ): Result<{ input: unknown; compare: unknown }>;
};

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

function inlineValue(action: OptionAction): Result<Record<string, unknown>> {
  if (action.input.kind !== "inline") {
    return invalid("an option action takes its input inline");
  }
  return ok(action.input.value as Record<string, unknown>);
}

function onlyTarget(action: OptionAction, id: string): Result<void> {
  return action.targets.length === 1 && action.targets[0] === id
    ? ok(undefined)
    : invalid("the targets are not the fixed document");
}

function documentOwner(
  route: typeof documentMove | typeof documentRename,
): OptionActionOwner {
  return {
    concern: "documents/addressing",
    command: route.name,
    route,
    prepare(_question, action) {
      const value = inlineValue(action);
      if (!value.ok) return value;
      const input = route.input.safeParse(value.value);
      const compare = route.compare?.safeParse(action.comparison);
      if (!input.success || compare === undefined || !compare.success) {
        return invalid("the action does not match the owner command");
      }
      const document = (input.data as { document: string }).document;
      const target = onlyTarget(action, document);
      if (!target.ok) return target;
      return ok({ input: input.data, compare: compare.data });
    },
  };
}

// 설정 변경은 입력에 질문 근거를 싣지 않는다. 사람 결정은 이 command가 이미 확인했다.
// action의 command 이름은 `apply_settings`이고 dispatch하는 route는 `ApplySettings`다(Q36의 allowlist
// 이름을 유지한다).
export const SETTINGS_ACTION_COMMAND = "apply_settings";

const settingsOwner: OptionActionOwner = {
  concern: "platform/settings",
  command: SETTINGS_ACTION_COMMAND,
  route: applySettings,
  prepare(question, action) {
    const value = inlineValue(action);
    if (!value.ok) return value;
    const input = applySettings.input.safeParse(value.value);
    const compare = applySettings.compare?.safeParse(action.comparison);
    if (!input.success || compare === undefined || !compare.success) {
      return invalid("the action does not match the owner command");
    }
    const changes = (input.data as { changes: SettingMutation[] }).changes;
    if (
      changes.length === 0 ||
      (input.data as { evidence?: unknown }).evidence !== undefined
    ) {
      return invalid("a settings action carries its changes only");
    }
    // 설정에는 고정 ID가 없으므로 대상은 이 질문이다. 질문이 바뀌면 다른 질문이다.
    const target = onlyTarget(action, question);
    if (!target.ok) return target;
    return ok({ input: input.data, compare: compare.data });
  },
};

// 앱 등록은 미리 배정한 app ID가 고정 입력에 들어 있어야 하고 그 ID가 대상이다. 비교 기준은 없다:
// 낡은 전제(같은 slug·ID가 이미 있음)는 등록 command가 conflict로 막는다(apps/registration#R3).
const appCreateOwner: OptionActionOwner = {
  concern: "apps/registration",
  command: appCreate.name,
  route: appCreate,
  prepare(_question, action) {
    const value = inlineValue(action);
    if (!value.ok) return value;
    const input = appCreate.input.safeParse(value.value);
    const compare = appCreate.compare?.safeParse(action.comparison);
    if (!input.success || compare === undefined || !compare.success) {
      return invalid("the action does not match the owner command");
    }
    const app = (input.data as { id?: string }).id;
    if (app === undefined) return invalid("an app action fixes the app id");
    const target = onlyTarget(action, app);
    if (!target.ok) return target;
    return ok({ input: input.data, compare: compare.data });
  },
};

// 용어 정의는 이미 있는 후보를 정의하는 모양(term)과 새로 등록하는 모양(id·context) 중
// 하나만 받는다(refine). 이미 있는 용어의 정의는 소유 command가 base_revision CAS를
// 요구하고, 새 등록에는 CAS가 없어 비교 기준을 비우고 보낸다. 이미 정의된 용어·이름
// 변경·근거 변경은 소유 command가 conflict·invalid_input으로 막는다(documents/terms#R2).
const termDefineOwner: OptionActionOwner = {
  concern: "documents/terms",
  command: termDefine.name,
  route: termDefine,
  prepare(_question, action) {
    const value = inlineValue(action);
    if (!value.ok) return value;
    const input = termDefine.input.safeParse(value.value);
    const compare = termDefine.compare?.safeParse(action.comparison);
    if (!input.success || compare === undefined || !compare.success) {
      return invalid("the action does not match the owner command");
    }
    const term = (input.data as { term?: string }).term;
    const id = (input.data as { id?: string }).id;
    // 새 등록은 새로 만드는 용어 ID가 대상이고(app ID와 같다), 이미 있는 후보의
    // 정의는 그 용어가 대상이다.
    const target = onlyTarget(action, term ?? id ?? "");
    if (!target.ok) return target;
    return ok({ input: input.data, compare: compare.data });
  },
};

// 선택지로 열 수 있는 owner 동작. 안쪽에서 되돌릴 수 있는 동작만이다. 권한 부여·외부 효과·
// 복원 불가 동작은 이 목록에 없으므로 질문을 만들 때 막힌다(R12). 새 owner 동작은 이 목록에
// 더하고 그 owner의 handler를 core 조립이 묶는다(apps/core/lophn-agent.ts).
export const OPTION_ACTION_OWNERS: readonly OptionActionOwner[] = [
  documentOwner(documentMove),
  documentOwner(documentRename),
  settingsOwner,
  appCreateOwner,
  termDefineOwner,
];

export function findOptionOwner(
  action: { concern: string; command: string },
): OptionActionOwner | undefined {
  return OPTION_ACTION_OWNERS.find((owner) =>
    owner.concern === action.concern && owner.command === action.command
  );
}

// 적용하는 machine 자격이 가져야 하는 소유 command operation. owner 판정은 바깥 요청 자격의
// scope로 target을 본다(platform/ledger 대상 권한).
export const OPTION_ACTION_OPERATIONS: readonly string[] = [
  applyQuestionOption.name,
  ...OPTION_ACTION_OWNERS.map((owner) => owner.route.name),
];

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

// 입력 지문과 표시·제출 내용 지문. 표시하는 쪽과 적용하는 쪽이 같은 규칙으로 만든다.
export function optionInputHash(input: unknown): string {
  return sha256(input);
}

export function optionBindingHash(
  action: Omit<OptionAction, "binding_hash">,
): string {
  return sha256({
    concern: action.concern,
    command: action.command,
    targets: action.targets,
    input_hash: action.input_hash,
    comparison: action.comparison,
  });
}

export function buildOptionAction(base: {
  concern: string;
  command: string;
  targets: string[];
  input: JsonObject;
  comparison: JsonObject;
}): OptionAction {
  const fixed = {
    concern: base.concern,
    command: base.command,
    targets: base.targets,
    input: { kind: "inline" as const, value: base.input },
    input_hash: optionInputHash(base.input),
    comparison: base.comparison,
  };
  return { ...fixed, binding_hash: optionBindingHash(fixed) };
}

// 문서 자리 이동·이름 변경 선택지. 대상 문서·place·이름·기준 revision이 고정된다.
export function moveOptionAction(fixed: {
  document: string;
  place: PlaceRef | null;
  name: string | null;
  base_revision: string;
}): OptionAction {
  return buildOptionAction({
    concern: "documents/addressing",
    command: documentMove.name,
    targets: [fixed.document],
    input: { document: fixed.document, place: fixed.place, name: fixed.name },
    comparison: { base_revision: fixed.base_revision },
  });
}

export function renameOptionAction(fixed: {
  document: string;
  name: string;
  base_revision: string;
}): OptionAction {
  return buildOptionAction({
    concern: "documents/addressing",
    command: documentRename.name,
    targets: [fixed.document],
    input: { document: fixed.document, name: fixed.name },
    comparison: { base_revision: fixed.base_revision },
  });
}

// 새 앱 등록 선택지. 미리 배정한 app ID와 등록할 slug·이름·목적, 있으면 등록 근거 기획 판이
// 고정된다.
export function appCreateOptionAction(fixed: {
  id: string;
  slug: string;
  name: string;
  description: string;
  planning_version?: string;
}): OptionAction {
  return buildOptionAction({
    concern: "apps/registration",
    command: appCreate.name,
    targets: [fixed.id],
    input: {
      id: fixed.id,
      slug: fixed.slug,
      name: fixed.name,
      description: fixed.description,
      ...(fixed.planning_version === undefined
        ? {}
        : { planning_version: fixed.planning_version }),
    },
    comparison: {},
  });
}

// 설정 변경 선택지. 현재 값을 읽은 settings revision과 registry 판이 비교 기준이다.
export function settingsOptionAction(fixed: {
  question: string;
  changes: SettingMutation[];
  revision: number;
  defaults_revision: string;
}): OptionAction {
  return buildOptionAction({
    concern: "platform/settings",
    command: SETTINGS_ACTION_COMMAND,
    targets: [fixed.question],
    input: { changes: fixed.changes },
    comparison: {
      revision: fixed.revision,
      defaults_revision: fixed.defaults_revision,
    },
  });
}

// 용어 정의 선택지. 이미 있는 후보는 용어·이름·뜻과 기준 revision이 고정되고, 새 등록은
// context·이름·뜻이 고정된다. 사람이 고른 정확한 이름·뜻만 적용한다(documents/terms#R2).
export function defineTermOptionAction(
  fixed:
    | { term: string; name: string; definition: string; base_revision: string }
    | { context: string; id: string; name: string; definition: string },
): OptionAction {
  return "term" in fixed
    ? buildOptionAction({
      concern: "documents/terms",
      command: termDefine.name,
      targets: [fixed.term],
      input: {
        term: fixed.term,
        name: fixed.name,
        definition: fixed.definition,
      },
      comparison: { base_revision: fixed.base_revision },
    })
    : buildOptionAction({
      concern: "documents/terms",
      command: termDefine.name,
      targets: [fixed.id],
      input: {
        id: fixed.id,
        context: fixed.context,
        name: fixed.name,
        definition: fixed.definition,
      },
      comparison: {},
    });
}

// 질문을 만들 때 고정 action을 검사한다. 등록 owner 밖 동작은 forbidden, 모양·지문이 틀리면
// invalid_input이다. 권한·secret·외부 효과 설정은 보호 화면으로 안내하고 여기서 열지 않는다.
export function checkOptionAction(
  question: string,
  action: OptionAction,
): Result<void> {
  const owner = findOptionOwner(action);
  if (owner === undefined) {
    return err({
      code: "forbidden",
      message: "this action cannot be an option",
    });
  }
  const prepared = owner.prepare(question, action);
  if (!prepared.ok) return prepared;
  if (action.input.kind === "inline") {
    if (action.input_hash !== optionInputHash(action.input.value)) {
      return invalid("the input hash does not match the fixed input");
    }
  }
  const { binding_hash: _binding, ...fixed } = action;
  if (action.binding_hash !== optionBindingHash(fixed)) {
    return invalid("the binding hash does not match the fixed action");
  }
  if (owner.route.name === applySettings.name) {
    const changes = (prepared.value.input as { changes: SettingMutation[] })
      .changes;
    for (const change of changes) {
      const guarded = protectedSetting(change.key);
      if (guarded !== null) {
        return err({
          code: "forbidden",
          message: "this setting changes only on its protected screen",
          details: { key: change.key, screen: guarded.screen },
        });
      }
    }
  }
  return ok(undefined);
}

// 소유 command handler. 이름은 route 이름이고 core 조립이 writer 등록을 모은 뒤에 묶는다.
// 묶기 전에는 비어 있어 어느 동작도 적용하지 않는다(approvals의 owner 목록과 같다).
export type OptionOwnerHandlers = ReadonlyMap<
  string,
  CommandDefinition["handle"]
>;

export type OptionApplyDeps = {
  handlers(): OptionOwnerHandlers;
};

function lastSeq(tx: Tx): bigint {
  const row = tx.sql.get("select coalesce(max(seq), 0) as seq from events", []);
  const seq = row?.["seq"];
  return typeof seq === "bigint" ? seq : BigInt(String(seq ?? 0));
}

// 사람이 고른 option과 그 고정 action. 답이 없거나 선택지가 아니거나 action이 없으면 없다.
function chosenOf(
  row: QuestionRow,
): { key: string; action: OptionAction } | undefined {
  if (row.status !== "answered" || row.answer === null) return undefined;
  const answer = JSON.parse(row.answer) as {
    kind: string;
    option_key: string | null;
  };
  if (answer.kind !== "option" || answer.option_key === null) return undefined;
  const options = JSON.parse(row.options) as {
    key: string;
    action: unknown;
  }[];
  const option = options.find((candidate) =>
    candidate.key === answer.option_key
  );
  if (option === undefined || option.action === null) return undefined;
  const parsed = optionActionSchema.safeParse(option.action);
  return parsed.success
    ? { key: answer.option_key, action: parsed.data }
    : undefined;
}

// platform/ledger의 질문 정본 port가 쓰는 read. 사람이 고른 option의 고정 action이 내는 소유 command
// 호출(route·입력·CAS)을 돌려준다. ledger가 제출 호출과 대조한다(identity R14).
export function chosenOptionCall(
  tx: Pick<Tx, "sql">,
  question: string,
): Result<ChosenOptionCall> {
  const row = loadQuestion(tx, question);
  const chosen = row === undefined ? undefined : chosenOf(row);
  const owner = chosen === undefined
    ? undefined
    : findOptionOwner(chosen.action);
  if (row === undefined || chosen === undefined || owner === undefined) {
    return err({ code: "not_found", message: "no chosen option action" });
  }
  const prepared = owner.prepare(row.id, chosen.action);
  if (!prepared.ok) return prepared;
  return ok({
    option: chosen.key,
    route: owner.route.name,
    input: prepared.value.input,
    compare: prepared.value.compare,
  });
}

export function createApplyQuestionOption(
  deps: OptionApplyDeps,
): CommandDefinition<typeof applyQuestionOption> {
  return {
    route: applyQuestionOption,
    handle(tx, ctx, input: Input<typeof applyQuestionOption>) {
      if (
        parseActor(ctx.actor)?.kind !== "machine" ||
        (ctx.run !== undefined && ctx.run !== null)
      ) {
        return err({
          code: "forbidden",
          message: "only the machine applies a chosen option",
        });
      }
      const row = loadQuestion(tx, input.question);
      if (row === undefined) {
        return err({ code: "not_found", message: "question not found" });
      }
      // 증거: 답한 사람이 고른 option의 고정 action과 제출 action 전체가 같아야 한다.
      // 답이 없거나 다른 option이거나 자유 답이면 사람이 고른 근거가 아니다.
      const chosen = chosenOf(row);
      if (
        chosen === undefined || chosen.key !== input.evidence.option ||
        row.closed_seq !== input.answered_seq ||
        input.option_key !== input.evidence.option ||
        canonicalize(chosen.action) !== canonicalize(input.action) ||
        row.binding_hash !== input.action.binding_hash
      ) {
        return err({
          code: "forbidden",
          message: "the action is not the one the person chose",
        });
      }
      const owner = findOptionOwner(input.action);
      const handle = owner === undefined
        ? undefined
        : deps.handlers().get(owner.route.name);
      if (owner === undefined || handle === undefined) {
        return err({
          code: "forbidden",
          message: "the action owner is not registered",
        });
      }
      const prepared = owner.prepare(row.id, input.action);
      if (!prepared.ok) return prepared;
      if (tx.callChosenOption === undefined) {
        return err({
          code: "forbidden",
          message: "the action is not the one the person chose",
        });
      }
      const before = lastSeq(tx);
      // ledger가 질문 정본과 대조하고 한 번만 적용하게 기록한 뒤(question_evidence) 소유 handler를
      // 사람 자격(event actor=user, run=null)으로 부른다. 소유 command가 실패하면 기록도 되돌아간다.
      const applied = tx.callChosenOption(
        owner.route,
        prepared.value.input as never,
        prepared.value.compare as never,
        input.evidence,
        (userTx) => {
          const result = handle(
            userTx,
            { ...ctx, actor: "user", run: undefined },
            prepared.value.input as never,
            prepared.value.compare as never,
          );
          if (result.ok) return result;
          // 범위 밖 대상은 없는 대상과 같은 답이다. 전제가 달라졌으면 달라진 대상과 이유를 알린다.
          if (
            result.error.code === "forbidden" ||
            result.error.code === "not_found"
          ) {
            return err({ code: "not_found", message: "target not found" });
          }
          if (result.error.code === "conflict") {
            return err({
              code: "conflict",
              message: result.error.message,
              details: {
                question: row.id,
                option_key: input.option_key,
                targets: input.action.targets,
                reason: result.error.message,
              },
            });
          }
          return result;
        },
      );
      if (!applied.ok) return applied;
      const after = lastSeq(tx);
      return ok({
        question: row.id,
        option_key: input.option_key,
        applied: true,
        receipt_seq: after > before ? formatSeq(after) : null,
      });
    },
  };
}
