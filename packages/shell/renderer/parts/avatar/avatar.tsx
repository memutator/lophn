import { tokens } from "@lophn/ui";
import { componentMark } from "@lophn/ui/shared";
import type { ReactElement } from "react";
import type { CharacterProfile } from "../../../../protocol/lophn-agent/agent-values.ts";
import styles from "./avatar.module.css";
import { type Vendor, VendorIcon } from "../vendor-icon/vendor-icon.tsx";
import { AgentCharacter } from "./character.tsx";

export const AVATAR_SIZES = ["sm", "md", "lg"] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

export type AvatarProfile =
  | CharacterProfile
  | { readonly kind: "image"; readonly src: string }
  | { readonly kind: "initial"; readonly text: string }
  | { readonly kind: "vendor"; readonly vendor: Vendor };

// vendor 아이콘은 배경 없이 상자를 채운다(상자 크기는 avatar.module.css의 size와 같은 space token).
const VENDOR_PIXELS: Readonly<Record<AvatarSize, number>> = {
  sm: Number.parseFloat(tokens.space[7]),
  md: Number.parseFloat(tokens.space[8]),
  lg: Number.parseFloat(tokens.space[11]),
};

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
      {profile.kind === "vendor" && (
        <VendorIcon vendor={profile.vendor} size={VENDOR_PIXELS[size]} />
      )}
    </span>
  );
}
