// 파일 탭 본문. 탭 key는 파일 경로이고 확장자로 viewer를 고른다: md는 live preview 편집기, JSON·
// YAML·코드 같은 text는 CodeMirror 편집기, 이미지와 pdf는 보기만 한다. 파일은 shell main이
// 디스크에서 직접 읽고 쓴다(project 밖 파일도 같다).

import { fileKindOf } from "./model.ts";
import { MediaFileView } from "./media-file-view.tsx";
import type { ReadingWidthStore } from "./reading-width.ts";
import type { EditorSessions } from "./sessions.ts";
import { TextFileView } from "./text-file-view.tsx";
import type { InfoTabId } from "./info-panel/info-panel.tsx";

/** 탭 tooltip에 쓰는 파일 정보. */
interface DocumentTabMeta {
  readonly fileName: string;
  readonly title: string;
  readonly path: string | null;
  readonly version?: string;
}

/** 파일 탭이 쓰는 통로. 창마다 entry가 만들어 넘긴다. */
export interface EditorDeps {
  /** 창의 편집 session 묶음. 파일 읽기·쓰기·watch 통로(`sessions.files`)를 가진다. */
  readonly sessions: EditorSessions;
  readonly readingWidth: ReadingWidthStore;
}

export interface DocumentViewProps extends EditorDeps {
  /** 파일의 절대 경로. */
  path: string;
  /** project에 연결한 폴더 밖의 파일인가. */
  outside?: boolean;
  /** 검색 결과로 열린 줄(1부터). */
  line?: number;
  /** 같은 줄을 다시 열 때 바뀐다. 줄로 다시 scroll한다. */
  lineNonce?: number;
  /** 지우기. 지웠으면 true, 못 지웠으면 false다. 탭을 닫는 일은 부른 쪽이 한다. */
  onDelete: () => Promise<boolean>;
  onMeta?: (meta: DocumentTabMeta) => void;
  /** 처음부터 열어 둘 정보 panel 탭. */
  initialInfo?: InfoTabId;
  /** 저장해 둔 읽던 위치. scroll이 잡힐 때까지 다시 적용한다. */
  initialPosition?: {
    readonly section: string;
    readonly scroll_offset: number;
  };
  /** 읽던 위치. 0은 저장 위치를 적용하기 전에는 올리지 않는다. */
  onReadPosition?: (
    position: { section: string; scroll_offset: number },
  ) => void;
  now?: () => number;
}

export function DocumentView(props: DocumentViewProps) {
  const kind = fileKindOf(props.path);
  return kind === "image" || kind === "pdf"
    ? <MediaFileView {...props} />
    : <TextFileView {...props} />;
}
