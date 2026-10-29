const FOCUSABLE = 'textarea, input, [contenteditable="true"], [tabindex="0"]';

/**
 * 키로 칸이나 탭을 옮긴 뒤 그 칸 본문의 입력 자리로 focus를 옮긴다. 이미 본문 안에 focus가
 * 있으면 두고, 입력 자리가 없으면 아무것도 하지 않는다. 화면이 바뀐 다음 프레임에 한다.
 */
export function focusPaneBody(pane: number): void {
  requestAnimationFrame(() => {
    const body = document.querySelector(
      `[data-pane="${pane}"] [data-pane-body]`,
    );
    if (body === null || body.contains(document.activeElement)) return;
    const target = [...body.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
      (element) => element.closest("[hidden]") === null,
    );
    target?.focus();
  });
}
