// shell CSP(`style-src 'self'`)는 inline <style>을 막는다. CodeMirror(style-mod)는 문서 head에
// <style> 하나를 넣고 그 글을 고쳐 쓰므로, 막힌 채 두면 편집기 기본 모양(나란한 gutter·내용,
// 줄 높이)과 live preview 장식이 모두 빠진다. 그 글을 constructable stylesheet로 옮겨 붙인다.
// 터미널(xterm-view.ts)과 같은 방식이다. 창마다 한 번만 건다.

const installed = new WeakSet<Document>();

export function adoptHeadStyles(document: Document): void {
  if (installed.has(document)) return;
  if (
    typeof MutationObserver !== "function" ||
    typeof CSSStyleSheet !== "function" ||
    !("adoptedStyleSheets" in document) || !document.head
  ) return;
  installed.add(document);
  const sheets = new Map<HTMLStyleElement, CSSStyleSheet>();
  const adopt = (element: HTMLStyleElement) => {
    let sheet = sheets.get(element);
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheets.set(element, sheet);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
    try {
      // 붙인 sheet는 문서 stylesheet 뒤에 겹쳐 같은 무게면 이긴다. 원래 <style>은 head 맨 앞이라
      // 화면 CSS가 이겼으므로, cascade layer에 넣어 화면 CSS(layer 밖)가 이기게 둔다.
      sheet.replaceSync(
        `@layer inline-styles {\n${element.textContent ?? ""}\n}`,
      );
    } catch {
      // 읽지 못하는 규칙이면 그 판은 건너뛴다. 다음 고쳐 쓰기에서 다시 옮긴다.
    }
  };
  for (const style of document.head.querySelectorAll("style")) adopt(style);
  new MutationObserver((records) => {
    for (const record of records) {
      let target: Node | null = record.target;
      while (target && !(target instanceof HTMLStyleElement)) {
        target = target.parentNode;
        if (target === document.head) target = null;
      }
      if (target instanceof HTMLStyleElement) adopt(target);
      for (const node of record.addedNodes) {
        if (node instanceof HTMLStyleElement) adopt(node);
      }
    }
  }).observe(document.head, {
    subtree: true,
    childList: true,
    characterData: true,
  });
}
