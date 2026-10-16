// 이미지 viewer. 보기만 한다. 바이트는 호출자가 blob URL로 만들어 넘긴다. 바탕은 탭 본문과 같다.
import styles from "./media.module.css";

interface ImageViewerProps {
  url: string;
  label: string;
  /** 그림을 읽으면 크기를 알린다. */
  onSize?: (size: { width: number; height: number }) => void;
}

export function ImageViewer({ url, label, onSize }: ImageViewerProps) {
  return (
    <div className={styles.media} data-image-viewer="">
      <div className={styles.stage}>
        <img
          src={url}
          alt={label}
          onLoad={(event) =>
            onSize?.({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })}
        />
      </div>
    </div>
  );
}
