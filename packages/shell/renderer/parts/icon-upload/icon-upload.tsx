// icon 올리기 줄. 앱 details와 project 설정이 같이 쓴다. 왼쪽에 지금 표식, 오른쪽 끝 고정 열에
// [Upload image]와(올린 것이 있을 때) [Remove]가 있다. 파일 검사의 정본은 core이고, 여기서는 큰 파일과
// 이미지 아닌 것을 보내기 전에 걸러 같은 안내를 보인다.
import { Toast } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";
import { type ReactNode, useRef, useState } from "react";

import { ICON_MAX_BYTES, ICON_TYPES } from "../../../../protocol/base/icon.ts";
import { actionIcons } from "../../icons/mod.ts";
import styles from "./icon-upload.module.css";

export interface IconUploadProps {
  /** 지금 보이는 표식(WorkspaceMark). */
  preview: ReactNode;
  /** 보낸 결과. false면 실패 안내를 보인다. */
  onUpload(bytes: Uint8Array, type: string): Promise<boolean>;
  /** 올린 icon이 있을 때만 준다. 있으면 [Remove]가 보인다. */
  onRemove?: () => Promise<boolean>;
}

type Failure = "upload-failed" | "invalid-file" | "remove-failed";

export function IconUpload({ preview, onUpload, onRemove }: IconUploadProps) {
  const input = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const pick = async (file: File | undefined) => {
    if (input.current !== null) input.current.value = "";
    if (file === undefined) return;
    if (
      !(ICON_TYPES as readonly string[]).includes(file.type) ||
      file.size > ICON_MAX_BYTES
    ) {
      setFailure("invalid-file");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    setFailure((await onUpload(bytes, file.type)) ? null : "upload-failed");
  };

  const remove = async () => {
    if (onRemove === undefined) return;
    setFailure((await onRemove()) ? null : "remove-failed");
  };

  return (
    <div className={styles.row} data-icon-upload="">
      {failure === null ? null : (
        <div className={styles.toast}>
          <Toast
            tone="error"
            title={t(`icon-upload.error.${failure}`)}
            onClose={() => setFailure(null)}
          />
        </div>
      )}
      <span className={styles.preview}>{preview}</span>
      <span className={styles.note}>{t("icon-upload.note.limits")}</span>
      <span className={styles.action}>
        <input
          ref={input}
          className={styles.file}
          type="file"
          accept={ICON_TYPES.join(",")}
          data-icon-file=""
          tabIndex={-1}
          onChange={(event) => void pick(event.currentTarget.files?.[0])}
        />
        {onRemove === undefined ? null : (
          <Button
            size="sm"
            icon={actionIcons.remove}
            data-icon-remove=""
            onClick={() => void remove()}
          >
            {t("icon-upload.button.remove")}
          </Button>
        )}
        <Button
          size="sm"
          icon={actionIcons.upload}
          data-icon-pick=""
          onClick={() => input.current?.click()}
        >
          {t("icon-upload.button.upload")}
        </Button>
      </span>
    </div>
  );
}
