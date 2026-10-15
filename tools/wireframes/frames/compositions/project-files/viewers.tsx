// 확장자로 고르는 viewer들. text는 열고 고치는 편집기, 이미지와 pdf는 보기만 한다. md는 documents.tsx의
// 편집기가 맡는다. 모두 renderer 편집기의 viewer(`packages/shell/renderer/editor/viewers`)가 그리고, 글과
// 그림은 `editor/fake-source.ts`의 고정 data다.
import { useEffect, useRef } from "react";

import {
  FAKE_IMAGE_SVG,
  FAKE_PDF,
  fakeTextOf,
} from "../../../../../packages/shell/renderer/editor/fake-source.ts";
import { languageOf } from "../../../../../packages/shell/renderer/editor/model.ts";
import { ImageViewer as EditorImageViewer } from "../../../../../packages/shell/renderer/editor/viewers/image-viewer.tsx";
import { PdfViewer as EditorPdfViewer } from "../../../../../packages/shell/renderer/editor/viewers/pdf-viewer.tsx";
import {
  TextEditor as EditorTextEditor,
  type TextEditorHandle,
} from "../../../../../packages/shell/renderer/editor/viewers/text-editor.tsx";

/** text 편집기. 줄 번호 gutter와 지금 줄 표시가 있고 형식 문제 표시는 없다. `line`이면 그 줄로 scroll해 칠한다. */
export function TextEditor(
  { path, line }: {
    path: string;
    /** 검색 결과로 열린 줄. */
    line?: number;
    /** 커서가 있는 줄. 편집기가 커서를 정한다. */
    caret?: number;
  },
) {
  const editor = useRef<TextEditorHandle>(null);
  useEffect(() => {
    if (line !== undefined) editor.current?.revealLine(line);
  }, [line]);
  return (
    <EditorTextEditor
      ref={editor}
      initialText={fakeTextOf(path) ?? "key: value\n"}
      label={path}
      language={languageOf(path)}
    />
  );
}

/** 이미지 viewer. 보기만 한다. 크기 같은 정보는 view bar 한 줄에 있다. 그림은 chest 배치도 stand-in이다. */
export function ImageViewer({ path }: { path: string }) {
  return (
    <EditorImageViewer
      url={`data:image/svg+xml,${encodeURIComponent(FAKE_IMAGE_SVG)}`}
      label={path}
    />
  );
}

/** pdf viewer. 보기만 한다. 쪽은 한 쪽짜리 보고서 stand-in이다. */
export function PdfViewer({ path }: { path: string }) {
  return (
    <EditorPdfViewer
      url={`data:application/pdf,${encodeURIComponent(FAKE_PDF)}`}
      label={path}
    />
  );
}
