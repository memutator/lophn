import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Icon } from "../../primitives/icon/icon.tsx";
import { tokens } from "../../../tokens.ts";
import { componentMark, pixels } from "../../_shared/shared.ts";
import styles from "./attachment.module.css";

// 지우기 [x]. chip 안에서는 글자 옆 작은 단추, tile에서는 모서리에 걸친 둥근 단추다.
function Remove(
  { label, onRemove, badge }: {
    label: string;
    onRemove: () => void;
    badge: boolean;
  },
) {
  return (
    <button
      type="button"
      className={badge ? styles.badge : styles.remove}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
    >
      <Icon icon={X} pixels={pixels(tokens.attachment.removeIcon)} />
    </button>
  );
}

export interface AttachmentChipProps {
  // 파일 이름. 길면 줄임표로 자른다.
  name: string;
  // 이름 앞 종류 아이콘(FileIcon 같은).
  icon: ReactNode;
  // hover에 보이는 전체 값(경로).
  title?: string;
  // 주면 이름을 누를 수 있다(파일 열기).
  onOpen?: () => void;
  // 주면 오른쪽에 [x]가 생긴다.
  onRemove?: () => void;
  // [x]의 이름. wording key 문구를 준다.
  removeLabel?: string;
}

// 보낼 말에 붙였거나 보낸 말에 붙어 있는 파일 하나.
export function AttachmentChip(
  { name, icon, title, onOpen, onRemove, removeLabel = "" }:
    AttachmentChipProps,
) {
  const body = (
    <>
      <span className={styles.icon}>{icon}</span>
      <span className={styles.name}>{name}</span>
    </>
  );
  return (
    <span
      className={styles.chip}
      title={title}
      {...componentMark("AttachmentChip")}
    >
      {onOpen === undefined
        ? <span className={styles.label}>{body}</span>
        : (
          <button type="button" className={styles.label} onClick={onOpen}>
            {body}
          </button>
        )}
      {onRemove === undefined
        ? null
        : <Remove label={removeLabel} onRemove={onRemove} badge={false} />}
    </span>
  );
}

export interface AttachmentTileProps {
  // 그림 주소(blob·data URL).
  src: string;
  alt: string;
  // 주면 그림을 눌러 크게 본다.
  onOpen?: () => void;
  // 그림 단추의 이름. wording key 문구를 준다.
  openLabel?: string;
  onRemove?: () => void;
  removeLabel?: string;
}

// 보낼 말에 붙인 이미지 하나. 작은 정사각 그림이고 [x]가 오른쪽 위 모서리에 걸친다.
export function AttachmentTile(
  { src, alt, onOpen, openLabel, onRemove, removeLabel = "" }:
    AttachmentTileProps,
) {
  return (
    <span className={styles.tile} {...componentMark("AttachmentTile")}>
      {onOpen === undefined
        ? <img className={styles.image} src={src} alt={alt} />
        : (
          <button
            type="button"
            className={styles.open}
            aria-label={openLabel ?? alt}
            onClick={onOpen}
          >
            <img className={styles.image} src={src} alt={alt} />
          </button>
        )}
      {onRemove === undefined
        ? null
        : <Remove label={removeLabel} onRemove={onRemove} badge />}
    </span>
  );
}
