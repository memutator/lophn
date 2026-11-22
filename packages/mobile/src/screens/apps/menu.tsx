// The app screen's ⋯ (tools/wireframes/drafts/phone/apps.tsx AppMenu): asking lophn to change the app, its sessions, its
// activity, the release that is live, the preview running on the computer, and the app's other phone screens.
import { t } from "@lophn/i18n";
import { Badge, Divider, Icon, Row, Sheet } from "@lophn/ui-native";
import {
  FlaskConical,
  History,
  LayoutGrid,
  MessageSquarePlus,
  PencilLine,
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
import { AddToHomeScreen, canAddToHomeScreen } from "../../shortcuts/row.tsx";
import { useWidgetLists } from "../widgets/index.tsx";
import { when } from "../workspace/common.tsx";

export function AppMenu({
  open,
  onClose,
  app,
  screen,
  mark,
  sub,
  waiting,
  onAnnotate,
}: {
  open: boolean;
  onClose: () => void;
  app: PhoneApp;
  /** The screen on show; the others are listed. */
  screen: string;
  mark: ReactNode;
  /** Where the app runs: the line under its name on the app screen, or the computer it runs on. */
  sub: string | undefined;
  /** What the app's sessions wait on the person for. */
  waiting: number;
  /** Starts marking a spot on this screen to send to the app's agent. */
  onAnnotate?: () => void;
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
  const addWidget = host !== undefined && widgets.length > 0 && isPinSupported();
  const addIcon = host !== undefined && open && canAddToHomeScreen(host, app.app);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      lead={mark}
      title={app.name}
      sub={sub}
    >
      <Row
        lead={<Icon icon={MessageSquarePlus} />}
        title={t("mobile.places.composer.app")}
        sub={t("mobile.apps.menu.ask-sub")}
        onPress={() => go({ name: "new-session", workspace })}
      />
      {onAnnotate !== undefined && (
        <Row
          lead={<Icon icon={PencilLine} />}
          title={t("mobile.apps.menu.annotate")}
          sub={t("mobile.apps.menu.annotate-sub")}
          onPress={() => {
            onClose();
            onAnnotate();
          }}
        />
      )}
      <Divider spacing={6} />
      <Row
        lead={<Face look={LOPHN} />}
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
      {app.preview !== null && (
        <Row
          lead={<Icon icon={FlaskConical} />}
          title={t("mobile.drive.menu.preview")}
          sub={t("mobile.drive.menu.preview-sub")}
          onPress={() => go({ name: "app", id: app.app, screen, preview: true })}
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
      {(addWidget || addIcon) && <Divider spacing={6} />}
      {addWidget && (
        <Row
          lead={<Icon icon={LayoutGrid} />}
          title={t("mobile.widget.menu.add")}
          sub={widgets.map((one) => one.label).join(", ")}
          onPress={() => go({ name: "widget-pick", app: { host, id: app.app } })}
        />
      )}
      {addIcon && <AddToHomeScreen host={host} app={app} onAsked={onClose} />}
    </Sheet>
  );
}
