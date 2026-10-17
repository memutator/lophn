import { useEffect, useState } from "react";
import { t } from "@lophn/wording";
import { IconButton } from "@lophn/ui/primitives";
import {
  windowCloseIcon,
  windowMaximizeIcon,
  windowMinimizeIcon,
  windowRestoreIcon,
} from "../../icons/mod.ts";

import type {
  WindowControlsApi,
  WindowState,
} from "../../../ipc/window-controls.ts";
import styles from "./top-bar.module.css";

function bridge(): WindowControlsApi | undefined {
  return (globalThis as { lophnWindow?: WindowControlsApi }).lophnWindow;
}

// Windows·Linux 상단 바 오른쪽의 창 단추 셋. 최대화 상태는 main이 알려 준 값을
// 따르고, 통로가 없는 환경(시험·브라우저)에서는 그리지 않는다.
export function WindowControls(
  { api = bridge() }: { api?: WindowControlsApi },
) {
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
    <div className={styles.controls} data-window-controls="">
      <IconButton
        icon={windowMinimizeIcon}
        label={t("common.label.window-minimize")}
        data-window-action="minimize"
        onClick={() => void api.minimize()}
      />
      <IconButton
        icon={maximize.icon}
        label={maximize.label}
        data-window-action="toggle-maximize"
        data-maximized={state.maximized}
        onClick={() => void api.toggleMaximize()}
      />
      <IconButton
        icon={windowCloseIcon}
        label={t("common.label.window-close")}
        data-window-action="close"
        onClick={() => void api.close()}
      />
    </div>
  );
}
