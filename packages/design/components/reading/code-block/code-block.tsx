import { t } from "@lophn/wording";
import { type CSSProperties, Fragment, useEffect, useState } from "react";
import { CopyButton } from "../../primitives/copy-button/copy-button.tsx";
import { type Clipboard, systemClipboard } from "../../_shared/shared.ts";
import styles from "../reading.module.css";
import {
  type CodeLine,
  type CodeToken,
  useHighlighter,
} from "./highlighter.ts";

export interface CodeBlockProps {
  code: string;
  // fence info의 첫 낱말(언어 이름). 글로만 보이고 해석하지 않는다.
  language?: string;
  clipboard?: Clipboard;
}

interface Highlighted {
  readonly code: string;
  readonly lines: readonly CodeLine[];
}

function tokenStyle(token: CodeToken): CSSProperties {
  const style: CSSProperties = {};
  if (token.color !== undefined) style.color = token.color;
  if (token.italic) style.fontStyle = "italic";
  if (token.bold) style.fontWeight = "var(--font-weight-semibold)";
  if (token.underline) style.textDecoration = "underline";
  return style;
}

// 받은 결과가 지금 code의 앞부분이면 그만큼만 색을 칠하고 나머지는 plain으로 붙인다.
// streaming 중 새 결과가 올 때까지 plain으로 돌아가 깜빡이지 않는다.
function CodeText(
  { code, highlighted }: {
    code: string;
    highlighted: Highlighted | null;
  },
) {
  if (highlighted === null || !code.startsWith(highlighted.code)) {
    return <>{code}</>;
  }
  return (
    <>
      {highlighted.lines.map((line, index) => (
        <Fragment key={index}>
          {index === 0 ? null : "\n"}
          {line.map((token, at) => (
            <span key={at} style={tokenStyle(token)}>{token.text}</span>
          ))}
        </Fragment>
      ))}
      {code.slice(highlighted.code.length)}
    </>
  );
}

// code는 React 글과 span으로만 넣어 실행하지 않는다.
export function CodeBlock(
  { code, language, clipboard = systemClipboard }: CodeBlockProps,
) {
  const highlighter = useHighlighter();
  const [highlighted, setHighlighted] = useState<Highlighted | null>(null);
  useEffect(() => {
    if (highlighter === null || language === undefined) return;
    let live = true;
    highlighter.highlight(code, language).then(
      (lines) => {
        if (live) setHighlighted(lines === null ? null : { code, lines });
      },
      () => {
        if (live) setHighlighted(null);
      },
    );
    return () => {
      live = false;
    };
  }, [highlighter, code, language]);
  return (
    <figure className={styles.codeBlock}>
      <div className={styles.codeHead}>
        <span className={styles.language}>{language}</span>
        <CopyButton
          text={code}
          label={t("common.button.copy-code")}
          clipboard={clipboard}
        />
      </div>
      <pre className={styles.pre}>
        <code>
          <CodeText
            code={code}
            highlighted={highlighter === null || language === undefined
              ? null
              : highlighted}
          />
        </code>
      </pre>
    </figure>
  );
}
