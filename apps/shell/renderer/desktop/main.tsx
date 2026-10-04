import { useState } from "react";

import type { CoreSource } from "./connection/connection.ts";
import { Launcher } from "./launcher/launcher.tsx";
import { LAUNCHER, openLophn, type Route } from "./router.ts";

export interface DesktopProps {
  source: CoreSource;
  /** 창을 연 자리. 기본 창은 런처다. */
  initial?: Route;
  formatTime?: (confirmedAt: number) => string;
}

// 새 기본 창의 첫 화면. 공간 이동은 이 상태가 기억한다.
export function Desktop(
  { source, initial = LAUNCHER, formatTime }: DesktopProps,
) {
  const [route, setRoute] = useState<Route>(initial);
  if (route.space === "launcher") {
    return (
      <Launcher
        source={source}
        formatTime={formatTime}
        onLophn={() => setRoute(openLophn())}
      />
    );
  }
  return (
    <Launcher
      source={source}
      formatTime={formatTime}
      onLophn={() => setRoute(openLophn())}
    />
  );
}
