// inbox 탭 kind. 대기 목록(Inbox overlay와 같은 카드)을 한 쪽 전체로 보이는 탭이고 desk마다 하나다. 값은 모두 core의
// 대기 요청에 있어 layout에는 탭이 있다는 사실만 남는다.
import { t } from "@lophn/i18n";

import { runToastAction } from "../../desktop/connection/toasts/toast-actions.ts";
import { WaitingPage } from "../../desktop/connection/waiting/waiting-page.tsx";
import { notificationsIcon } from "../../icons/mod.ts";
import { PaddedTab } from "../padded-tab.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

const INBOX_KEY = "inbox";

/** Inbox 탭을 연다. 이미 열려 있으면 고르기만 한다. */
export function openInbox(host: TabHost): void {
  host.openTab({
    key: INBOX_KEY,
    kind: "inbox",
    title: t("project-workspace.label.kind-inbox"),
  });
}

export const inboxKind: TabKindDef = {
  kind: "inbox",
  labelKey: "project-workspace.label.kind-inbox",
  icon: notificationsIcon,
  // 창마다 같은 목록이라 다른 창으로 떼어 내지 않는다.
  noDetach: true,
  fromStored: (_stored, { key }) => ({
    key,
    kind: "inbox",
    title: t("project-workspace.label.kind-inbox"),
  }),
  toStored: (tab) =>
    tab.key === INBOX_KEY ? { kind: "inbox", key: tab.key } : null,
  render(_tab, active) {
    return (
      <PaddedTab>
        <WaitingPage
          active={active}
          onOpenSession={(session) =>
            runToastAction({ kind: "session", session })
          }
        />
      </PaddedTab>
    );
  },
};
