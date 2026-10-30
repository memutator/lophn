import { useSyncExternalStore } from "react";
import { type Translate, translator } from "@lophn/i18n";

// lophn이 앱 view 문서의 `<html data-lophn-locale>`에 lophn 화면의 언어를 적는다(shell main의 appearance
// wiring, 문서를 읽을 때마다). 앱 view 밖이거나 아직 적히기 전이면 en이다.
export const LOCALE_ATTRIBUTE = "data-lophn-locale";
const FALLBACK = "en";

function current(): string {
  return (
    globalThis.document?.documentElement.getAttribute(LOCALE_ATTRIBUTE) ??
    FALLBACK
  );
}

function subscribe(changed: () => void): () => void {
  const root = globalThis.document?.documentElement;
  if (root === undefined) return () => {};
  const observer = new MutationObserver(changed);
  observer.observe(root, { attributeFilter: [LOCALE_ATTRIBUTE] });
  return () => observer.disconnect();
}

/** lophn 화면 언어의 `t`. 값이 바뀌면 다시 그린다. */
export function useLophnT(): Translate {
  const locale = useSyncExternalStore(subscribe, current, () => FALLBACK);
  return translator(locale);
}
