// The app screen's ⋯ (tools/wireframes/drafts/phone/apps.tsx AppMenu): asking lophn to change the app, its sessions, its
// activity, the release that is live, and the app's other phone screens.
import { t } from "@lophn/i18n";
import { Badge, Divider, Icon, Row, Sheet } from "@lophn/ui-native";
import {
  History,
  LayoutGrid,
  MessageSquarePlus,
  ScrollText,
  Smartphone,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { useNav } from "../../app/nav.ts";
import {
  type PhoneApp,
  useAppRelease,
  useCurrentComputer,
} from "../../data/mod.ts";
import { Face, LOPHN } from "../../parts/mod.ts";
import { isPinSupported } from "../../../modules/lophn-widgets/index.ts";
import { useWidgetLists } from "../widgets/index.tsx";
import { when } from "../workspace/common.tsx";

export function AppMenu({
  open,
  onClose,
  app,
  screen,
  mark,
  computer,
  waiting,
}: {
  open: boolean;
  onClose: () => void;
  app: PhoneApp;
  /** The screen on show; the others are listed. */
  screen: string;
  mark: ReactNode;
  computer: string;
  /** What the app's sessions wait on the person for. */
  waiting: number;
}) {
  const nav = useNav();
  const release = useAppRelease(app.app);
  const workspace = { kind: "app", id: app.app } as const;
  const go = (place: Parameters<typeof nav.open>[0]) => {
    onClose();
    nav.open(place);
  };
  const live =
    release.loaded.state === "ready" ? release.loaded.value : null;
  const host = useCurrentComputer()?.key;
  const lists = useWidgetLists(open && host !== undefined ? [host] : []);
  const widgets = (host === undefined ? [] : (lists.get(host) ?? [])).filter(
    (one) => one.app === app.app,
  );
  const others = app.screens.filter((one) => one.screen !== screen);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      lead={mark}
      title={app.name}
      sub={t("mobile.apps.menu.runs-on", { computer })}
    >
      <Row
        lead={<Icon icon={MessageSquarePlus} />}
        title={t("mobile.places.composer.app")}
        sub={t("mobile.apps.menu.ask-sub")}
        onPress={() => go({ name: "new-session", workspace })}
      />
      <Divider spacing={6} />
      <Row
        lead={<Face profile={LOPHN} />}
        title={t("mobile.apps.menu.sessions")}
        end={<Badge count={waiting} />}
        onPress={() => go({ name: "workspace", workspace })}
      />
      <Row
        lead={<Icon icon={ScrollText} />}
        title={t("app-detail.label.tab-activity")}
        sub={t("mobile.apps.menu.activity-sub")}
        onPress={() => go({ name: "app-activity", app: app.app })}
      />
      {live !== null && (
        <Row
          lead={<Icon icon={History} />}
          title={t("shell.label.app-release", { number: live.number })}
          sub={t("mobile.places.app.went-live", { when: when(live.activatedAt) })}
        />
      )}
      {others.length > 0 && <Divider spacing={6} />}
      {others.map((one) => (
        <Row
          key={one.screen}
          lead={<Icon icon={Smartphone} />}
          title={one.label}
          onPress={() =>
            go({ name: "app", id: app.app, screen: one.screen })
          }
        />
      ))}
      {host !== undefined && widgets.length > 0 && isPinSupported() && (
        <>
          <Divider spacing={6} />
          <Row
            lead={<Icon icon={LayoutGrid} />}
            title={t("mobile.widget.menu.add")}
            sub={widgets.map((one) => one.label).join(", ")}
            onPress={() => go({ name: "widget-pick", app: { host, id: app.app } })}
          />
        </>
      )}
    </Sheet>
  );
}
