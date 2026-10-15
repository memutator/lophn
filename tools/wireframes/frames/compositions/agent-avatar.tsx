// agent profile 그림. icon 하나를 둥근 바탕에 얹거나, 사용자가 올린 이미지(여기서는 둥근 사진 모양)를 보인다.
// 같은 그림이 sidebar, 탭 머리(agent header), 메시지, Agents 탭 카드, 편집 form에 나온다.
import { Icon } from "@lophn/design/components";
import {
  appSpaceIcons,
  conversationIcons,
  editorIcons,
  lophnSpaceIcons,
  paletteIcons,
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";

import {
  type AgentProfile,
  type AvatarIconKey,
  profileOf,
} from "./agents-data.ts";
import a from "./agents.module.css";

const ICONS = {
  dock: conversationIcons.dock,
  roles: lophnSpaceIcons.roles,
  contexts: workspaceIcons.context,
  documents: lophnSpaceIcons.documents,
  apps: appSpaceIcons.app,
  search: paletteIcons.search,
  series: lophnSpaceIcons.series,
  bookmark: lophnSpaceIcons.savedView,
  terminal: workspaceIcons.terminal,
  read: editorIcons.read,
  edit: editorIcons.edit,
  compare: editorIcons.compare,
} as const;

export const AVATAR_ICON_LABEL: Record<AvatarIconKey, string> = {
  dock: "Chat",
  roles: "People",
  contexts: "Library",
  documents: "Document",
  apps: "App",
  search: "Search",
  series: "Layers",
  bookmark: "Bookmark",
  terminal: "Terminal",
  read: "Book",
  edit: "Pencil",
  compare: "Compare",
};

export type AvatarSize = "sm" | "md" | "lg";

const SIZE: Record<AvatarSize, { box: string; icon: number }> = {
  sm: { box: a.avatarSm, icon: 12 },
  md: { box: a.avatarMd, icon: 14 },
  lg: { box: a.avatarLg, icon: 28 },
};

/** 사용자가 올린 이미지를 대신하는 둥근 사진 모양. */
function Photo() {
  return (
    <svg
      className={a.photo}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="40" height="40" fill="#b9d3ee" />
      <circle cx="28" cy="12" r="5" fill="#f6d77a" />
      <path d="M0 40V28c6-7 12-7 18-1 6-8 14-8 22 1v12z" fill="#5f8f6a" />
      <path d="M0 40V33c8-4 14-3 20 1 7-4 14-4 20 0v6z" fill="#3f6b4d" />
    </svg>
  );
}

/** profile을 직접 받아 그린다. */
export function ProfileAvatar(
  { profile, size = "md", label }: {
    profile: AgentProfile;
    size?: AvatarSize;
    label?: string;
  },
) {
  const spec = SIZE[size];
  return (
    <span
      className={`${a.avatar} ${spec.box} ${
        profile.image ? a.avatarImage : ""
      }`}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    >
      {profile.image
        ? <Photo />
        : <Icon icon={ICONS[profile.icon]} pixels={spec.icon} />}
    </span>
  );
}

/** agent 이름으로 profile을 찾아 그린다. */
export function Avatar(
  { agent, size = "md" }: { agent: string; size?: AvatarSize },
) {
  return <ProfileAvatar profile={profileOf(agent)} size={size} />;
}

export { ICONS as AVATAR_ICONS };
