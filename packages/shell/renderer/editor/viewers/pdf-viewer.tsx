// pdf viewer. 보기만 한다. 바이트는 호출자가 blob URL로 만들어 넘기고 창의 pdf 보기에 맡긴다.
import styles from "./media.module.css";

interface PdfViewerProps {
  url: string;
  label: string;
}

export function PdfViewer({ url, label }: PdfViewerProps) {
  return (
    <div className={styles.media} data-pdf-viewer="">
      <embed
        className={styles.pdf}
        src={url}
        type="application/pdf"
        aria-label={label}
      />
    </div>
  );
}
