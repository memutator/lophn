import { useState } from "react";
import { Button, Tab, TabList, TabPanel, Tabs } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { useConversation } from "../../../../conversation/dock-slot.tsx";
import { roleTitle, STATE_LABEL } from "../labels.ts";
import { MadePanel } from "../made/made-panel.tsx";
import { PresetPanel } from "../preset/preset-panel.tsx";
import { OperatorPanel } from "../operator/operator-panel.tsx";
import type { RoleRow, RolesSource, WorkRow } from "../source.ts";
import { WorkPanel } from "../work/work-panel.tsx";
import { ConversationTab } from "./conversation-tab.tsx";
import styles from "../roles.module.css";

export interface RoleDetailProps {
  source: RolesSource;
  role: RoleRow;
  names: Readonly<Record<string, string>>;
  connected: number;
  onRead: (document: string, version: string | null) => void;
  onConfirm?: () => void;
  onApp?: (app: string) => void;
  /** 역할이나 Preset을 바꾼 뒤 목록을 다시 읽는다. */
  onChanged: () => void;
  now?: () => number;
}

type TabName = "work" | "made" | "conversation" | "preset";

// 역할 하나의 상세. 하는 일·만든 것·대화 탭을 모든 역할이 같은 자리에서 쓴다(shell/desktop#R4).
// Preset은 같은 줄의 네 번째 탭이다.
export function RoleDetail(
  { source, role, names, connected, onRead, onConfirm, onApp, onChanged, now }:
    RoleDetailProps,
) {
  const [tab, setTab] = useState<TabName>("work");
  const [problem, setProblem] = useState<"resume" | "ask" | null>(null);
  const conversation = useConversation();

  const resume = async () => {
    const resumed = await source.resume(role);
    setProblem(resumed.ok ? null : "resume");
    if (resumed.ok) onChanged();
  };

  // 다시 시키기: 처음 요청의 글을 대화 입력칸에 채워 그 대화로 간다. 보내는 것은 사람이다.
  const askAgain = async (work: WorkRow) => {
    if (conversation === null || work.session === null) return;
    const text = await source.requestText(work);
    if (!text.ok) {
      setProblem("ask");
      return;
    }
    setProblem(null);
    conversation.drafts.select(work.session);
    conversation.drafts.save(work.session, {
      text: text.value,
      selection: [text.value.length, text.value.length],
      mode: "request",
    });
    setTab("conversation");
  };

  return (
    <section className={styles.detail} data-role-detail={role.id}>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{roleTitle(role, names)}</h2>
          <span className={styles.state} data-role-state={role.state}>
            {t(STATE_LABEL[role.state])}
          </span>
          {role.state === "paused"
            ? (
              <Button
                size="sm"
                variant="secondary"
                data-action="resume"
                onClick={() => void resume()}
              >
                {t("roles.button.resume")}
              </Button>
            )
            : null}
        </div>
        {role.state === "paused" &&
            !(role.role === "operator" && role.operator?.pause != null)
          ? <p className={styles.text}>{t("roles.notice.paused")}</p>
          : null}
        {role.state === "withdrawn"
          ? <p className={styles.text}>{t("roles.notice.withdrawn")}</p>
          : null}
        {problem === null
          ? null
          : (
            <p className={styles.problem} data-problem={problem}>
              {problem === "resume"
                ? t("roles.error.resume")
                : t("roles.error.ask-again")}
            </p>
          )}
      </div>
      {role.role === "operator"
        ? (
          <OperatorPanel
            source={source}
            role={role}
            onChanged={onChanged}
          />
        )
        : null}
      <Tabs value={tab} onValueChange={(value) => setTab(value as TabName)}>
        <TabList>
          <Tab value="work">{t("roles.label.tab-work")}</Tab>
          <Tab value="made">{t("roles.label.tab-made")}</Tab>
          <Tab value="conversation">{t("roles.label.tab-conversation")}</Tab>
          <Tab value="preset">{t("roles.label.tab-preset")}</Tab>
        </TabList>
        <TabPanel value="work">
          <WorkPanel
            source={source}
            role={role}
            connected={connected}
            names={names}
            onRead={onRead}
            onConfirm={onConfirm}
            onApp={onApp}
            onAskAgain={conversation === null ? undefined : askAgain}
            onOpenConversation={() => setTab("conversation")}
            now={now}
          />
        </TabPanel>
        <TabPanel value="made">
          <MadePanel
            source={source}
            role={role}
            connected={connected}
            onRead={onRead}
            onOpenConversation={() => setTab("conversation")}
          />
        </TabPanel>
        <TabPanel value="conversation">
          <ConversationTab
            source={source}
            role={role}
            onRead={onRead}
          />
        </TabPanel>
        <TabPanel value="preset">
          <PresetPanel
            source={source}
            role={role}
            connected={connected}
            onChanged={onChanged}
          />
        </TabPanel>
      </Tabs>
    </section>
  );
}
