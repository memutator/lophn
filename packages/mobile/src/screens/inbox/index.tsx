import { t } from "@lophn/i18n";
import { Screen, Tabs, TopBar } from "@lophn/ui-native";
import { useState } from "react";
import { useNav } from "../../app/nav.ts";
import { useInbox } from "../../data/mod.ts";
import { EmptyScreen, OfflineBanner, useLocked } from "../../parts/mod.ts";
import { History } from "./history.tsx";
import { Now } from "./now.tsx";

export { AppUpdateScreen } from "./update.tsx";

export function InboxScreen() {
  const nav = useNav();
  const inbox = useInbox();
  const [tab, setTab] = useState(0);
  // Offline, the last things seen stay in view but cannot be answered.
  const locked = useLocked();
  const empty = inbox.entries.length === 0 && inbox.notices.length === 0;
  return (
    <Screen
      top={
        <>
          <TopBar {...nav.menuButton} title={t("left-sidebar.button.inbox")} />
          <Tabs
            items={[
              t("waiting.label.tab-now"),
              inbox.historyUnread > 0
                ? t("waiting.label.tab-history-unread", {
                    count: inbox.historyUnread,
                  })
                : t("waiting.label.tab-history"),
            ]}
            on={tab}
            onChange={setTab}
          />
        </>
      }
      scroll={!(tab === 0 && empty)}
    >
      <OfflineBanner note={t("mobile.inbox.offline.text")} />
      {tab === 0 ? (
        empty ? (
          <EmptyScreen title={t("waiting.notice.empty")}>
            {t("mobile.inbox.empty.text")}
          </EmptyScreen>
        ) : (
          <Now locked={locked} />
        )
      ) : (
        <History locked={locked} />
      )}
    </Screen>
  );
}
