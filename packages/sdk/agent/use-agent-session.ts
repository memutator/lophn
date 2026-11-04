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
}

const EMPTY: SessionView = { session: null, state: null, error: null };
const NOT_OPEN = { ok: false, error: "session is not open" } as const;

/**
 * 이 앱의 agent session의 ACP 상태를 React state로 준다. session은 첫 `send`에서 연다(그 전에는 `session`과 `state`가
 * null이다). `agent`가 바뀌면 새 session을 쓴다.
 */
export function useAgentSession(options: {
  agent: string;
  app?: AgentBridge | undefined;
  newId?: () => string;
}): AgentSession {
  const { agent, newId } = options;
  const app = options.app ?? agentBridge();
  const [view, setView] = useState<SessionView>(EMPTY);
  const controller = useRef<AgentController | null>(null);

  useEffect(() => {
    setView(EMPTY);
    if (app === undefined) {
      setView({ ...EMPTY, error: "unavailable: app bridge is unavailable" });
      return;
    }
    const opened = openAgentSession(app, agent, setView, newId);
    controller.current = opened;
    return () => {
      opened.close();
      controller.current = null;
    };
  }, [agent, app, newId]);

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

  return { ...view, send, stop, answer };
}
