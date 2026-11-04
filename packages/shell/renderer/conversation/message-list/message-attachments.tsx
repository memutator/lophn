// 메시지의 첨부. image block은 그림으로, resource_link block은 chip으로 글 위에 보인다. 그림을 누르면 크게 보고
// `file://` chip을 누르면 파일을 연다.
import { type ReactElement, useEffect, useState } from "react";
import { FileIcon } from "@lophn/ui/primitives";
import { AttachmentChip } from "@lophn/ui/input";
import { ImagePreview } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { pathOfUri } from "../attachments.ts";
import styles from "./message-body.module.css";

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export function MessageAttachments({
  links,
  images,
  imageUrl,
  onOpenFile,
}: {
  links: readonly { uri: string; name: string }[];
  images: readonly string[];
  imageUrl: ((id: string) => Promise<string | null>) | undefined;
  onOpenFile: ((path: string) => void) | undefined;
}): ReactElement | null {
  const [preview, setPreview] = useState<string | null>(null);
  if (links.length === 0 && images.length === 0) return null;
  return (
    <div className={styles.attachments} data-message-attachments="">
      {images.map((id, index) => (
        <MessageImage
          key={`${index}:${id}`}
          id={id}
          imageUrl={imageUrl}
          onOpen={setPreview}
        />
      ))}
      {links.map((link, index) => {
        const path = pathOfUri(link.uri);
        return (
          <AttachmentChip
            key={`${index}:${link.uri}`}
            name={link.name}
            icon={
              <FileIcon
                name={path === null ? link.name : nameOf(path)}
                size={16}
              />
            }
            path={path ?? link.uri}
            {...(path === null || onOpenFile === undefined
              ? {}
              : { onOpen: () => onOpenFile(path) })}
          />
        );
      })}
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
