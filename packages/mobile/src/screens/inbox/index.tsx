import { t } from "@lophn/i18n";
import { Banner, Screen, Tabs, Text, TopBar } from "@lophn/ui-native";
import { WifiOff } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { useNav } from "../../app/nav.ts";
import { useCurrentComputer, useInbox } from "../../data/mod.ts";
import { Character, LOPHN } from "../../parts/mod.ts";
import { History } from "./history.tsx";
import { Now } from "./now.tsx";

export { AppUpdateScreen } from "./update.tsx";

function Empty() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 28,
      }}
    >
      <View style={{ opacity: 0.9 }}>
        <Character profile={LOPHN} size={64} />
      </View>
      <Text
        variant="heading"
        weight="semibold"
        align="center"
        style={{ marginTop: 14 }}
      >
        {t("waiting.notice.empty")}
      </Text>
      <Text
        variant="control"
        tone="secondary"
        align="center"
        style={{ marginTop: 10 }}
      >
        {t("mobile.inbox.empty.text")}
      </Text>
    </View>
  );
}

export function InboxScreen() {
  const nav = useNav();
  const inbox = useInbox();
  const computer = useCurrentComputer();
  const [tab, setTab] = useState(0);
  // Offline, the last things seen stay in view but cannot be answered.
  const locked = computer?.status !== "connected";
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
      {locked && (
        <View style={{ paddingBottom: 8 }}>
          <Banner icon={WifiOff} title={t("mobile.inbox.offline.title")}>
            {t("mobile.inbox.offline.text")}
          </Banner>
        </View>
      )}
      {tab === 0 ? (
        empty ? (
          <Empty />
        ) : (
          <Now locked={locked} />
        )
      ) : (
        <History locked={locked} />
      )}
    </Screen>
  );
}
