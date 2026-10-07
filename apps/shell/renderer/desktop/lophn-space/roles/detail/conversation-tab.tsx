import { useMemo } from "react";
import { t } from "@lophn/wording";

import { Dock } from "../../../../conversation/dock.tsx";
import { useConversation } from "../../../../conversation/dock-slot.tsx";
import { workPlaceOf } from "../model.ts";
import type { RoleRow, RolesSource } from "../source.ts";
import styles from "../roles.module.css";

export interface ConversationTabProps {
  source: RolesSource;
  role: RoleRow;
  onRead: (document: string, version: string | null) => void;
}

// 대화 탭. 도크와 같은 대화(message-list·입력·질문 칸)를 이 역할의 담당에 묶어 본문에 놓는다.
// 회수된 담당은 지난 대화만 읽고 입력창이 없다. 멈춘 담당은 도크와 같이 소유 concern의 허용 결과를
// 그대로 따른다(shell/desktop#R4, lophn-agent/assignments#R16).
export function ConversationTab(
  { source, role, onRead }: ConversationTabProps,
) {
  const deps = useConversation();
  const bound = useMemo(
    () => source.conversation(role),
    // 담당의 상태나 판이 바뀌면 대화 통로가 쥔 비교 기준도 새로 만든다.
    [source, role.id, role.state, role.revision],
  );
  if (deps === null) {
    return (
      <p className={styles.text} data-conversation="not-ready">
        {t("common.empty.not-ready")}
      </p>
    );
  }
  return (
    <div className={styles.conversation} data-conversation={role.id}>
      <Dock
        source={bound}
        drafts={deps.drafts}
        placement="docked"
        embedded
        workPlace={workPlaceOf(role)}
        onClose={() => {}}
        onOpenResult={onRead}
        ticks={deps.ticks}
        now={deps.now}
      />
    </div>
  );
}
