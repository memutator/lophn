import { componentMark, iconPixels } from "@lophn/ui/shared";
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

// 원 안에 여백을 남기는 vendor 아이콘 크기.
const VENDOR_PIXELS: Readonly<Record<AvatarSize, number>> = {
  sm: iconPixels("small"),
  md: iconPixels("base"),
  lg: iconPixels("large") * 2,
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
