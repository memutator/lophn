// 대화 글 안 artifact link. 진짜 MessageBody가 이 project의 domain artifact 목록(ArtifactsSlice)으로 path를 link로 그린다.
// 목록에 없는 path는 link가 아닌 글 그대로다. hover한 모양은 mount 뒤 link에 pointer를 올려 만든다.
import type { ReactNode } from "react";

import {
  AgentTurn,
  Said,
  UserMessage,
} from "../../../../../packages/shell/renderer/conversation/message-list/agent-turn.tsx";
import { MessageBody } from "../../../../../packages/shell/renderer/conversation/message-list/message-body.tsx";
import type { BodyState } from "../../../../../packages/shell/renderer/conversation/drafts.ts";
import type { ArtifactsSlice } from "../../../../../packages/shell/renderer/workspace/kinds/host.ts";
import { FAKE_DOMAINS } from "../../../../../packages/shell/renderer/workspace/fake-source.ts";
import { ARTIFACTS } from "../../../mock/artifact/data.ts";
import { find, useDrive, wait } from "../../../mock/drive.ts";

const noop = () => {};
const DOMAIN = FAKE_DOMAINS[0]!.id;
const FOLDER = `domains/${DOMAIN}/artifacts`;

const SLICE: ArtifactsSlice = {
  items: ARTIFACTS.map((item) => ({ ...item, domain: DOMAIN })),
  names: ARTIFACTS.map((item) => ({ domain: DOMAIN, name: item.name })),
  open: noop,
  reload: noop,
};

const AGENT = {
  name: "Operator",
  profile: { kind: "initial", text: "O" },
} as const;

const ready = (text: string): BodyState => ({
  state: "ready",
  parts: [{ kind: "text", text }],
});

function Turn({ time, text, id }: { time: string; text: string; id: string }) {
  return (
    <AgentTurn agent={AGENT} time={time}>
      <Said id={id}>
        <MessageBody message={id} body={ready(text)} artifacts={SLICE} />
      </Said>
    </AgentTurn>
  );
}

function Chat({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "auto",
        background: "var(--color-surface-base)",
        color: "var(--color-text-primary)",
        font: "var(--type-body-size)/var(--type-body-line) var(--font-sans)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
          boxSizing: "border-box",
          maxWidth: 720,
          margin: "0 auto",
          padding: "var(--space-8) var(--space-6)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** 위는 평소 모양과 목록에 없어 글 그대로인 path, 아래는 hover해 설명이 뜬 모양이다. */
export function ChatLink() {
  useDrive(async () => {
    const link = await find('[data-artifact-link="spending"]');
    await wait(60);
    link.dispatchEvent(
      new PointerEvent("pointerover", {
        bubbles: true,
        pointerType: "mouse",
      }),
    );
  });
  return (
    <Chat>
      <UserMessage>When are the tax dates?</UserMessage>
      <Turn
        id="msg_link_1"
        time="10:42"
        text={`Written to ${FOLDER}/tax-deadlines/index.html. The older draft in ${FOLDER}/old-draft/index.html is gone, so it stays plain text.`}
      />
      <UserMessage>Show this month's spending as a chart.</UserMessage>
      <Turn
        id="msg_link_2"
        time="10:44"
        text={`Done. I wrote the chart to ${FOLDER}/spending/index.html and put the figures in its data folder.`}
      />
    </Chat>
  );
}
