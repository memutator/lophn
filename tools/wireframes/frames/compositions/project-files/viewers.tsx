// 확장자로 고르는 viewer들. text는 열고 고치는 편집기, 이미지와 pdf는 보기만 한다. md는 documents.tsx의 편집기가 맡는다.
import { type ReactNode, useEffect, useRef } from "react";

import { textOf } from "./file-data.ts";
import styles from "./files.module.css";

// JSON·YAML의 key, 문자열, 숫자만 아주 단순하게 칠한다.
function colored(line: string): ReactNode {
  const parts: ReactNode[] = [];
  const pattern =
    /("(?:[^"\\]|\\.)*")(\s*:)?|(\b[\w./-]+)(?=\s*:)|(\b\d+(?:\.\d+)?\b)/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(line.slice(last, at));
    if (match[1] !== undefined) {
      parts.push(
        <span key={at} className={match[2] ? styles.tkKey : styles.tkStr}>
          {match[1]}
        </span>,
        match[2] ?? "",
      );
    } else if (match[3] !== undefined) {
      parts.push(
        <span key={at} className={styles.tkKey}>{match[3]}</span>,
      );
    } else {
      parts.push(<span key={at} className={styles.tkNum}>{match[4]}</span>);
    }
    last = at + match[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

/** text 편집기. 줄 번호 gutter와 지금 줄 표시가 있고 형식 문제 표시는 없다. `line`이면 그 줄로 scroll해 칠한다. */
export function TextEditor(
  { path, line, caret = 1 }: {
    path: string;
    /** 검색 결과로 열린 줄. */
    line?: number;
    /** 커서가 있는 줄. */
    caret?: number;
  },
) {
  const lines = textOf(path);
  const hit = useRef<HTMLDivElement>(null);
  useEffect(() => {
    hit.current?.scrollIntoView({ block: "center" });
  }, [line]);
  return (
    <div className={styles.editor} role="textbox" aria-label={path}>
      {lines.map((text, index) => {
        const number = index + 1;
        const cls = number === line
          ? styles.hitLine
          : number === caret && line === undefined
          ? styles.activeLine
          : "";
        return (
          <div
            key={number}
            ref={number === line ? hit : undefined}
            className={`${styles.codeRow} ${cls}`}
          >
            <span className={styles.lineNo}>{number}</span>
            <span className={styles.codeText}>
              {colored(text)}
              {number === caret && line === undefined
                ? <span className={styles.caret} />
                : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 이미지 viewer. 보기만 한다. 크기 같은 정보는 view bar 한 줄에 있다. 그림은 chest 배치도 stand-in이다. */
export function ImageViewer({ path: _path }: { path: string }) {
  return (
    <div className={styles.media}>
      <div className={styles.mediaStage}>
        <svg
          viewBox="0 0 320 180"
          role="img"
          aria-label="Chest layout"
          width="640"
        >
          <rect width="320" height="180" fill="#eef1f4" />
          <path
            d="M0 20H320M0 40H320M0 60H320M0 80H320M0 100H320M0 120H320M0 140H320M0 160H320M20 0V180M40 0V180M60 0V180M80 0V180M100 0V180M120 0V180M140 0V180M160 0V180M180 0V180M200 0V180M220 0V180M240 0V180M260 0V180M280 0V180M300 0V180"
            stroke="#d4dae0"
            strokeWidth="0.5"
          />
          <rect x="40" y="40" width="60" height="40" fill="#b9d3ee" />
          <rect x="120" y="100" width="40" height="40" fill="#f6d77a" />
          <rect x="200" y="60" width="80" height="60" fill="#9fc7a6" />
          <circle cx="70" cy="130" r="12" fill="#5f8f6a" />
          <text x="44" y="64" fontSize="10" fill="#33414d">door</text>
          <text x="124" y="124" fontSize="10" fill="#33414d">chest</text>
          <text x="204" y="94" fontSize="10" fill="#33414d">storage</text>
        </svg>
      </div>
    </div>
  );
}

/** pdf viewer. 보기만 한다. 쪽은 글 줄 모양의 stand-in이다. */
export function PdfViewer({ path: _path }: { path: string }) {
  const widths = [96, 100, 88, 100, 72, 94, 100, 64];
  return (
    <div className={styles.media}>
      <div className={styles.pdfStage}>
        {[1, 2].map((page) => (
          <div
            key={page}
            className={styles.pdfPage}
            aria-label={`Page ${page}`}
          >
            <h3 className={styles.pdfTitle}>
              {page === 1 ? "Weekly report 12" : "Findings"}
            </h3>
            {widths.map((width, index) => (
              <div
                key={index}
                className={styles.pdfBar}
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
