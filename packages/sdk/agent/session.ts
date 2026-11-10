import { reduceAcp } from "../../protocol/acp/reduce.ts";
import type {
  AcpAnswer,
  AcpInput,
  AcpMessageItem,
  AcpNoticeItem,
  AcpState,
  AcpUpdate,
  ContentBlock,
} from "./acp-types.ts";
import { newMessageId } from "./ids.ts";
import {
  type JsonSchema,
  parseReply,
  type Reply,
  replyInstruction,
} from "./reply.ts";

type BridgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

// 앱 view preload bridge `lophnApp.agent`의 SDK 쪽 사본(protocol/shell/app-bridge-types.ts의 LophnAppAgent).
export interface AgentBridge {
  open(input: {
    agent: string;
    title?: string;
    workspace?: { kind: "project" | "app"; id: string };
  }): Promise<BridgeResult<{ session: string }>>;
  snapshot(session: string): Promise<BridgeResult<AcpState>>;
  onUpdate(listener: (session: string, update: AcpUpdate) => void): () => void;
  send(input: AcpInput): Promise<BridgeResult<void>>;
}

export function agentBridge(): AgentBridge | undefined {
  return (globalThis as { lophnApp?: { agent?: AgentBridge } }).lophnApp?.agent;
}

export type Done = { ok: true } | { ok: false; error: string };

/** 보내기가 접수되면 ok다. `reply`는 `{reply}`를 줬을 때만 있고, 그 turn이 끝나면 답을 낸다. */
export type Sent =
  | { ok: true; reply: Promise<Reply> | null }
  | { ok: false; error: string };

export type SessionView = {
  session: string | null;
  /** snapshot을 읽기 전에는 null이다. */
  state: AcpState | null;
  error: string | null;
};

export interface AgentController {
  send(
    blocks: readonly ContentBlock[],
    options?: { reply?: JsonSchema },
  ): Promise<Sent>;
  stop(): Promise<Done>;
  answer(answers: AcpAnswer[]): Promise<Done>;
  /** 지금 session의 제목을 바꾼다. session이 열리기 전에는 오류다(열 때의 제목은 `title` 옵션이다). */
  rename(title: string): Promise<Done>;
  /** 지금 session을 잊는다. 다음 `send`가 새 session을 연다. 도는 turn은 멈추지 않는다. */
  reset(): void;
  close(): void;
}

export type AgentSessionOptions = {
  /** agent handle이다. 그대로 bridge `open`에 넘긴다. */
  agent: string;
  /** SDK가 session을 열 때 붙일 제목. 읽는 시점의 값이 쓰인다. */
  title?: (() => string | undefined) | undefined;
  /** 첫 `send`가 session을 열 workspace. 빼면 이 앱 workspace이고, 주면 이 앱이 call로 닿을 수 있는 workspace(call 정책)다. */
  workspace?: { kind: "project" | "app"; id: string } | undefined;
  /** 이 앱이 볼 수 있는 기존 session에 다시 붙는다. 주면 바로 snapshot을 읽고 첫 `send`도 거기로 간다. */
  session?: string | undefined;
};

type Watcher = { check(state: AcpState): boolean; cancel(): void };

function describe(error: { code: string; message: string }): string {
  return `${error.code}: ${error.message}`;
}

// turn이 끝났으면 그 turn 마지막 agent 메시지에서 답을 꺼낸다. 아직이면 null이다.
function replyOf(
  state: AcpState,
  message: string,
  schema: JsonSchema,
): Reply | null {
  const sent = state.items.find(
    (item): item is AcpMessageItem =>
      item.kind === "message" && item.id === message,
  );
  const turn = sent?.turn ?? null;
  if (turn === null) return null;
  const end = state.items.find(
    (item): item is AcpNoticeItem =>
      item.kind === "notice" &&
      item.turn === turn &&
      item.notice.type !== "info",
  );
  if (end === undefined) return null;
  if (end.notice.type === "error") {
    return { ok: false, error: `turn failed: ${end.notice.message}` };
  }
  if (end.notice.type !== "turn_end") return null;
  if (end.notice.outcome !== "completed") {
    return { ok: false, error: `turn ${end.notice.outcome}` };
  }
  const last = state.items
    .filter(
      (item): item is AcpMessageItem =>
        item.kind === "message" && item.actor === "agent" && item.turn === turn,
    )
    .at(-1);
  if (last === undefined) {
    return { ok: false, error: "turn ended without a message" };
  }
  // 본문을 모르는 메시지는 reread의 snapshot이 채운다.
  if (!last.complete) return null;
  const text = last.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
  return parseReply(text, schema);
}

/**
 * 이 앱의 agent session을 첫 send에서 열고 ACP 상태를 `onChange`로 알린다. 열자마자 snapshot을 읽고, 읽는 동안 온
 * 갱신은 모아 두었다가 snapshot 위에 `reduceAcp`로 접는다(bridge는 snapshot을 읽은 session의 갱신만 준다). `reread`가
 * 서면 snapshot을 다시 읽는다.
 */
export function openAgentSession(
  app: AgentBridge,
  options: AgentSessionOptions,
  onChange: (view: SessionView) => void,
  newId: () => string = newMessageId,
): AgentController {
  const { agent } = options;
  let closed = false;
  // reset 앞에 시작한 열기·읽기가 뒤늦게 끝나 새 상태를 덮지 않게 한다.
  let epoch = 0;
  let opened: string | null = null;
  let current: AcpState | null = null;
  let error: string | null = null;
  // 첫 snapshot이 올 때까지, 그리고 다시 읽는 동안 온 갱신은 쌓는다.
  let reading = true;
  let buffered: AcpUpdate[] = [];
  const watchers = new Set<Watcher>();

  const notify = () => onChange({ session: opened, state: current, error });

  const publish = (next: AcpState) => {
    current = next;
    notify();
    for (const watcher of [...watchers]) {
      if (watcher.check(next)) watchers.delete(watcher);
    }
  };

  const fail = (cause: { code: string; message: string }) => {
    error = describe(cause);
    notify();
  };

  // snapshot을 읽는 동안 온 갱신은 snapshot에 들었을 수도 있어 접고(idempotent), 읽기 전에 접은 것은 이미 상태에 있다.
  const read = async (again: boolean): Promise<Done> => {
    const mine = epoch;
    reading = true;
    buffered = [];
    const snapshot = await app.snapshot(opened as string);
    if (closed || mine !== epoch) return { ok: false, error: "session closed" };
    reading = false;
    if (!snapshot.ok) {
      fail(snapshot.error);
      return { ok: false, error: describe(snapshot.error) };
    }
    let next = snapshot.value;
    for (const update of buffered) next = reduceAcp(next, update);
    buffered = [];
    if (next.reread && again) return await read(false);
    error = null;
    publish({ ...next, reread: false });
    return { ok: true };
  };

  const off = app.onUpdate((id, update) => {
    if (id !== opened) return;
    if (reading || current === null) {
      buffered.push(update);
      return;
    }
    const next = reduceAcp(current, update);
    publish(next);
    if (next.reread) void read(true);
  });

  // session은 첫 send에서 연다. 열 때마다 사이드바에 보이는 session이 하나 생기므로 화면을 연 것만으로는 열지 않는다.
  let opening: Promise<Done> | null = null;
  const ensureOpen = (): Promise<Done> => {
    opening ??= (async (): Promise<Done> => {
      const mine = epoch;
      const title = options.title?.();
      const result = await app.open({
        agent,
        ...(title === undefined ? {} : { title }),
        ...(options.workspace === undefined
          ? {}
          : { workspace: options.workspace }),
      });
      if (mine !== epoch) return { ok: false, error: "session reset" };
      if (!result.ok) {
        opening = null;
        fail(result.error);
        return { ok: false, error: describe(result.error) };
      }
      error = null;
      opened = result.value.session;
      notify();
      await read(true);
      return { ok: true };
    })();
    return opening;
  };

  // 다시 붙을 session은 바로 읽는다. 읽기 실패는 `error`로 알리고, 보내기는 그 session으로 가서 거기서 거절이 나면 그 오류를 낸다.
  if (options.session !== undefined) {
    opened = options.session;
    opening = read(true).then(() => ({ ok: true }));
  }

  const post = async (input: AcpInput): Promise<Done> => {
    const result = await app.send(input);
    return result.ok
      ? { ok: true }
      : { ok: false, error: describe(result.error) };
  };

  const notOpen: Done = { ok: false, error: "session is not open" };

  return {
    async send(blocks, sendOptions) {
      if (closed) return notOpen;
      const schema = sendOptions?.reply;
      const id = newId();
      const mine = epoch;
      const ready = await ensureOpen();
      if (!ready.ok) return ready;
      if (closed) return notOpen;
      if (mine !== epoch) return { ok: false, error: "session reset" };
      // 답은 보내기 전에 지켜보기 시작한다. 갱신이 보내기 응답보다 먼저 올 수 있다.
      let watcher: Watcher | undefined;
      const reply =
        schema === undefined
          ? null
          : new Promise<Reply>((resolve) => {
              watcher = {
                check(state) {
                  const found = replyOf(state, id, schema);
                  if (found !== null) resolve(found);
                  return found !== null;
                },
                cancel: () => resolve({ ok: false, error: "session closed" }),
              };
              watchers.add(watcher);
            });
      const done = await post({
        type: "send",
        session: opened as string,
        id,
        key: id,
        content: [
          ...blocks,
          ...(schema === undefined ? [] : [replyInstruction(schema)]),
        ],
        delivery: "next_turn",
      });
      if (!done.ok) {
        if (watcher !== undefined) watchers.delete(watcher);
        return done;
      }
      return { ok: true, reply };
    },

    async stop() {
      if (closed || opened === null) return notOpen;
      const turn = current?.turn;
      if (turn === null || turn === undefined || turn.phase === "ended") {
        return { ok: false, error: "no turn is running" };
      }
      return await post({
        type: "stop",
        session: opened,
        turn: turn.id,
        key: `stop-${turn.id}`,
      });
    },

    async answer(answers) {
      if (closed || opened === null) return notOpen;
      const asked = current?.pending.question;
      if (asked === null || asked === undefined) {
        return { ok: false, error: "no question is waiting" };
      }
      return await post({
        type: "answer",
        session: opened,
        tool_call: asked.tool_call,
        answers,
      });
    },

    async rename(title) {
      if (closed || opened === null) return notOpen;
      return await post({
        type: "rename",
        session: opened,
        key: `rename-${newId()}`,
        title,
      });
    },

    reset() {
      if (closed) return;
      epoch += 1;
      opened = null;
      current = null;
      error = null;
      opening = null;
      reading = true;
      buffered = [];
      for (const watcher of watchers) watcher.cancel();
      watchers.clear();
      notify();
    },

    close() {
      closed = true;
      off();
      for (const watcher of watchers) watcher.cancel();
    },
  };
}
