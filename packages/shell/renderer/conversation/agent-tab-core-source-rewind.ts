// rewind: 시점으로 고를 수 있는 메시지, 시점을 고르면 보이는 것(파일과 앱별 write), 적용, 그리고 되돌린 구간.
// 확인은 대화 화면 안의 panel이라 확인 창이 없다. 앱 data는 session rewind가 저절로 되돌리지 않고 사람이 고른 앱만
// 같은 시점으로 되돌아간다. 편집 undo와 되돌린 구간 redo는 없다.
import { t } from "@lophn/wording";

import type { AppToolCaller } from "../../../protocol/apps/calls/caller.ts";
import { appRewindPlan } from "../../../protocol/apps/calls/rewind.ts";
import { appGet } from "../../../protocol/apps/apps.ts";
import { receivedMessageList } from "../../../protocol/lophn-agent/received-messages.ts";
import {
  type RevertRecord,
  rewindList,
} from "../../../protocol/lophn-agent/reverts.ts";
import {
  sessionRewind,
  sessionRewindPreview,
} from "../../../protocol/lophn-agent/session-rewinds.ts";
import { turnList } from "../../../protocol/lophn-agent/turn-reads.ts";
import { newId } from "../prefixed-id.ts";
import type {
  RewindApp,
  RewindChoice,
  RewindFileView,
  RewindPreviewView,
  RewindResultView,
  RewindWrite,
  SourceResult,
} from "./agent-tab-source.ts";
import { done, type Env } from "./agent-tab-core-source-env.ts";
import { readSession, roleLabel } from "./agent-tab-core-source-sessions.ts";

// ---------------------------------------------------------------- 되돌린 구간

/** 숨기는 rewind 하나: 메시지를 되돌렸고(restore_all·messages_only) 적용됐다. */
export interface HiddenGroup {
  readonly from: bigint;
  readonly through: bigint;
  /** 이 구간을 숨긴 rewind들. */
  readonly rewinds: readonly RewindRow[];
}

type RewindRow = RevertRecord;

/** 숨김 구간은 rewind의 boundary_seq부터 result_seq까지다. 겹치거나 이어지면 합친다. 오래된 쪽부터다. */
export async function readHiddenGroups(
  env: Env,
  session: string,
): Promise<HiddenGroup[]> {
  const read = await env.pages(
    rewindList,
    { session },
    (out) => out.reverts,
  );
  // 읽지 못하면 접지 않는다. 대화는 그대로 보인다.
  if (!read.ok) return [];
  const hiding = read.value.flatMap((row) =>
    row.kind === "rewind" &&
      (row.choice === "restore_all" || row.choice === "messages_only") &&
      (row.outcome === "applied" || row.outcome === "partial" ||
        row.outcome === "uncertain") &&
      row.boundary_seq !== null && row.result_seq !== null
      ? [{
        row,
        from: BigInt(row.boundary_seq),
        through: BigInt(row.result_seq),
      }]
      : []
  ).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const groups: { from: bigint; through: bigint; rewinds: RewindRow[] }[] = [];
  for (const item of hiding) {
    const last = groups.at(-1);
    if (last !== undefined && item.from <= last.through + 1n) {
      if (item.through > last.through) last.through = item.through;
      last.rewinds.push(item.row);
    } else {
      groups.push({
        from: item.from,
        through: item.through,
        rewinds: [item.row],
      });
    }
  }
  return groups;
}

export function groupAt(
  groups: readonly HiddenGroup[],
  seq: string,
): HiddenGroup | undefined {
  const at = BigInt(seq);
  return groups.find((group) => at >= group.from && at <= group.through);
}

const LEFT_RESULTS = new Set(["skipped", "remained", "failure", "uncertain"]);

/** 접힌 줄이 말하는 것: 구간을 숨긴 가장 나중 rewind의 결과. */
export function hiddenFacts(group: HiddenGroup): {
  checkpoint: string;
  choice: "restore_all" | "messages_only";
  restored: number;
  left: RewindResultView[];
} {
  const latest = [...group.rewinds].sort((a, b) =>
    BigInt(a.result_seq!) < BigInt(b.result_seq!) ? 1 : -1
  )[0]!;
  return {
    checkpoint: latest.checkpoint!,
    choice: latest.choice as "restore_all" | "messages_only",
    restored:
      latest.items.filter((item) =>
        item.class === "file" && item.result === "restored"
      ).length,
    left: latest.items.filter((item) =>
      LEFT_RESULTS.has(item.result) ||
      (item.result === "unchanged" && item.reason !== null)
    ).map((item): RewindResultView => ({
      kind: item.class,
      target: item.target,
      result: item.result as RewindResultView["result"],
      reason: item.reason,
    })),
  };
}

// ---------------------------------------------------------------- 시점

/**
 * 시점은 turn을 시작한 사람 메시지다(steer는 아니다). 숨긴 구간 안의 메시지는 고를 수 없다. 오래된 순.
 */
export async function readRewindPoints(
  env: Env,
  session: string,
): Promise<SourceResult<readonly string[]>> {
  const [messages, turns, hidden] = await Promise.all([
    env.pages(receivedMessageList, { session }, (out) => out.messages),
    env.pages(turnList, { session }, (out) => out.turns),
    readHiddenGroups(env, session),
  ]);
  if (!messages.ok) return messages;
  if (!turns.ok) return turns;
  const started = new Set(turns.value.map((turn) => turn.input_message));
  return {
    ok: true,
    value: messages.value.filter((message) =>
      message.from.kind === "human" && message.delivery === "next_turn" &&
      started.has(message.id) &&
      groupAt(hidden, message.created_seq) === undefined
    ).map((message) => message.id),
  };
}

// ---------------------------------------------------------------- 사전 검사

function operationText(
  operation: { kind: string; tool?: string },
): string {
  return operation.kind === "tool" && operation.tool !== undefined
    ? operation.tool
    : operation.kind;
}

async function callerName(
  env: Env,
  caller: AppToolCaller | null,
): Promise<string> {
  if (caller === null) return t("conversation.label.rewind-item-app");
  if (caller.kind === "person") {
    return t("conversation.label.rewind-caller-person");
  }
  if (caller.kind === "program") {
    return t("conversation.label.rewind-caller-program");
  }
  if (caller.kind === "flow") {
    return t("conversation.label.rewind-caller-flow");
  }
  if (caller.kind === "agent") {
    const read = await readSession(env, caller.session);
    return read.ok ? roleLabel(read.value.agent.role) : caller.session;
  }
  const app = await env.read(appGet, { app: caller.app });
  return app.ok ? app.value.app.name : caller.app;
}

/** 앱 하나: 이 session이 한 write, 함께 되돌아갈 다른 변경, 되돌아가지 않는 external 효과. */
async function appViewOf(
  env: Env,
  app: string,
  invocations: readonly string[],
): Promise<SourceResult<RewindApp | null>> {
  const first = invocations[0];
  if (first === undefined) return { ok: true, value: null };
  const plan = await env.read(appRewindPlan, { app, from_invocation: first });
  // 고를 수 없는 앱(이전 release 등)은 목록에 두지 않는다.
  if (!plan.ok) {
    return plan.code === "invalid_input" ? { ok: true, value: null } : plan;
  }
  const name = await env.read(appGet, { app });
  const mine = new Set(invocations);
  const { items, blocked } = plan.value.plan;
  const writes = items.filter((item) => mine.has(item.invocation)).map((
    item,
  ): RewindWrite => ({
    at: item.started_at,
    text: operationText(item.operation),
    unknown: blocked?.invocation === item.invocation,
  }));
  const others = await Promise.all(
    items.filter((item) => !mine.has(item.invocation) && item.reverts_db)
      .map(async (item) => ({
        by: await callerName(env, item.caller),
        text: operationText(item.operation),
      })),
  );
  return {
    ok: true,
    value: {
      app,
      name: name.ok ? name.value.app.name : app,
      writes,
      others,
      outside: items.filter((item) => item.external).map((item) =>
        operationText(item.operation)
      ),
    },
  };
}

/** 시점을 고르면 보이는 것. 파일 목록은 파일까지 되돌리는 범위의 것이고, 아무것도 바꾸지 않는다. */
export async function previewRewind(
  env: Env,
  session: string,
  message: string,
): Promise<SourceResult<RewindPreviewView>> {
  const read = await env.read(sessionRewindPreview, {
    session,
    checkpoint: message,
    choice: "restore_all",
  });
  if (!read.ok) return read;
  const { restore, skip, app_writes } = read.value;
  const files = [...restore, ...skip].filter((item) => item.class === "file")
    .map((item): RewindFileView => ({
      path: item.target,
      skipped: item.reason,
    }));
  const apps: RewindApp[] = [];
  for (const entry of app_writes) {
    const view = await appViewOf(env, entry.app, entry.invocations);
    if (!view.ok) return view;
    if (view.value !== null) apps.push(view.value);
  }
  return { ok: true, value: { files, apps } };
}

// ---------------------------------------------------------------- 적용

export function createRewindIds(): Map<string, string> {
  return new Map();
}

/**
 * `files`가 참이면 대화와 파일을 되돌리고(restore_all) 거짓이면 대화만 되돌린다(messages_only). 고른 앱은 같은
 * 시점으로 되돌아간다. 사전 검사 뒤 파일이 바뀌어 지문이 달라지면 아무것도 바꾸지 않고 conflict다. 파일 복원은 core가
 * 준비한다(shell은 프로젝트 파일을 읽지 못한다).
 */
export async function rewindSession(
  env: Env,
  ids: Map<string, string>,
  session: string,
  message: string,
  choice: RewindChoice,
): Promise<SourceResult<void>> {
  const scope = choice.files ? "restore_all" : "messages_only";
  const preview = await env.read(sessionRewindPreview, {
    session,
    checkpoint: message,
    choice: scope,
  });
  if (!preview.ok) return preview;
  // 결과를 몰라 다시 눌러도 같은 id와 key로 보내 core가 한 번만 접수한다.
  const same = `${session}:${message}:${scope}:${
    [...choice.apps].sort().join()
  }`;
  let id = ids.get(same);
  if (id === undefined) {
    id = newId("rwd", env.now());
    ids.set(same, id);
  }
  const applied = await env.command(sessionRewind, {
    input: {
      id,
      session,
      checkpoint: message,
      choice: scope,
      accept_remaining: true,
      preview_hash: preview.value.preview_hash,
      summary_call: null,
      files: [],
      apps: [...choice.apps],
    },
    compare: {
      session_state: "open",
      active_turn: null,
      applying_rewind: null,
    },
    key: `rewind-${id}`,
  });
  if (!applied.ok) return applied;
  ids.delete(same);
  return applied.value.outcome === "blocked"
    ? { ok: false, code: "conflict" }
    : done;
}
