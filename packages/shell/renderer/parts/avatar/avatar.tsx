import { tokens } from "@lophn/ui";
import { componentMark } from "@lophn/ui/shared";
import type { ReactElement } from "react";
import type { CharacterAvatar } from "../../../../protocol/lophn-agent/agent-values.ts";
import { type Vendor, VendorIcon } from "../vendor-icon/vendor-icon.tsx";
import styles from "./avatar.module.css";
import { AgentCharacter } from "./character.tsx";

export const AVATAR_SIZES = ["sm", "md", "lg"] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

export type AvatarLook =
  | CharacterAvatar
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
  look: AvatarLook;
  size?: AvatarSize;
  label?: string;
}

export function Avatar({
  look,
  size = "md",
  label,
}: AvatarProps): ReactElement {
  return (
    <span
      className={styles.avatar}
      data-avatar=""
      data-kind={look.kind}
      data-size={size}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      {...componentMark("Avatar")}
    >
      {look.kind === "character" && <AgentCharacter look={look} />}
      {look.kind === "image" && (
        <img className={styles.image} src={look.src} alt="" />
      )}
      {look.kind === "initial" && look.text}
      {look.kind === "vendor" && (
        <VendorIcon vendor={look.vendor} size={VENDOR_PIXELS[size]} />
      )}
    </span>
  );
}
