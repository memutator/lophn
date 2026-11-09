// 메시지의 첨부. image block은 그림으로, resource_link block은 chip으로 글 위에 보인다. 그림을 누르면 크게 보고
// `file://` chip을 누르면 파일을 연다. 그림 file을 가리킨 `file://` 링크(harness GUI가 붙인 이미지)는 `imageUrl`이
// 읽으면 그림으로 보이고, 못 읽으면 chip으로 남는다.
import { type ReactElement, useEffect, useState } from "react";
import { FileIcon } from "@lophn/ui/primitives";
import { AttachmentChip } from "@lophn/ui/input";
import { ImagePreview } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { pathOfUri } from "../attachments.ts";
import styles from "./message-body.module.css";

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;

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
        const chip = (
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
        return path !== null && IMAGE_FILE.test(path) ? (
          <MessageImage
            key={`${index}:${link.uri}`}
            id={link.uri}
            imageUrl={imageUrl}
            onOpen={setPreview}
            fallback={chip}
          />
        ) : (
          chip
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
  fallback,
}: {
  id: string;
  imageUrl: ((id: string) => Promise<string | null>) | undefined;
  onOpen: (url: string) => void;
  /** 읽는 동안과 못 읽었을 때 보일 것. 없으면 빈 자리다. */
  fallback?: ReactElement;
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
    if (fallback !== undefined) return fallback;
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
