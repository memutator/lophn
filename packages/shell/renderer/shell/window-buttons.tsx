import { useEffect, useState } from "react";
import { t } from "@lophn/i18n";
import { IconButton } from "@lophn/ui/primitives";

import type {
  WindowControlsApi,
  WindowState,
} from "../../ipc/window-controls.ts";
import {
  windowCloseIcon,
  windowMaximizeIcon,
  windowMinimizeIcon,
  windowRestoreIcon,
} from "../icons/mod.ts";

export function bridge(): WindowControlsApi | undefined {
  return (globalThis as { lophnWindow?: WindowControlsApi }).lophnWindow;
}

// Windows·Linux title bar 오른쪽 끝의 창 단추. 통로가 없는 환경(시험·브라우저)에서는 그리지 않는다.
export function WindowButtons({ api }: { api: WindowControlsApi | undefined }) {
  const [state, setState] = useState<WindowState>({ maximized: false });
  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.state().then((reply) => {
      if (live && reply.ok) setState(reply.state);
    });
    const off = api.subscribe((next) => setState(next));
    return () => {
      live = false;
      off();
    };
  }, [api]);
  if (!api) return null;
  const maximize = state.maximized
    ? { icon: windowRestoreIcon, label: t("common.label.window-restore") }
    : { icon: windowMaximizeIcon, label: t("common.label.window-maximize") };
  return (
    <>
      <IconButton
        icon={windowMinimizeIcon}
        label={t("common.label.window-minimize")}
        size="sm"
        onClick={() => void api.minimize()}
      />
      <IconButton
        icon={maximize.icon}
        label={maximize.label}
        size="sm"
        onClick={() => void api.toggleMaximize()}
      />
      <IconButton
        icon={windowCloseIcon}
        label={t("common.label.window-close")}
        size="sm"
        onClick={() => void api.close()}
      />
    </>
  );
}
