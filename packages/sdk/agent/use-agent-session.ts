import { useCallback, useEffect, useRef, useState } from "react";
import type { AcpAnswer, ContentBlock } from "./acp-types.ts";
import type { JsonSchema } from "./reply.ts";
import {
  type AgentBridge,
  type AgentController,
  agentBridge,
  type Done,
  openAgentSession,
  type Sent,
  type SessionView,
} from "./session.ts";

export interface AgentSession extends SessionView {
  /** `{reply}`를 주면 `sent.reply`가 그 turn 마지막 agent 메시지의 JSON을 꼴에 맞춰 낸다. */
  send(
    blocks: readonly ContentBlock[],
    options?: { reply?: JsonSchema },
  ): Promise<Sent>;
  stop(): Promise<Done>;
  /** 지금 기다리는 질문 묶음에 답한다. */
  answer(answers: AcpAnswer[]): Promise<Done>;
  /** 지금 session의 제목(sidebar와 채팅 탭에 보이는 이름)을 바꾼다. session이 열린 뒤에만 된다. */
  rename(title: string): Promise<Done>;
  /** 지금 session을 잊는다. 다음 `send`가 새 session을 연다(판이 바뀌는 앱이 쓴다). */
  reset(): void;
}

const EMPTY: SessionView = { session: null, state: null, error: null };
const NOT_OPEN = { ok: false, error: "session is not open" } as const;

/**
 * 이 앱의 agent session의 ACP 상태를 React state로 준다. `session`이 없으면 첫 `send`에서 새 session을 열고(그 전에는
 * `session`과 `state`가 null이다) `title`을 그 제목으로 붙인다. `session`을 주면 그 앱 workspace의 기존 session에 다시
 * 붙어 바로 상태를 읽고 거기로 보낸다. `agent`나 `session`이 바뀌면 session을 바꾼다.
 */
export function useAgentSession(options: {
  agent: string;
  title?: string;
  session?: string;
  app?: AgentBridge | undefined;
  newId?: () => string;
}): AgentSession {
  const { agent, session, newId } = options;
  const app = options.app ?? agentBridge();
  const [view, setView] = useState<SessionView>(EMPTY);
  const controller = useRef<AgentController | null>(null);
  // 제목이 바뀌어도 session을 새로 잇지 않는다. 열 때 읽는다.
  const title = useRef(options.title);
  title.current = options.title;

  useEffect(() => {
    // 이 hook이 연 session의 id를 앱이 `session`으로 되넘기면 같은 session이라 화면을 비우지 않는다.
    setView((prev) =>
      session !== undefined && prev.session === session ? prev : EMPTY,
    );
    if (app === undefined) {
      setView({ ...EMPTY, error: "unavailable: app bridge is unavailable" });
      return;
    }
    const opened = openAgentSession(
      app,
      { agent, session, title: () => title.current },
      setView,
      newId,
    );
    controller.current = opened;
    return () => {
      opened.close();
      controller.current = null;
    };
  }, [agent, session, app, newId]);

  const send = useCallback<AgentSession["send"]>(
    async (blocks, sendOptions) =>
      (await controller.current?.send(blocks, sendOptions)) ?? NOT_OPEN,
    [],
  );
  const stop = useCallback(
    async () => (await controller.current?.stop()) ?? NOT_OPEN,
    [],
  );
  const answer = useCallback(
    async (answers: AcpAnswer[]) =>
      (await controller.current?.answer(answers)) ?? NOT_OPEN,
    [],
  );
  const rename = useCallback(
    async (next: string) =>
      (await controller.current?.rename(next)) ?? NOT_OPEN,
    [],
  );
  const reset = useCallback(() => controller.current?.reset(), []);

  return { ...view, send, stop, answer, rename, reset };
}
