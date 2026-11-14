// 대화 글 안 artifact link. 진짜 MessageBody가 이 project의 artifact 목록(ArtifactsSlice)으로 path를 link로 그린다.
// 목록에 없는 path는 link가 아닌 글 그대로다. hover한 모양은 mount 뒤 link에 pointer를 올려 만든다.
import type { ReactNode } from "react";

import {
  AgentTurn,
  Said,
  UserMessage,
} from "../../../../../packages/shell/renderer/conversation/message-list/agent-turn.tsx";
import { MessageBody } from "../../../../../packages/shell/renderer/conversation/message-list/message-body.tsx";
import type { BodyPart } from "../../../../../packages/shell/renderer/conversation/agent-tab-source.ts";
import type { ArtifactsSlice } from "../../../../../packages/shell/renderer/conversation/message-list/artifact-text.tsx";
import { PROJECT_GROCERY } from "../../../mock/mock-desktop.tsx";
import { ARTIFACTS } from "../../../mock/artifact/data.ts";
import { find, useDrive, wait } from "../../../mock/drive.ts";

const noop = () => {};
const FOLDER = `projects/${PROJECT_GROCERY}/artifacts`;

const SLICE: ArtifactsSlice = {
  workspace: { kind: "project", id: PROJECT_GROCERY },
  items: ARTIFACTS,
  open: noop,
  reload: noop,
};

const AGENT = {
  name: "Eval analyst",
  profile: { kind: "initial", text: "E" },
} as const;

const ready = (text: string): BodyPart[] => [{ kind: "text", text }];

function Turn({ text, id }: { text: string; id: string }) {
  return (
    <AgentTurn agent={AGENT}>
      <Said id={id}>
        <MessageBody message={id} parts={ready(text)} artifacts={SLICE} />
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

// markdown으로 쓴 agent 답. 목록·표·code fence·task list·image link와 backtick 속 artifact path를 보인다.
const CHANGED = [
  `Written to \`${FOLDER}/spending/index.html\` — here is what I changed:`,
  "",
  "- groceries and dining",
  "- two more rows",
  "",
  "| Item | Count |",
  "| --- | --- |",
  "| Orders | 12 |",
  "| Late | 2 |",
  "",
  "```ts",
  "const total = 12;",
  "```",
  "",
  "- [x] summed the month",
  "- [ ] checked last month",
  "",
  "![chart](https://example.com/chart.png)",
  "",
  `The details are in \`${FOLDER}/receipts-q3/index.html\`.`,
].join("\n");

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
        text={`Written to ${FOLDER}/tax-deadlines/index.html. The older draft in ${FOLDER}/old-draft/index.html is gone, so it stays plain text.`}
      />
      <UserMessage>Show this month's spending as a chart.</UserMessage>
      <Turn
        id="msg_link_2"
        text={`Done. I wrote the chart to ${FOLDER}/spending/index.html and put the figures in its data folder.`}
      />
      <Turn id="msg_link_3" text={CHANGED} />
    </Chat>
  );
}
