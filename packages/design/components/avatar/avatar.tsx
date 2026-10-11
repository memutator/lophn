// agent의 얼굴. icon 하나, 사람이 올린 이미지, 이니셜 중 하나를 둥글게 그린다.
// sidebar·Agent 화면 머리·메시지·Agents 탭 카드·편집 form이 같은 component를 쓴다(shell/desktop#R40).
import type { ReactElement } from "react";

export const AVATAR_SIZES = ["sm", "md", "lg"] as const;
/** sm 20px, md 24px(메시지·머리), lg 48px(편집 form). */
export type AvatarSize = (typeof AVATAR_SIZES)[number];

export type AvatarProfile =
  /** design system icon의 id. 모르는 id는 이니셜이 아니라 기본 icon으로 그린다. */
  | { readonly kind: "icon"; readonly icon: string }
  /** 사람이 올린 이미지. 화면이 읽을 수 있는 주소로 풀어서 준다. */
  | { readonly kind: "image"; readonly src: string }
  /** 한두 글자. 그대로 보인다. */
  | { readonly kind: "initial"; readonly text: string };

export interface AvatarProps {
  profile: AvatarProfile;
  /** 기본 md. */
  size?: AvatarSize;
  /**
   * 있으면 `role="img"`와 `aria-label`로 이름을 붙인다. 없으면 장식이라 `aria-hidden`이다
   * (옆에 이름이 글로 있는 자리).
   */
  label?: string;
}

/**
 * 약속하는 DOM(test가 단언): 바깥 요소 `data-avatar`, `data-kind`(icon|image|initial),
 * `data-size`(sm|md|lg). icon이면 `data-icon`에 id와 안에 svg 하나, image면 `<img src>` 하나,
 * initial이면 글자 그대로.
 */
export function Avatar(_props: AvatarProps): ReactElement {
  throw new Error("not implemented: agent-I20");
}
