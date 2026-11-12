// primitives: 버튼·아이콘처럼 어디서나 쓰는 작은 조각.
// 글이 있는 일반 조작. 한 화면의 주 행동은 primary 하나만 둔다.
export {
  Button,
  type ButtonProps,
  type ButtonVariant,
} from "./button/button.tsx";
// 아이콘만 보이는 정사각 조작. 글을 둘 자리가 없을 때 쓰고 label을 꼭 준다.
export {
  IconButton,
  type IconButtonProps,
} from "./icon-button/icon-button.tsx";
// 선 아이콘 하나로 켜고 끄는 조작(pin, bookmark, 즐겨찾기). 켜면 아이콘 안쪽이 찬다. 이름(label)을 꼭 준다.
export {
  IconToggle,
  type IconToggleProps,
} from "./icon-toggle/icon-toggle.tsx";
// 단축키 표시. 눌러 보는 조작이 아니라 키 이름을 알릴 때 쓴다.
export { Kbd, type KbdProps } from "./kbd/kbd.tsx";
// Lucide 아이콘을 선 두께와 크기 token에 맞춰 그린다. 조작이면 IconButton을 쓴다.
export { Icon, type IconProps } from "./icon/icon.tsx";
// 값 하나를 clipboard로 복사하는 작은 버튼. 개발자 ID·code처럼 길어서 옮겨 쓰는 값에 쓴다.
export {
  CopyButton,
  type CopyButtonProps,
} from "./copy-button/copy-button.tsx";
// CopyButton과 다른 모양으로 복사할 때 쓰는 복사 상태 hook. 실패도 상태로 돌려준다.
export { type CopyState, useCopy } from "./copy-button/use-copy.ts";
// 파일·폴더 이름에 맞는 종류 아이콘. tree·탭 줄처럼 파일을 가리킬 때 쓴다.
export { FileIcon, fileIconName } from "./file-icon/file-icon.tsx";
