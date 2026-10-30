// composer 입력칸 안 글 위의 첨부 줄. 파일은 chip, 이미지는 tile이고 둘 다 [x]로 뗀다. tile을 누르면 크게 본다.
import { type ReactElement, useState } from "react";
import { FileIcon } from "@lophn/ui/primitives";
import { AttachmentChip, AttachmentTile } from "@lophn/ui/input";
import { ImagePreview } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import type { Attachment } from "../attachments.ts";
import styles from "./agent-composer.module.css";

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: readonly Attachment[];
  /** 없으면 뗄 수 없다(보내는 중). */
  onRemove?: (item: Attachment) => void;
}): ReactElement | null {
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(
    null,
  );
  if (attachments.length === 0) return null;
  return (
    <ul className={styles.chips} data-attachments="">
      {attachments.map((item) => {
        const name = item.kind === "file" ? nameOf(item.path) : item.name;
        const remove =
          onRemove === undefined
            ? {}
            : {
                onRemove: () => onRemove(item),
                removeLabel: t("conversation.button.remove-attachment", {
                  name,
                }),
              };
        return (
          <li key={item.kind === "file" ? item.path : item.url}>
            {item.kind === "file" ? (
              <AttachmentChip
                name={name}
                icon={<FileIcon name={name} size={16} />}
                path={item.path}
                {...remove}
              />
            ) : (
              <AttachmentTile
                src={item.url}
                alt={name}
                openLabel={t("conversation.button.preview-image", { name })}
                onOpen={() => setPreview({ src: item.url, alt: name })}
                {...remove}
              />
            )}
          </li>
        );
      })}
      <ImagePreview
        src={preview?.src ?? null}
        alt={preview?.alt ?? ""}
        onClose={() => setPreview(null)}
      />
    </ul>
  );
}
