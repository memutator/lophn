// A new version of an app, before it is allowed: only what the version adds and what it would delete.
import { t } from "@lophn/i18n";
import {
  Button,
  Card,
  Icon,
  Mark,
  Screen,
  Text,
  TopBar,
} from "@lophn/ui-native";
import { Check, TriangleAlert, X } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import {
  useInbox,
  useNames,
  cardOf,
} from "../../data/mod.ts";
import { DIM, OfflineBanner, useLocked } from "../../parts/mod.ts";
import { useAnswering } from "./item.tsx";

function Line({ kind, children }: { kind: string; children: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, paddingVertical: 3 }}>
      <Text variant="detail" tone="muted" style={{ flexShrink: 0 }}>
        {kind}
      </Text>
      <Text
        variant="small"
        mono
        style={{ flexShrink: 1, lineHeight: 20 }}
        selectable
      >
        {children}
      </Text>
    </View>
  );
}

function Gone({ children }: { children: ReactNode }) {
  return (
    <View style={{ paddingTop: 24, paddingHorizontal: 20 }}>
      <Text tone="muted">{children}</Text>
    </View>
  );
}

export function AppUpdateScreen({ place }: { place: PlaceOf<"app-update"> }) {
  const nav = useNav();
  const inbox = useInbox();
  const names = useNames();
  const answering = useAnswering();
  const entry = inbox.entries.find(
    (one) => one.kind === "activation" && one.id === place.id,
  );
  const locked = useLocked();
  const top = (
    <TopBar
      left="back"
      onLeft={nav.back}
      title={t("waiting.label.group-activation")}
    />
  );
  if (entry === undefined || entry.kind !== "activation") {
    return (
      <Screen top={top}>
        <Gone>{t("mobile.inbox.update.gone")}</Gone>
      </Screen>
    );
  }
  const view = cardOf(entry, names);
  const answer = async (choice: "allow" | "reject") => {
    if (await answering.send(() => inbox.decide(entry, choice))) nav.back();
  };
  const disabled = locked || answering.busy;
  return (
    <Screen
      top={
        <TopBar
          left="back"
          onLeft={nav.back}
          title={t("mobile.inbox.update.title", {
            app: entry.request.app_name,
          })}
        />
      }
      scroll
      footer={
        <View
          style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10 }}
        >
          {answering.error !== null && (
            <Text variant="note" tone="critical" style={{ marginBottom: 8 }}>
              {answering.error}
            </Text>
          )}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              block
              size="lg"
              icon={X}
              disabled={disabled}
              onPress={() => answer("reject")}
            >
              {t("waiting.button.deny")}
            </Button>
            <Button
              block
              size="lg"
              variant="primary"
              icon={Check}
              disabled={disabled}
              onPress={() => answer("allow")}
            >
              {t("waiting.button.allow")}
            </Button>
          </View>
        </View>
      }
    >
      <OfflineBanner note={t("mobile.inbox.offline.text")} />
      <View style={{ opacity: locked ? DIM : 1 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingTop: 14,
          paddingBottom: 12,
          paddingHorizontal: 20,
        }}
      >
        <Mark kind="app" name={entry.request.app_name} tone={1} size="md" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text weight="semibold" style={{ lineHeight: 22 }}>
            {entry.request.app_name}
          </Text>
          <Text variant="note" tone="muted">
            {t("mobile.inbox.update.asked", { age: view.age })}
          </Text>
        </View>
      </View>
      <Text
        variant="control"
        style={{ marginHorizontal: 20, marginBottom: 12 }}
      >
        {view.description}
      </Text>
      <Card
        style={{
          marginHorizontal: 16,
          paddingVertical: 12,
          paddingHorizontal: 14,
        }}
      >
        <Text variant="detail" weight="medium" style={{ marginBottom: 4 }}>
          {view.first
            ? t("waiting.label.activation-first")
            : t("waiting.label.activation-new")}
        </Text>
        {view.added.map((line) => (
          <Line key={`${line.label}:${line.value}`} kind={`+ ${line.label}`}>
            {line.value}
          </Line>
        ))}
        {view.loss.length > 0 && (
          <>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginTop: 10,
                marginBottom: 4,
              }}
            >
              <Icon icon={TriangleAlert} size={16} tone="warning" />
              <Text variant="detail" weight="medium">
                {t("waiting.label.loss-heading")}
              </Text>
            </View>
            {view.loss.map((step) => (
              <Line key={`${step.label}:${step.value}`} kind={step.label}>
                {step.value}
              </Line>
            ))}
          </>
        )}
        {(view.removed.length > 0 || view.receiversUnreadable > 0) && (
          <>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginTop: 10,
                marginBottom: 4,
              }}
            >
              <Icon icon={TriangleAlert} size={16} tone="warning" />
              <Text variant="detail" weight="medium">
                {t("waiting.label.removed-heading")}
              </Text>
            </View>
            {view.removed.map((line) => (
              <Line key={`${line.label}:${line.value}`} kind={line.label}>
                {line.value}
              </Line>
            ))}
            {view.receiversUnreadable > 0 && (
              <Text variant="note" tone="muted">
                {t("waiting.notice.receivers-unreadable", {
                  count: view.receiversUnreadable,
                })}
              </Text>
            )}
          </>
        )}
      </Card>
      <Text
        variant="note"
        tone="muted"
        style={{ marginTop: 10, marginHorizontal: 20 }}
      >
        {t("waiting.notice.activation-fine")}
      </Text>
      </View>
    </Screen>
  );
}
