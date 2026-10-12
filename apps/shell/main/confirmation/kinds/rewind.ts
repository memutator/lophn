// session 되돌리기(rewind) 확인(lophn-agent/revert#R3, #R7, #R15). 대화의 rewind menu가 고른 session·checkpoint·범위로
// 창을 열면, 이 종류가 `rewind/preview`를 독립 read해 정본을 만든다. 표시와 제출은 같은 정본에 묶이고 renderer가 보낸
// 다른 값은 쓰지 않는다. 결정은 `Rewind`로 보내고 결정 자체가 적용이다. 건너뛰는 것이나 남는 영향이 있으면 정본이
// accept_remaining=true로 묶고 2차 확인으로 그 목록을 다시 보인 뒤에만 제출할 수 있다(사람이 확인한 결정이 있어야
// 복원 가능한 것을 적용한다). 문서 파일은 core가 확인 뒤에 관측·준비·설치하므로(files) 여기서 읽지 않는다.
// 앱 복원 단계가 있어 applying으로 접수되면 같은 revert를 core의 `RunAppRevert`로 이어 실행한다(lophn-agent#T48).
import type { LiveHandle } from "../handle.ts";
import type { ConfirmationIntent, ConfirmationResult } from "../types.ts";
import {
  bindingOf,
  failed,
  type KindCore,
  type Read,
  readFailure,
  record,
  sendCommand,
  type Sent,
  text,
} from "./core.ts";

export const REWIND_CONCERN = "lophn-agent/revert";
/** contracts REWIND_DECISION(= command 이름 Rewind). 창을 여는 결정과 제출하는 결정이 같다. */
export const REWIND = "Rewind";

/** contracts rewind.binding. 첫 field가 handle 대상이다. */
const BINDING = [
  "id",
  "session",
  "checkpoint",
  "choice",
  "accept_remaining",
  "preview_hash",
] as const;

type Intent = Extract<ConfirmationIntent, { kind: "owner_decision" }>;
type Choice = "restore_all" | "messages_only" | "summarize";

export function isRewind(intent: Intent): boolean {
  return intent.concern === REWIND_CONCERN && intent.decision === REWIND;
}

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** `rvt_` + ULID(26자, Crockford base32 소문자). 창 하나가 같은 id로 결합한다. */
export function newRevertId(
  now: number,
  random: (bytes: Uint8Array) => Uint8Array,
): string {
  let time = "";
  let rest = Math.max(0, Math.floor(now));
  for (let index = 0; index < 10; index++) {
    time = ALPHABET[rest % 32] + time;
    rest = Math.floor(rest / 32);
  }
  const bytes = random(new Uint8Array(16));
  let tail = "";
  for (const byte of bytes) tail += ALPHABET[byte % 32];
  return `rvt_${time}${tail}`;
}

export interface RewindState {
  /** 창마다 고정한 revert id. 같은 창의 다시 읽기는 같은 id로 결합한다(같은 요청은 한 번만 적용된다). */
  idFor(windowId: string): string;
  forget(windowId: string): void;
}

export function rewindState(newId: () => string): RewindState {
  const ids = new Map<string, string>();
  return {
    idFor(windowId) {
      const found = ids.get(windowId);
      if (found !== undefined) return found;
      const id = newId();
      ids.set(windowId, id);
      return id;
    },
    forget: (windowId) => void ids.delete(windowId),
  };
}

const CHOICES: readonly string[] = [
  "restore_all",
  "messages_only",
  "summarize",
];

function choiceOf(intent: Intent): Choice | undefined {
  return CHOICES.includes(intent.choice ?? "")
    ? intent.choice as Choice
    : undefined;
}

/** 화면에 주는 항목은 종류·대상·이유 코드뿐이다. 앱 복원 근거(receipt 원문 포함)와 출처 call은 싣지 않는다. */
function itemsOf(
  value: unknown,
): { class: string; target: string; reason: string | null }[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = record(item);
    return {
      class: String(row.class),
      target: String(row.target),
      reason: text(row.reason),
    };
  });
}

export async function readRewind(
  core: KindCore,
  state: RewindState,
  windowId: string,
  intent: Intent,
): Promise<Read> {
  const choice = choiceOf(intent);
  const targets = intent.targets ?? [];
  const [session, checkpoint, summary] = targets;
  if (
    choice === undefined || session === undefined || checkpoint === undefined ||
    !session.startsWith("ses_") || !checkpoint.startsWith("msg_") ||
    targets.length > 3 ||
    (summary !== undefined &&
      (choice !== "summarize" || !summary.startsWith("mcl_")))
  ) {
    return failed("invalid_input", "되돌릴 곳이 올바르지 않다");
  }
  const got = await core.internal("read", "rewind", "preview", {
    kind: "rewind",
    session,
    checkpoint,
    choice,
  });
  if (!got.ok) return readFailure(got);
  const shown = record(got.value);
  const hash = text(shown.preview_hash);
  if (hash === null) return failed("internal", "미리보기에 지문이 없다");
  const restore = itemsOf(shown.restore);
  const skip = itemsOf(shown.skip);
  const remain = itemsOf(shown.remain);
  // 건너뛰는 것이나 남는 영향이 있으면 사람이 그 목록을 확인한 결정만 적용한다(R7).
  const left = skip.length + remain.length > 0;
  const bound = bindingOf(BINDING, {
    id: state.idFor(windowId),
    session,
    checkpoint,
    choice,
    accept_remaining: left,
    preview_hash: hash,
  });
  return {
    ok: true,
    value: {
      targetRef: bound.target,
      content: bound.content,
      // 요약은 끝난 요약 call이 있어야 확정할 수 있다.
      allowed: choice === "summarize" && summary === undefined ? [] : [REWIND],
      expiresAt: null,
      secondConfirm: left,
      request: {
        kind: "owner_decision",
        concern: REWIND_CONCERN,
        decision: REWIND,
        targets,
        input: { kind: "inline", value: bound.content },
        comparison: { preview_hash: hash },
      },
      view: {
        kind: "rewind",
        choice,
        redo: shown.redo === true,
        restore,
        skip,
        remain,
      },
    },
  };
}

const OUTCOMES = new Set<ConfirmationResult>([
  "applying",
  "applied",
  "partial",
  "uncertain",
  "blocked",
]);

/** Rewind는 결정 자체가 적용이다. 결과는 실제 복원 결과다. */
export async function submitRewind(
  core: KindCore,
  input: {
    handle: LiveHandle;
    content: Record<string, unknown>;
    /** 끝난 요약 call. choice=summarize일 때만 있다. */
    summaryCall: string | null;
  },
): Promise<Sent> {
  const id = String(input.content.id);
  const sent = await sendCommand(core, "rewind", "apply", {
    input: {
      ...input.content,
      summary_call: input.summaryCall,
      // 문서 파일 복원은 core가 확인 뒤에 관측·준비·설치한다.
      files: [],
    },
    idempotency_key: `confirmation:${input.handle.ref}`,
    compare: { session_state: "open", active_run: null, applying_revert: null },
    prepared: [],
    confirmation: input.handle.ref,
  });
  if (!sent.ok) return sent;
  let outcome = record(sent.value).outcome as ConfirmationResult;
  // 앱 단계가 있는 rewind는 applying으로 접수만 됐다. 이어 실행은 core가 한다: 호출한 사람의 앱 통로로 앱의 revert
  // command를 원래 호출 역순으로 부르고 기록·끝내기는 core 내부 machine이 한다. 이어 실행이 닿지 못해도 접수는
  // 남아 있어 같은 handle의 다시 보내기가 같은 revert를 이어 받는다.
  if (outcome === "applying") {
    const ran = await core.internal("memory", "rewind", "run-apps", {
      revert: id,
      files: [],
    });
    if (ran.ok) outcome = record(ran.value).outcome as ConfirmationResult;
  }
  return {
    ok: true,
    value: {
      receipt: { kind: "entity", id },
      ...(OUTCOMES.has(outcome) ? { result: outcome } : {}),
    },
  };
}
