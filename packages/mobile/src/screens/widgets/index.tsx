// "Choose a widget" (tools/wireframes/drafts/phone/widgets.tsx Choose, ChooseApp and ChooseEmpty): the widgets the apps of
// the paired computers declare, with their value now. Opened from a placed widget that shows nothing yet (it takes the
// choice) or from an app's menu (it asks the launcher to place a new widget).
import { t } from "@lophn/i18n";
import {
  Dot,
  Label,
  Mark,
  type MarkTone,
  Screen,
  Text,
  Toast,
  TopBar,
} from "@lophn/ui-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import type { AppWidget } from "../../../../protocol/apps/widget.ts";
import { stateOf } from "../../app/computer-state.ts";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import { toneOf, useComputers } from "../../data/mod.ts";
import { EmptyNote } from "../../parts/mod.ts";
import {
  finishConfigure,
  requestPin,
} from "../../../modules/lophn-widgets/index.ts";
import { bindWidget } from "../../widgets/store.ts";
import { Preview } from "./preview.tsx";
import { useWidgetLists } from "./use-widget-lists.ts";

export { useWidgetLists } from "./use-widget-lists.ts";

function AppHead({ widget }: { widget: AppWidget }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingTop: 10,
        paddingBottom: 4,
        paddingHorizontal: 20,
      }}
    >
      <Mark
        kind="app"
        name={widget.app_name}
        tone={toneOf(widget.app) as MarkTone}
        size="md"
      />
      <Text variant="body" weight="semibold" numberOfLines={1}>
        {widget.app_name}
      </Text>
    </View>
  );
}

function Pick({
  widget,
  wide,
  onPress,
}: {
  widget: AppWidget;
  /** One app on show: the widgets line up under the app's name. */
  wide: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        marginTop: 4,
        marginBottom: 10,
        marginRight: 20,
        marginLeft: wide ? 20 : 64,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text
        variant="control"
        weight="medium"
        style={{ paddingHorizontal: 2, paddingBottom: 4 }}
      >
        {widget.label}
      </Text>
      <Preview widget={widget} />
    </Pressable>
  );
}

export function WidgetPickScreen({ place }: { place: PlaceOf<"widget-pick"> }) {
  const nav = useNav();
  const { computers } = useComputers();
  const only = place.app;
  const shown = computers.filter(
    (one) =>
      !one.sample &&
      one.status !== "revoked" &&
      (only === undefined || one.key === only.host),
  );
  const lists = useWidgetLists(
    shown.filter((one) => one.status === "connected").map((one) => one.key),
  );
  const [notPlaced, setNotPlaced] = useState(false);
  const chosen = useRef(false);
  // The launcher waits for an answer while it adds a widget (`configure`). Leaving by the system Back keeps the widget as a
  // placeholder, so the person lands back on the launcher; the close button cancels the add.
  const answered = useRef(false);
  const configuring = place.configure ? place.widget : undefined;
  useEffect(
    () => () => {
      if (configuring !== undefined && !answered.current) {
        finishConfigure(configuring, true);
      }
    },
    [configuring],
  );

  const close = () => {
    if (configuring !== undefined) {
      answered.current = true;
      finishConfigure(configuring, false);
    }
    nav.back();
  };

  const choose = async (widget: AppWidget, host: string) => {
    if (chosen.current) return;
    chosen.current = true;
    if (place.widget !== undefined) {
      await bindWidget(place.widget, { host, app: widget.app, key: widget.key });
      if (configuring !== undefined) {
        answered.current = true;
        finishConfigure(configuring, true);
      }
      return nav.back();
    }
    // The launcher asks the person and, when they add it, native binds it: there is nothing to wait for here.
    if (requestPin("wide", { host, app: widget.app, key: widget.key })) {
      return nav.back();
    }
    chosen.current = false;
    setNotPlaced(true);
  };

  const groups: ReactNode[] = [];
  let settled = true;
  let first: AppWidget | undefined;
  for (const computer of shown) {
    const list = lists.get(computer.key);
    const reachable = computer.status === "connected";
    if (reachable && list === undefined) settled = false;
    const widgets = (list ?? []).filter(
      (one) => only === undefined || one.app === only.id,
    );
    first ??= widgets[0];
    const away = !reachable
      ? stateOf(computer).text
      : list === null
        ? t("mobile.widget.pick.failed")
        : null;
    if (away === null && widgets.length === 0) continue;
    const apps = [...new Set(widgets.map((one) => one.app))];
    groups.push(
      <View key={computer.key}>
        {only === undefined && (
          <Label end={<Dot tone={stateOf(computer).tone} />}>
            {computer.name}
          </Label>
        )}
        {away !== null && <EmptyNote>{away}</EmptyNote>}
        {apps.map((app) => {
          const mine = widgets.filter((one) => one.app === app);
          return (
            <View key={app}>
              <AppHead widget={mine[0]!} />
              {mine.map((one) => (
                <Pick
                  key={one.key}
                  widget={one}
                  wide={only !== undefined}
                  onPress={() => void choose(one, computer.key)}
                />
              ))}
            </View>
          );
        })}
      </View>,
    );
  }
  const empty = groups.length === 0 && settled;

  return (
    <Screen
      scroll={!empty}
      top={
        <TopBar
          left="close"
          onLeft={close}
          title={t("mobile.widget.pick.title")}
          under={
            only === undefined || first === undefined
              ? undefined
              : t("mobile.widget.pick.under", {
                  app: first.app_name,
                  computer: shown[0]?.name ?? "",
                })
          }
        />
      }
      over={
        notPlaced ? <Toast>{t("mobile.widget.pick.not-placed")}</Toast> : undefined
      }
    >
      {empty ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 28,
          }}
        >
          <Text variant="body" tone="secondary" align="center">
            {t("mobile.widget.pick.none")}
          </Text>
        </View>
      ) : (
        groups
      )}
    </Screen>
  );
}
