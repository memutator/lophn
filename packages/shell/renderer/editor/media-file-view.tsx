// 이미지·pdf 탭. 보기만 한다. 바이트는 shell main이 읽어 주고 blob URL로 그린다. 저장 상태도
// 편집 단추도 없다.
import { useEffect, useState } from "react";
import { ErrorState, Skeleton } from "@lophn/ui/feedback";
import { t } from "@lophn/wording";

import type { DocumentViewProps } from "./document-view.tsx";
import { FileFrame, FileStatus } from "./file-frame.tsx";
import { fileKindOf, fileNameOf, formatSize } from "./model.ts";
import { useMediaFile } from "./use-file.ts";
import { ImageViewer } from "./viewers/image-viewer.tsx";
import { PdfViewer } from "./viewers/pdf-viewer.tsx";
import { failureText } from "./text-file-view.tsx";

export function MediaFileView(props: DocumentViewProps) {
  const { path, sessions, outside = false, line, onMeta, onDelete } = props;
  const kind = fileKindOf(path) === "pdf" ? "pdf" : "image";
  const [attempt, setAttempt] = useState(0);
  const [dimensions, setDimensions] = useState<string | null>(null);
  const file = useMediaFile(sessions, path, attempt);
  useEffect(() => {
    onMeta?.({ fileName: fileNameOf(path), title: fileNameOf(path), path });
  }, [path]);

  if (file.kind === "loading") {
    return (
      <FileStatus>
        <Skeleton shape="line" lines={6} />
      </FileStatus>
    );
  }
  if (file.kind === "failed") {
    const message = failureText(file.code);
    return (
      <FileStatus>
        {message === null
          ? (
            <ErrorState
              target={t("document.label.this-document")}
              onRetry={() => setAttempt((value) => value + 1)}
            />
          )
          : <p role="status">{message}</p>}
      </FileStatus>
    );
  }
  const label = fileNameOf(path);
  const size = formatSize(file.size);
  return (
    <FileFrame
      path={path}
      kind={kind}
      outside={outside}
      meta={kind === "image" && dimensions !== null
        ? `${dimensions} · ${size}`
        : size}
      line={line}
      state={null}
      info={{
        size: file.size,
        outline: null,
        onJump: () => {},
        now: props.now,
      }}
      initialInfo={props.initialInfo}
      onDelete={onDelete}
    >
      {kind === "image"
        ? (
          <ImageViewer
            url={file.url}
            label={label}
            onSize={({ width, height }) =>
              setDimensions(`${width} × ${height}`)}
          />
        )
        : <PdfViewer url={file.url} label={label} />}
    </FileFrame>
  );
}
