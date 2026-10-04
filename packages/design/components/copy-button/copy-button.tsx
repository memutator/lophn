import { Copy } from "lucide-react";
import { t } from "@lophn/wording";
import { IconButton } from "../icon-button/icon-button.tsx";
import type { Clipboard } from "../shared.ts";
import styles from "./copy-button.module.css";
import { useCopy } from "./use-copy.ts";

export interface CopyButtonProps {
  // 복사할 전체 값.
  text: string;
  // 아이콘 버튼 이름. wording key 문구를 준다.
  label: string;
  clipboard: Clipboard;
}

// 개발자 ID·code 복사. 실패하면 중립 문장을 옆에 두고 같은 버튼으로 다시 시도한다.
export function CopyButton({ text, label, clipboard }: CopyButtonProps) {
  const { failed, copy } = useCopy(clipboard);
  return (
    <span className={styles.copy}>
      <IconButton
        icon={Copy}
        size="sm"
        label={label}
        onClick={() => copy(text)}
      />
      {failed && (
        <span className={styles.failed} role="status">
          {t("common.copy.failed")}
        </span>
      )}
    </span>
  );
}
