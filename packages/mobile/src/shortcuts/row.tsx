// The app menu's "Add to Home screen" (tools/wireframes/drafts/phone/widgets.tsx AppMenu, PinConfirm): asks the launcher
// to place the app's icon and name; tapping it opens the app's phone screen. The launcher draws the question.
import { t } from "@lophn/i18n";
import { Icon, Row } from "@lophn/ui-native";
import { SquarePlus } from "lucide-react-native";
import { useState } from "react";
import { appIcon } from "../../../protocol/apps/declaration/read.ts";
import { readRoute } from "../../../shell/renderer/desktop/connection/core-read.ts";
import { useEventClient } from "../../../shell/renderer/desktop/connection/events/hooks.tsx";
import { shortcuts } from "../../modules/lophn-widgets/index.ts";
import type { PhoneApp } from "../data/mod.ts";
import { openUrl } from "../open/target.ts";
import { type Drawn, drawnOf, IconPicture, pictureKey } from "./picture.tsx";
import { shortcutId } from "./sync.ts";

/** Whether the row has anything to offer: the launcher can place icons and this app's is not there yet. */
export function canAddToHomeScreen(host: string, app: string): boolean {
  return (
    shortcuts.isPinSupported() &&
    !shortcuts.pinnedIds().includes(shortcutId(host, app))
  );
}

/** `onAsked`: the launcher was asked (the menu closes under its question). */
export function AddToHomeScreen({
  host,
  app,
  onAsked,
}: {
  host: string;
  app: PhoneApp;
  onAsked: () => void;
}) {
  const core = useEventClient().core;
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [round, setRound] = useState(0);
  const pin = (one: Drawn, png: string) => {
    setDrawn(null);
    shortcuts.pin({
      id: shortcutId(host, app.app),
      label: app.name,
      // Native puts lophn's own mark where the PNG does not decode.
      iconPng: png,
      url: openUrl({ kind: "app", host, app: app.app }),
      // Of what was asked for, not of the mark drawn instead: the next sync would draw it again for nothing.
      picture: pictureKey(one),
    });
    onAsked();
  };
  const start = async () => {
    if (drawn !== null) return;
    const read = await readRoute(core, appIcon, { app: app.app }).catch(
      () => ({ ok: false }) as const,
    );
    setRound((one) => one + 1);
    setDrawn(drawnOf(app.app, app.name, read.ok ? read.value.icon : null));
  };
  return (
    <>
      <Row
        lead={<Icon icon={SquarePlus} />}
        title={t("mobile.shortcut.menu.add")}
        onPress={() => void start()}
      />
      {drawn !== null && (
        <IconPicture key={round} drawn={drawn} onDone={(png) => pin(drawn, png)} />
      )}
    </>
  );
}
