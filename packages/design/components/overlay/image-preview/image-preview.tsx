import * as Radix from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { t } from "@lophn/wording";
import { IconButton } from "../../primitives/icon-button/icon-button.tsx";
import { useReturnFocus } from "../return-focus.ts";
import { componentMark } from "../../_shared/shared.ts";
import styles from "./image-preview.module.css";

export interface ImagePreviewProps {
  // 보일 그림 주소. null이면 닫혀 있다.
  src: string | null;
  // 그림 이름. 화면에는 없고 읽기 도구가 읽는다.
  alt: string;
  onClose: () => void;
  container?: HTMLElement | null;
}

// 그림 하나를 창 가운데에 크게 보인다. 바깥을 누르거나 Esc나 [x]로 닫는다.
export function ImagePreview({
  src,
  alt,
  onClose,
  container,
}: ImagePreviewProps) {
  const focus = useReturnFocus(true);
  return (
    <Radix.Root
      open={src !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Radix.Portal container={container}>
        <Radix.Overlay className={styles.backdrop} />
        <Radix.Content
          className={styles.stage}
          aria-describedby={undefined}
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
          {...focus}
          {...componentMark("ImagePreview")}
        >
          <Radix.Title className={styles.title}>{alt}</Radix.Title>
          {src === null ? null : (
            <img className={styles.image} src={src} alt={alt} />
          )}
          <span className={styles.close}>
            <IconButton
              icon={X}
              label={t("common.button.close")}
              variant="secondary"
              onClick={onClose}
            />
          </span>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
