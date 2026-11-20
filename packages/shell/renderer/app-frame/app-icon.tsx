// 앱 icon(사람이 올린 이미지, 없으면 앱이 선언한 이미지나 lucide 이름). 앱을 보이는 자리(탭 줄, 앱 목록)가 같이 쓴다. layout 파일에는 싣지 않고
// 그릴 때마다 읽는다.
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import type { LucideIcon } from "lucide-react";

import type { CoreSource } from "../desktop/connection/connection.ts";
import { type MachineRef, useMachineHub } from "../desktop/machines/scope.tsx";
import {
  IconImage,
  useDrawableIcon,
} from "../parts/icon-upload/icon-image.tsx";
import {
  cachedIconReader,
  iconViewOf,
  useIconSrc,
} from "../parts/icon-upload/icon-reader.ts";
import { WorkspaceMark } from "../parts/workspace-mark/workspace-mark.tsx";
import { workspaceIcons } from "../icons/mod.ts";
import styles from "./app-icon.module.css";
import { type AppViewsDeps, useAppViews } from "./app-views.tsx";
import { appIconReader } from "./machine-app-source.ts";

/** core `apps.icon`을 data URL(앱이 lucide를 선언했으면 `lucide:<이름>`)로 옮긴다. 사람이 올린 icon이 앞서고, 없으면 선언한 icon이다. 없거나 읽지 못하면 undefined다. */
export function coreAppIcon(
  core: CoreSource,
  now: () => number = Date.now,
): NonNullable<AppViewsDeps["icon"]> {
  return cachedIconReader(async (app) => {
    const reply = await core.call({
      kind: "read",
      resource: "apps",
      method: "icon",
      body: { app },
    });
    if (!reply.ok) return undefined;
    return (
      iconViewOf(reply.value as Parameters<typeof iconViewOf>[0]).src ??
      undefined
    );
  }, now);
}

/** 앱 icon의 src(data URL이나 `lucide:<이름>`). `machine`을 주면 그 기계에서 읽는다. 없거나 앱 view 통로가 없으면 undefined다. */
export function useAppIcon(
  app: string | undefined,
  machine?: MachineRef,
): string | undefined {
  const hub = useMachineHub();
  const scope = useAppViews();
  return useDrawableIcon(useIconSrc(appIconReader(hub, scope, machine), app));
}

/** 탭 줄·사이드바의 앱 아이콘. 앱 icon이 없으면 fallback(기본은 앱 패널 아이콘)이다. */
export function AppTabIcon({
  app,
  machine,
  pixels = iconPixels("small"),
  fallback = workspaceIcons.appPanel,
}: {
  app: string | undefined;
  machine?: MachineRef;
  pixels?: number;
  fallback?: LucideIcon;
}) {
  const icon = useAppIcon(app, machine);
  if (icon === undefined) {
    return <Icon icon={fallback} pixels={pixels} />;
  }
  return <IconImage src={icon} size={pixels} className={styles.tab} />;
}

/** 앱 목록의 표식. icon이 있으면 그 이미지, 없으면 첫 글자와 색이다. */
export function AppWorkspaceMark({
  id,
  name,
  icon,
  machine,
}: {
  id: string;
  name: string;
  /** 부르는 쪽이 이미 가진 이미지. 있으면 그것을 쓴다. */
  icon?: string;
  machine?: MachineRef;
}) {
  const declared = useAppIcon(icon === undefined ? id : undefined, machine);
  const src = icon ?? declared;
  return (
    <WorkspaceMark
      kind="app"
      id={id}
      name={name}
      {...(src === undefined ? {} : { icon: src })}
    />
  );
}
