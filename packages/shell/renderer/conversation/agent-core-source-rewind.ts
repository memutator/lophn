// Agent view core source의 되돌리기 쪽(lophn-agent/revert). rewind menu의 재료, 범위별 preview, 확인 창 열기,
// "Summarize from here"의 요약 요청과 기다림, 편집 카드 Undo, 숨긴 구간 Redo. 숨긴 구간을 읽는 순수 규칙도 여기 있다.
// 응답은 main의 contract client가 route output schema로 이미 검사했다. receipt 원문이 든 앱 복원 근거(`app_revert`)는
// 읽지 않는다.
import { newId } from "../desktop/lophn-space/model.ts";
import type {
  EditUndo,
  RewindBlock,
  RewindChoice,
  RewindItemView,
  RewindMenuView,
  RewindPoint,
  RewindPreviewView,
  RewindReason,
  RewindResultView,
  SourceResult,
} from "./agent-source.ts";
import { type AgentEnv, runsOfSession } from "./agent-core-source-env.ts";
import type {
  CheckpointValue,
  MessageSnapshot,
  PreviewItemValue,
  PreviewValue,
  RevertValue,
} from "./agent-core-source-values.ts";
import type { ThreadMemo } from "./agent-core-source-thread.ts";

const unavailable: SourceResult<never> = { ok: false, code: "unavailable" };

// ---------------------------------------------------------------- 숨긴 구간

/** 숨기는 rewind인가: restore_all·messages_only이고 적용(applied·partial·uncertain)됐으며 redo를 마치지 않았다. */
function hides(revert: RevertValue): boolean {
  return revert.kind === "rewind" &&
    (revert.choice === "restore_all" || revert.choice === "messages_only") &&
    (revert.outcome === "applied" || revert.outcome === "partial" ||
      revert.outcome === "uncertain") &&
    revert.redo !== "done" && revert.boundary_seq !== null &&
    revert.result_seq !== null;
}

/** 겹치거나 이어진 숨김 구간 하나와 그것을 숨긴 rewind들. */
export interface HiddenGroup {
  readonly from: bigint;
  readonly through: bigint;
  readonly reverts: readonly RevertValue[];
}

/** 숨김 구간은 rewind의 boundary_seq부터 result_seq까지다. 겹치거나 이어지면 합친다. 오래된 쪽부터다. */
export function hiddenGroups(
  reverts: readonly RevertValue[],
): HiddenGroup[] {
  const hiding = reverts.filter(hides)
    .map((revert) => ({
      revert,
      from: BigInt(revert.boundary_seq!),
      through: BigInt(revert.result_seq!),
    }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const groups: { from: bigint; through: bigint; reverts: RevertValue[] }[] =
    [];
  for (const item of hiding) {
    const last = groups.at(-1);
    if (last !== undefined && item.from <= last.through + 1n) {
      if (item.through > last.through) last.through = item.through;
      last.reverts.push(item.revert);
    } else {
      groups.push({
        from: item.from,
        through: item.through,
        reverts: [item.revert],
      });
    }
  }
  return groups;
}

export function groupAt(
  groups: readonly HiddenGroup[],
  seq: bigint,
): HiddenGroup | undefined {
  return groups.find((group) => seq >= group.from && seq <= group.through);
}

const LEFT_RESULTS = new Set(["skipped", "remained", "failure", "uncertain"]);

function reasonOf(code: string | null): RewindReason | null {
  return code as RewindReason | null;
}

/** 접힌 줄이 말하는 것: 되돌린 rewind(구간 안에서 Redo를 할 수 있는 가장 나중 것, 없으면 가장 나중 것)의 결과. */
export function hiddenFacts(group: HiddenGroup): {
  revert: string;
  checkpoint: string;
  choice: "restore_all" | "messages_only";
  restored: number;
  left: RewindResultView[];
  redo: boolean;
} {
  const latest = [...group.reverts].sort((a, b) =>
    BigInt(a.result_seq!) < BigInt(b.result_seq!) ? 1 : -1
  );
  const chosen = latest.find((revert) => revert.redo === "available") ??
    latest[0]!;
  const items = chosen.items;
  return {
    revert: chosen.id,
    checkpoint: chosen.checkpoint!,
    choice: chosen.choice as "restore_all" | "messages_only",
    restored:
      items.filter((item) =>
        item.class === "file" && item.result === "restored"
      ).length,
    left: items.filter((item) =>
      LEFT_RESULTS.has(item.result) ||
      (item.result === "unchanged" && item.reason !== null)
    ).map((item): RewindResultView => ({
      kind: item.class,
      target: item.target,
      result: item.result as RewindResultView["result"],
      reason: reasonOf(item.reason),
    })),
    redo: chosen.redo === "available",
  };
}

// ---------------------------------------------------------------- 사전 검사

function itemOf(item: PreviewItemValue): RewindItemView {
  return {
    kind: item.class,
    target: item.target,
    reason: reasonOf(item.reason),
  };
}

/** 항목은 종류·대상·이유 코드만 옮긴다. 앱 복원 근거는 옮기지 않는다. */
export function previewOf(value: PreviewValue): RewindPreviewView {
  return {
    restore: value.restore.map(itemOf),
    skip: value.skip.map(itemOf),
    remain: value.remain.map(itemOf),
    redo: value.redo,
  };
}

/** Undo 사전 검사: 복원할 것이 있으면 누를 수 있고, 아니면 건너뛰는 첫 이유다. */
export function undoOf(value: PreviewValue): EditUndo {
  if (value.restore.length > 0) return { can: true };
  const why = value.skip[0]?.reason ?? value.remain[0]?.reason ?? null;
  return { can: false, reason: why === null ? "unknown" : reasonOf(why)! };
}

/** 같은 call의 사전 검사는 이 시간 안에는 다시 묻지 않는다(thread를 읽을 때마다 파일을 읽지 않게). */
const UNDO_TTL_MS = 5_000;

export async function undoStateOf(
  env: AgentEnv,
  memo: ThreadMemo,
  session: string,
  call: string,
): Promise<EditUndo> {
  const known = memo.undo.get(call);
  if (known !== undefined && env.now() - known.at < UNDO_TTL_MS) {
    return known.value;
  }
  const read = await env.link.read<PreviewValue>("rewind", "preview", {
    kind: "undo",
    session,
    tool_call: call,
  });
  const value: EditUndo = read.ok
    ? undoOf(read.value)
    : { can: false, reason: "unknown" };
  memo.undo.set(call, { at: env.now(), value });
  return value;
}

// ---------------------------------------------------------------- source 동작

/** 요약이 끝나기를 기다리는 간격과 상한(2분). 넘으면 기다림을 멈춘다. */
const SUMMARY_POLL_MS = 1000;
const SUMMARY_POLL_LIMIT = 120;

const FILE_BLOCKS: readonly string[] = [
  "limit_total",
  "limit_file",
  "limit_count",
  "record_failed",
];

export interface RewindPartDeps {
  readonly wait: (ms: number) => Promise<void>;
  /** 확인 창을 연다. 열 수 없으면 unavailable이다. */
  readonly openWindow: (request: {
    readonly kind: "owner_decision";
    readonly concern: "lophn-agent/revert";
    readonly decision: "Rewind";
    readonly targets: readonly string[];
    readonly choice: RewindChoice;
  }) => Promise<SourceResult<void>>;
}

export function createRewindPart(
  env: AgentEnv,
  memo: ThreadMemo,
  deps: RewindPartDeps,
) {
  const { link } = env;

  const readReverts = (session: string) =>
    link.pages<RevertValue>("rewind", "list", { session }, "reverts");

  return {
    /** 숨긴 구간 밖의 사람 메시지가 시점이다. 고를 수 없는 범위는 이유와 함께 싣는다. */
    async menu(session: string): Promise<SourceResult<RewindMenuView>> {
      const messages = await link.pages<MessageSnapshot>(
        "messages",
        "list",
        { session },
        "messages",
      );
      if (!messages.ok) return messages;
      const checkpoints = await link.pages<CheckpointValue>(
        "rewind",
        "checkpoints",
        { session },
        "checkpoints",
      );
      if (!checkpoints.ok) return checkpoints;
      const reverts = await readReverts(session);
      if (!reverts.ok) return reverts;
      const runs = await env.runsOf();
      if (!runs.ok) return runs;
      const groups = hiddenGroups(reverts.value);
      const points: RewindPoint[] = [];
      for (const item of messages.value) {
        const { message } = item;
        if (message.actor !== "user") continue;
        const checkpoint = checkpoints.value.find((entry) =>
          entry.message === message.id
        );
        // 숨긴 구간 안의 메시지는 시점으로 고를 수 없다. checkpoint는 core가 알리고, 수정 메시지 같은 나머지는
        // 숨김 구간 기록으로 안다.
        if (
          checkpoint?.hidden === true ||
          groupAt(groups, BigInt(item.created_seq)) !== undefined
        ) continue;
        let blocked: RewindPoint["blocked"] = {};
        if (checkpoint === undefined) {
          // 진행 중 보낸 수정과 Fork 복사본은 checkpoint가 없어 대화만 되돌린다(R12).
          const why: RewindBlock = message.mode === "correction"
            ? "correction"
            : "copied";
          blocked = { restore_all: why, summarize: why };
        } else if (
          !checkpoint.files_restorable &&
          checkpoint.files_reason !== null &&
          FILE_BLOCKS.includes(checkpoint.files_reason)
        ) {
          blocked = { restore_all: checkpoint.files_reason as RewindBlock };
        }
        points.push({ message: message.id, blocked });
      }
      const running = runsOfSession(runs.value, session).some((run) =>
        run.state !== "finished"
      );
      return { ok: true, value: { running, points } };
    },

    async preview(
      session: string,
      message: string,
      choice: RewindChoice,
    ): Promise<SourceResult<RewindPreviewView>> {
      const read = await link.read<PreviewValue>("rewind", "preview", {
        kind: "rewind",
        session,
        checkpoint: message,
        choice,
      });
      return read.ok ? { ok: true, value: previewOf(read.value) } : read;
    },

    async rewind(
      input: { session: string; message: string; choice: RewindChoice },
    ): Promise<SourceResult<void>> {
      const { session, message, choice } = input;
      const window = (targets: readonly string[]) =>
        deps.openWindow({
          kind: "owner_decision",
          concern: "lophn-agent/revert",
          decision: "Rewind",
          targets,
          choice,
        });
      if (choice !== "summarize") return await window([session, message]);
      // 요약은 Compact와 같은 모양이다: 요청하면 runtime이 요약 call을 하고, 끝난 call을 대상에 실어 확인 창을
      // 연다. 요약이 실패하면 창을 열지 않는다(아무것도 바뀌지 않는다).
      const asked = await link.read<{ request: string }>(
        "rewind",
        "summary-request",
        { session, checkpoint: message },
        "memory",
      );
      if (!asked.ok) return asked;
      for (let polls = 0; polls < SUMMARY_POLL_LIMIT; polls += 1) {
        if (polls > 0) await deps.wait(SUMMARY_POLL_MS);
        const state = await link.read<
          | { state: "waiting" }
          | { state: "summarized"; summary_call: string }
          | { state: "failed"; reason: string }
        >(
          "rewind",
          "summary-state",
          { request: asked.value.request },
          "memory",
        );
        // 요청이 사라졌으면(기한, core 재시작) 요약이 끝나지 않은 것이다.
        if (!state.ok) {
          return state.code === "not_found"
            ? { ok: false, code: "summary_failed" }
            : state;
        }
        if (state.value.state === "failed") {
          return { ok: false, code: "summary_failed" };
        }
        if (state.value.state === "summarized") {
          return await window([session, message, state.value.summary_call]);
        }
      }
      return unavailable;
    },

    async undoEdit(
      session: string,
      edit: string,
    ): Promise<SourceResult<void>> {
      const call = memo.editCalls.get(edit);
      if (call === undefined) return { ok: false, code: "not_found" };
      const shown = await link.read<PreviewValue>("rewind", "preview", {
        kind: "undo",
        session,
        tool_call: call,
      });
      if (!shown.ok) return shown;
      const id = newId("rvt", env.now());
      const done = await link.command<{ outcome: string }>("rewind", "undo", {
        input: {
          id,
          session,
          tool_call: call,
          preview_hash: shown.value.preview_hash,
          // 파일 준비는 core가 한다(shell은 프로젝트 파일을 읽지 못한다).
          files: [],
        },
        compare: { session_state: "open", reverted_by: null },
        key: `rewind-undo-${id}`,
      });
      memo.undo.delete(call);
      if (!done.ok) return done;
      // 사전 검사 뒤 파일이 바뀌어 지문이 달라졌다. 아무것도 바뀌지 않았다.
      if (done.value.outcome === "blocked") {
        return { ok: false, code: "conflict" };
      }
      return { ok: true, value: undefined };
    },

    async redoRewind(
      session: string,
      revert: string,
    ): Promise<SourceResult<void>> {
      const reverts = await readReverts(session);
      if (!reverts.ok) return reverts;
      const found = reverts.value.find((item) => item.id === revert);
      if (found === undefined || found.result_seq === null) {
        return { ok: false, code: "not_found" };
      }
      const done = await link.command("rewind", "redo", {
        input: { revert, result_seq: found.result_seq, files: [] },
        compare: { redo: "available" },
        key: `rewind-redo-${revert}`,
      });
      return done.ok ? { ok: true, value: undefined } : done;
    },
  };
}
