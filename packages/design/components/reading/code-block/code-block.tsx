import { t } from "@lophn/wording";
import { CopyButton } from "../../primitives/copy-button/copy-button.tsx";
import { type Clipboard, systemClipboard } from "../../_shared/shared.ts";
import styles from "../reading.module.css";

export interface CodeBlockProps {
  code: string;
  // fence info의 첫 낱말(언어 이름). 글로만 보이고 해석하지 않는다.
  language?: string;
  clipboard?: Clipboard;
}

// code는 React 글로만 넣어 실행하지 않는다.
export function CodeBlock(
  { code, language, clipboard = systemClipboard }: CodeBlockProps,
) {
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
      <pre className={styles.pre}><code>{code}</code></pre>
    </figure>
  );
}
