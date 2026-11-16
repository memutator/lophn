// Preview from lophn: the preview of a user app that runs on the computer, on this phone, so the person (and lophn's
// agents on that computer) can try the version being built. Like the app screen (apps.tsx Orders) with a Preview line
// under the top line and, while an agent drives it, a line that says who with [Take control] / [Hand back]. Both are
// rows of the layout above the guest, never drawn over it: the guest loses the touches under anything on top of it.
import { t } from "@lophn/i18n";
import {
  Button,
  Divider,
  Icon,
  IconButton,
  Mark,
  type MarkTone,
  Row,
  Screen,
  Sheet,
  Text,
  TopBar,
} from "@lophn/ui-native";
import { Bot, Ellipsis, FlaskConical, Hand, Smartphone } from "lucide-react-native";
import { useState } from "react";
import type { PlaceOf } from "../../app/nav.ts";
import { useNav } from "../../app/nav.ts";
import { type PreviewHandle, useDriveLine } from "../../apps/drive/mod.ts";
import { usePreview } from "../../apps/drive/use-preview.ts";
import {
  useComputers,
  useCurrentComputer,
  usePhoneApps,
  useWorkspaces,
} from "../../data/mod.ts";
import { Away, Body } from "./body.tsx";

export function PreviewScreen({ place }: { place: PlaceOf<"app"> }) {
  const nav = useNav();
  const computer = useCurrentComputer();
  const { retry: redial } = useComputers();
  const apps = usePhoneApps();
  const app = apps.apps.find((one) => one.app === place.id);
  const workspace = useWorkspaces().find((one) => one.key === place.id);
  // Another screen of the preview is picked from its menu and replaces this one.
  const [wanted, setWanted] = useState(place.screen);
  const preview = usePreview({ computer, apps, app, screen: wanted });
  const [menu, setMenu] = useState(false);

  const name = app?.name ?? workspace?.name ?? "";
  const icon = workspace?.icon.kind === "app" ? workspace.icon : null;
  const mark = (size: "sm" | "md" | "lg") => (
    <Mark kind="app" name={icon?.letter || name} tone={(icon?.tone ?? 0) as MarkTone} size={size} />
  );
  const computerName = computer?.name ?? "";
  const others = app?.preview?.screens.filter((one) => one.screen !== preview.screen) ?? [];

  return (
    <Screen
      tone="floor"
      top={
        <TopBar
          left="back"
          onLeft={nav.back}
          lead={mark("sm")}
          title={name}
          right={
            others.length === 0 ? undefined : (
              <IconButton
                icon={Ellipsis}
                label={t("conversation.label.more-actions")}
                onPress={() => setMenu(true)}
              />
            )
          }
        />
      }
    >
      <Row
        lead={<Icon icon={FlaskConical} />}
        title={t("common.label.app-mode-preview")}
        sub={t("mobile.drive.note", { computer: computerName })}
        wrap
      />
      <Driving handle={preview.handle} />
      <Divider inset={0} />
      {preview.state.kind === "stopped" ? (
        <Away
          mark={mark("lg")}
          title={t("mobile.drive.stopped.title", { computer: computerName })}
          body={t("mobile.drive.stopped.body")}
          action={<Button onPress={nav.back}>{t("common.button.close")}</Button>}
        />
      ) : (
        <Body
          state={preview.state}
          installed={false}
          app={name}
          computer={computerName}
          mark={mark("lg")}
          onRetry={preview.state.kind === "offline" ? redial : preview.retry}
        />
      )}
      <Sheet
        open={menu}
        onClose={() => setMenu(false)}
        lead={mark("md")}
        title={name}
        sub={t("mobile.drive.menu.runs-on", { computer: computerName })}
      >
        {others.map((one) => (
          <Row
            key={one.screen}
            lead={<Icon icon={Smartphone} />}
            title={one.label}
            onPress={() => {
              setMenu(false);
              setWanted(one.screen);
            }}
          />
        ))}
      </Sheet>
    </Screen>
  );
}

/** "<agent> is driving this screen" while requests come, "You have control" after Take control. */
function Driving({ handle }: { handle: PreviewHandle | null }) {
  const line = useDriveLine(handle);
  if (handle === null || line.kind === "none") return null;
  return line.kind === "driving" ? (
    <Row
      lead={<Icon icon={Bot} />}
      // The agent's name can be long; the line wraps instead of cutting it.
      title={<Text style={{ lineHeight: 22 }}>{t("mobile.drive.driving", { agent: line.by })}</Text>}
      end={
        <Button size="sm" variant="secondary" onPress={handle.takeControl}>
          {t("mobile.drive.button.take-control")}
        </Button>
      }
    />
  ) : (
    <Row
      lead={<Icon icon={Hand} />}
      title={t("mobile.drive.control.title")}
      sub={t("mobile.drive.control.sub")}
      wrap
      end={
        <Button size="sm" variant="secondary" onPress={handle.handBack}>
          {t("mobile.drive.button.hand-back")}
        </Button>
      }
    />
  );
}
