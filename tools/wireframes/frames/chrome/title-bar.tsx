// 새 설계 화면들이 같이 쓰는 창 위쪽 바. 실제 TopBar를 감싸 높이를 36px로 줄인다(실제는 48px).
// 명령 palette 단추는 검색 돋보기 대신 명령 아이콘을 쓴다. 돋보기는 여러 화면의 검색이 쓴다.
import { Command } from "lucide-react";
import { IconButton } from "@lophn/design/components";

import {
  TopBar,
  type TopBarProps,
} from "../../../../packages/shell/renderer/desktop/top-bar/top-bar.tsx";
import styles from "./title-bar.module.css";

export function WireTopBar(props: Omit<TopBarProps, "platform">) {
  return (
    <div className={styles.titleBar}>
      <TopBar platform="linux" {...props} />
    </div>
  );
}

export function PaletteButton({ onClick }: { onClick?: () => void }) {
  return (
    <IconButton
      icon={Command}
      label="Command palette"
      variant="ghost"
      onClick={onClick}
    />
  );
}
