import { t } from "@lophn/i18n";
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { type Clipboard, systemClipboard } from "../../_shared/shared.ts";
import { CopyButton } from "../../primitives/copy-button/copy-button.tsx";
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
  // 복사 단추 앞에 둘 단추(대화의 실행 단추). 호출자가 그린다.
  action?: ReactNode;
}

// code가 이만큼 가만히 있으면 다 쓴 것으로 보고 마지막 줄까지 칠한다.
const SETTLE_MS = 250;

interface Highlighted {
  // lines가 덮는 앞부분. 마지막 줄을 뺀 결과면 code 전체가 아니다.
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
function CodeText({
  code,
  highlighted,
}: {
  code: string;
  highlighted: Highlighted | null;
}) {
  if (highlighted === null || !code.startsWith(highlighted.code)) {
    return <>{code}</>;
  }
  return (
    <>
      {highlighted.lines.map((line, index) => (
        <Fragment key={index}>
          {index === 0 ? null : "\n"}
          {line.map((token, at) => (
            <span key={at} style={tokenStyle(token)}>
              {token.text}
            </span>
          ))}
        </Fragment>
      ))}
      {code.slice(highlighted.code.length)}
    </>
  );
}

// code는 React 글과 span으로만 넣어 실행하지 않는다.
export function CodeBlock({
  code,
  language,
  clipboard = systemClipboard,
  action,
}: CodeBlockProps) {
  const highlighter = useHighlighter();
  const [highlighted, setHighlighted] = useState<Highlighted | null>(null);
  // code가 자라는 동안에는 앞서 보낸 요청의 답도 쓴다. 늦게 온 답도 지금 code의 앞부분이면 칠할 수 있다.
  // highlighter나 language가 바뀌거나 unmount하면 앞선 답은 버린다.
  const generation = useRef(0);
  // 같은 block이 자라는 동안 worker가 앞 줄의 grammar state를 이어 쓰게 하는 key.
  const key = useId();
  // 이 CodeBlock이 마지막으로 칠하자고 한 code. 처음이 아니고 code가 바뀌면 자라는 중으로 본다.
  const seen = useRef<string | null>(null);
  useEffect(() => {
    generation.current += 1;
    seen.current = null;
    return () => {
      generation.current += 1;
    };
  }, [highlighter, language]);
  useEffect(() => {
    if (highlighter === null || language === undefined) return;
    const asked = generation.current;
    const growing = seen.current !== null && seen.current !== code;
    seen.current = code;
    const ask = (partial: boolean) => {
      highlighter.highlight(code, language, { key, partial }).then(
        (lines) => {
          if (generation.current !== asked) return;
          if (lines === null) {
            setHighlighted(null);
            return;
          }
          // 마지막 줄을 뺀 결과는 code의 마지막 "\n" 앞까지를 덮는다.
          setHighlighted({
            code: partial
              ? code.slice(0, Math.max(0, code.lastIndexOf("\n")))
              : code,
            lines,
          });
        },
        () => {
          if (generation.current !== asked) return;
          setHighlighted(null);
        },
      );
    };
    // 처음 칠하는 code는 바로 끝까지 칠한다. 자라는 중이면 끝난 줄만 이어 칠하고, 멈추면 마지막 줄을 마저 칠한다.
    ask(growing);
    if (!growing) return;
    const timer = setTimeout(() => ask(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [highlighter, code, language, key]);
  // 언어도 action도 없으면 머리 줄에 복사 단추만 혼자 서므로 줄을 없애고 단추를 오른쪽 위에 겹친다.
  const headless = language === undefined && action === undefined;
  const actions = (
    <span
      className={styles.codeActions}
      data-floating={headless ? "" : undefined}
    >
      {action}
      <CopyButton
        text={code}
        label={t("common.button.copy-code")}
        clipboard={clipboard}
      />
    </span>
  );
  return (
    <figure
      className={styles.codeBlock}
      data-headless={headless ? "" : undefined}
    >
      {headless ? (
        actions
      ) : (
        <div className={styles.codeHead}>
          <span className={styles.language}>{language}</span>
          {actions}
        </div>
      )}
      <pre className={styles.pre}>
        <code>
          <CodeText
            code={code}
            highlighted={
              highlighter === null || language === undefined
                ? null
                : highlighted
            }
          />
        </code>
      </pre>
    </figure>
  );
}
