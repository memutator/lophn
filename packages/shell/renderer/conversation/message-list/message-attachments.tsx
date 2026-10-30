// 내 말 bubble 안의 첨부. 글 끝의 첨부 줄을 떼어 이미지는 그림으로, 파일은 chip으로 글 위에 보인다. 그림을
// 누르면 크게 보고 chip을 누르면 파일을 연다.
import { type ReactElement, useEffect, useState } from "react";
import { FileIcon } from "@lophn/ui/primitives";
import { AttachmentChip } from "@lophn/ui/input";
import { ImagePreview } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import styles from "./message-body.module.css";

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export function MessageAttachments({
  files,
  images,
  imageUrl,
  onOpenFile,
}: {
  files: readonly string[];
  images: readonly string[];
  imageUrl: ((id: string) => Promise<string | null>) | undefined;
  onOpenFile: ((path: string) => void) | undefined;
}): ReactElement | null {
  const [preview, setPreview] = useState<string | null>(null);
  if (files.length === 0 && images.length === 0) return null;
  return (
    <div className={styles.attachments} data-message-attachments="">
      {images.map((id) => (
        <MessageImage
          key={id}
          id={id}
          imageUrl={imageUrl}
          onOpen={setPreview}
        />
      ))}
      {files.map((path) => (
        <AttachmentChip
          key={path}
          name={nameOf(path)}
          icon={<FileIcon name={nameOf(path)} size={16} />}
          path={path}
          {...(onOpenFile === undefined
            ? {}
            : { onOpen: () => onOpenFile(path) })}
        />
      ))}
      <ImagePreview
        src={preview}
        alt={t("conversation.label.attached-image")}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}

function MessageImage({
  id,
  imageUrl,
  onOpen,
}: {
  id: string;
  imageUrl: ((id: string) => Promise<string | null>) | undefined;
  onOpen: (url: string) => void;
}): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void imageUrl?.(id).then((found) => {
      if (live) setUrl(found);
    });
    return () => {
      live = false;
    };
  }, [id, imageUrl]);
  if (url === null) {
    return <span className={styles.imagePending} data-attached-image={id} />;
  }
  return (
    <button
      type="button"
      className={styles.imageButton}
      aria-label={t("conversation.label.attached-image")}
      data-attached-image={id}
      onClick={() => onOpen(url)}
    >
      <img className={styles.image} src={url} alt="" />
    </button>
  );
}
