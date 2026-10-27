import { componentMark } from "@lophn/ui/shared";
import type { ReactElement } from "react";
import type { CharacterProfile } from "../../../../protocol/lophn-agent/agent-values.ts";
import styles from "./avatar.module.css";
import { AgentCharacter } from "./character.tsx";

export const AVATAR_SIZES = ["sm", "md", "lg"] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

export type AvatarProfile =
  | CharacterProfile
  | { readonly kind: "image"; readonly src: string }
  | { readonly kind: "initial"; readonly text: string };

export interface AvatarProps {
  profile: AvatarProfile;
  size?: AvatarSize;
  label?: string;
}

export function Avatar({
  profile,
  size = "md",
  label,
}: AvatarProps): ReactElement {
  return (
    <span
      className={styles.avatar}
      data-avatar=""
      data-kind={profile.kind}
      data-size={size}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      {...componentMark("Avatar")}
    >
      {profile.kind === "character" && <AgentCharacter profile={profile} />}
      {profile.kind === "image" && (
        <img className={styles.image} src={profile.src} alt="" />
      )}
      {profile.kind === "initial" && profile.text}
    </span>
  );
}
