// 편집기 밖 test가 CodeMirror를 직접 import하지 않고 글을 넣는 자리(boundary_test: @codemirror는 editor 폴더만).
import { EditorView } from "@codemirror/view";

/** `.cm-editor` 안 편집기 끝에 글을 덧붙인다. 호출하는 쪽이 act로 감싼다. */
export function appendText(editorDom: Element, text: string): void {
  const editor = EditorView.findFromDOM(editorDom as HTMLElement)!;
  editor.dispatch({ changes: { from: editor.state.doc.length, insert: text } });
}
