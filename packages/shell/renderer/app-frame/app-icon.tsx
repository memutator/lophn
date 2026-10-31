// 앱이 선언한 icon 이미지. 앱을 보이는 자리(탭 줄, 앱 목록)가 같이 쓴다. layout 파일에는 싣지 않고
// 그릴 때마다 읽는다.
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { useEffect, useState } from "react";

import type { CoreSource } from "../desktop/connection/connection.ts";
import { PlaceMark } from "../parts/place-mark/place-mark.tsx";
import { workspaceIcons } from "../icons/mod.ts";
import styles from "./app-icon.module.css";
import { type AppViewsDeps, useAppViews } from "./app-views.tsx";

// 앱이 icon을 새로 올려도 곧 보이도록 오래 쥐지 않는다. 여러 자리가 한꺼번에 읽는 것만 하나로 합친다.
const CACHE_MS = 10_000;

/** core `apps.icon`을 data URL로 옮긴다. icon이 없거나 읽지 못하면 undefined다. */
export function coreAppIcon(
  core: CoreSource,
  now: () => number = Date.now,
): NonNullable<AppViewsDeps["icon"]> {
  const cache = new Map<
    string,
    { at: number; icon: Promise<string | undefined> }
  >();
  return (app) => {
    const hit = cache.get(app);
    if (hit !== undefined && now() - hit.at < CACHE_MS) return hit.icon;
    const icon = core
      .call({ kind: "read", resource: "apps", method: "icon", body: { app } })
      .then((reply) => {
        if (!reply.ok) return undefined;
        const value = (
          reply.value as {
            icon: { content_type: string; data: string } | null;
          }
        ).icon;
        return value === null
          ? undefined
          : `data:${value.content_type};base64,${value.data}`;
      })
      .catch(() => undefined);
    cache.set(app, { at: now(), icon });
    return icon;
  };
}

/** 앱 icon의 data URL. 없거나 앱 view 통로가 없으면 undefined다. */
export function useAppIcon(app: string | undefined): string | undefined {
  const deps = useAppViews();
  const read = deps?.icon;
  const [icon, setIcon] = useState<string | undefined>(undefined);
  useEffect(() => {
    setIcon(undefined);
    if (app === undefined || read === undefined) return;
    let live = true;
    void read(app).then((value) => {
      if (live) setIcon(value);
    });
    return () => {
      live = false;
    };
  }, [app, read]);
  return icon;
}

/** 탭 줄의 앱 패널 아이콘. 앱 icon이 없으면 기본 아이콘이다. */
export function AppTabIcon({ app }: { app: string | undefined }) {
  const icon = useAppIcon(app);
  const pixels = iconPixels("small");
  if (icon === undefined) {
    return <Icon icon={workspaceIcons.appPanel} pixels={pixels} />;
  }
  return (
    <img
      className={styles.tab}
      src={icon}
      alt=""
      width={pixels}
      height={pixels}
    />
  );
}

/** 앱 목록의 표식. 선언한 icon이 있으면 그 이미지, 없으면 첫 글자와 색이다. */
export function AppPlaceMark({
  id,
  name,
  icon,
}: {
  id: string;
  name: string;
  /** 부르는 쪽이 이미 가진 이미지. 있으면 그것을 쓴다. */
  icon?: string;
}) {
  const declared = useAppIcon(icon === undefined ? id : undefined);
  const src = icon ?? declared;
  return (
    <PlaceMark
      kind="app"
      id={id}
      name={name}
      {...(src === undefined ? {} : { icon: src })}
    />
  );
}
