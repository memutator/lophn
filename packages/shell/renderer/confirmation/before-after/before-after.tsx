import type { ReactNode } from "react";
import { t } from "@lophn/wording";
import { DiffMark } from "@lophn/design/components";

import type { Change, TextBlock } from "../display.ts";
import styles from "./before-after.module.css";

export interface BeforeAfterProps {
  change: Change | undefined;
}

// 현재·바뀐 뒤를 세로로 둔다. 색 없이 +/−·글로 구별한다.
export function BeforeAfter({ change }: BeforeAfterProps) {
  if (change === undefined) {
    return (
      <p className={styles.note} data-change="missing">
        {t("confirmation-window.change.missing")}
      </p>
    );
  }
  if (change.kind === "document") return <DocumentChange change={change} />;
  if (change.kind === "setting") return <SettingChange change={change} />;
  return (
    <div className={styles.stack} data-change="description">
      <Side heading={t("confirmation-window.label.current")}>
        <Plain value={change.before} />
      </Side>
      <Side heading={t("confirmation-window.label.next")}>
        <Plain value={change.after} />
      </Side>
    </div>
  );
}

function DocumentChange(
  { change }: { change: Extract<Change, { kind: "document" }> },
) {
  return (
    <div data-change="document">
      <div className={styles.stack}>
        <Side heading={t("confirmation-window.label.current")}>
          <Blocks blocks={change.before} side="before" />
        </Side>
        <Side heading={t("confirmation-window.label.next")}>
          <Blocks blocks={change.after} side="after" />
        </Side>
      </div>
      {change.omitted !== undefined
        ? (
          <p className={styles.note} data-change="omitted">
            {t("confirmation-window.change.omitted")}
          </p>
        )
        : null}
      {change.full !== undefined
        ? (
          <details className={styles.full}>
            <summary>{t("confirmation-window.label.full")}</summary>
            <pre className={styles.pre}>
              {change.full.map((line, index) => (
                <span key={index} className={styles.fullLine} data-diff={line.kind}>
                  {line.kind === "same"
                    ? <span className={styles.gap}> </span>
                    : <DiffMark kind={line.kind} />}
                  {line.text}
                  {"\n"}
                </span>
              ))}
            </pre>
          </details>
        )
        : null}
    </div>
  );
}

function Blocks(
  { blocks, side }: { blocks: readonly TextBlock[]; side: "before" | "after" },
) {
  if (blocks.length === 0) return <Plain value={null} />;
  return (
    <>
      {blocks.map((block, index) => (
        <p
          key={index}
          className={styles.block}
          data-role={block.role}
          data-side={side}
        >
          {block.lines.map((line, lineIndex) => (
            <span key={lineIndex} className={styles.line}>
              {block.role === "changed"
                ? <DiffMark kind={side === "before" ? "delete" : "add"} />
                : <span className={styles.gap}></span>}
              {(line.spans ?? [{ text: line.text }]).map((span, part) =>
                span.changed
                  ? <mark key={part}>{span.text}</mark>
                  : <span key={part}>{span.text}</span>
              )}
            </span>
          ))}
        </p>
      ))}
    </>
  );
}

function SettingChange(
  { change }: { change: Extract<Change, { kind: "setting" }> },
) {
  return (
    <dl className={styles.settings} data-change="setting">
      {change.items.map((item) => (
        <div key={item.label} className={styles.item}>
          <dt>{item.label}</dt>
          <dd>
            <span data-side="before">
              {item.before ?? t("confirmation-window.change.none")}
            </span>
            <span aria-hidden="true" className={styles.arrow}>→</span>
            <span data-side="after">
              {item.after ?? t("confirmation-window.change.none")}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Side(
  { heading, children }: { heading: string; children: ReactNode },
) {
  return (
    <section className={styles.side}>
      <h3 className={styles.sideHeading}>{heading}</h3>
      {children}
    </section>
  );
}

function Plain({ value }: { value: string | null }) {
  if (value === null || value === "") {
    return (
      <p className={styles.note}>{t("confirmation-window.change.none")}</p>
    );
  }
  return <p className={styles.plain}>{value}</p>;
}
