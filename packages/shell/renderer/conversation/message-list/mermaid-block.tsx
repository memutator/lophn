// 대화의 mermaid fence. mermaid는 큰 library라 처음 diagram을 그릴 때 dynamic import로 가져온다.
// shell CSP(`style-src 'self'`)는 mermaid가 SVG 안에 넣는 inline <style>을 막으므로, 그 글을
// constructable stylesheet로 옮겨 붙인다(editor/adopt-styles.ts와 같은 방식). mermaid style은 자기
// SVG id 아래로만 걸리므로 문서에 붙여도 다른 글은 건드리지 않는다.
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import type mermaidType from "mermaid";
import { CopyButton, IconButton } from "@lophn/ui/primitives";
import { systemClipboard } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import { conversationIcons } from "../../icons/mod.ts";
import styles from "./mermaid-block.module.css";

type Mermaid = typeof mermaidType;

let pending: Promise<Mermaid> | null = null;
let diagramId = 0;

// 한 번만 읽고 모든 diagram이 같은 promise를 쓴다. 읽지 못하면 다음 diagram이 다시 시도한다.
function loadMermaid(): Promise<Mermaid> {
  pending ??= import("mermaid").then(
    (module) => module.default,
    (thrown: unknown) => {
      pending = null;
      throw thrown;
    },
  );
  return pending;
}

// container 안의 <style>을 문서 stylesheet로 옮기고 element는 지운다. 만든 sheet는 부르는 쪽이 걷는다.
function adoptStyles(container: HTMLElement, sheets: CSSStyleSheet[]): void {
  if (
    typeof CSSStyleSheet !== "function" ||
    !("adoptedStyleSheets" in document)
  )
    return;
  for (const style of container.querySelectorAll("style")) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(style.textContent ?? "");
      sheets.push(sheet);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch {
      // 읽지 못하는 규칙이면 옮기지 않는다. 그 diagram의 모양만 포기한다.
    }
    style.remove();
  }
}

export interface MermaidBlockProps {
  code: string;
}

// mermaid diagram 하나. 원문 보기로 source를 열고, 실패하면 원문과 한 줄 이유를 남긴다.
export function MermaidBlock({ code }: MermaidBlockProps): ReactElement {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [source, setSource] = useState(false);
  const view = useRef<HTMLDivElement | null>(null);
  const sheets = useRef<CSSStyleSheet[]>([]);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    loadMermaid().then(
      async (mermaid) => {
        if (!alive) return;
        diagramId += 1;
        try {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme:
              document.documentElement.dataset.theme === "dark"
                ? "dark"
                : "default",
          });
          const drawn = await mermaid.render(`mermaid-${diagramId}`, code);
          if (!alive) return;
          setSvg(drawn.svg);
        } catch {
          if (alive) setFailed(true);
        }
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [code]);

  // 그린 svg가 붙은 뒤에 그 안의 style을 옮긴다. 다시 그리거나 unmount하면 앞서 옮긴 sheet를 걷는다.
  useEffect(() => {
    const element = view.current;
    if (element === null || svg === null) return;
    adoptStyles(element, sheets.current);
    return () => {
      if (sheets.current.length === 0) return;
      const dropped = new Set(sheets.current);
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (sheet) => !dropped.has(sheet),
      );
      sheets.current = [];
    };
  }, [svg, source]);

  return (
    <figure className={styles.diagram} data-mermaid="">
      <div className={styles.head}>
        <span className={styles.language}>mermaid</span>
        <span className={styles.actions}>
          <IconButton
            icon={source ? conversationIcons.diagram : conversationIcons.code}
            size="sm"
            label={t(
              source
                ? "conversation.button.mermaid-show-diagram"
                : "conversation.button.mermaid-show-source",
            )}
            aria-pressed={source}
            onClick={() => setSource(!source)}
          />
          <CopyButton
            text={code}
            label={t("common.button.copy-code")}
            clipboard={systemClipboard}
          />
        </span>
      </div>
      {svg !== null && !source ? (
        <div
          ref={view}
          className={styles.canvas}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <pre className={styles.pre}>
          <code>{code}</code>
        </pre>
      )}
      {failed && !source ? (
        <p className={styles.failed} role="status">
          {t("conversation.notice.mermaid-failed")}
        </p>
      ) : null}
    </figure>
  );
}
