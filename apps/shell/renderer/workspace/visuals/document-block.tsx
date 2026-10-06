// 고정 문서 참조. 블록 출처의 문서 판과 문서로 남긴 뒤의 고정 문서 링크를 같은 모양으로 보인다
// (shell/workspace#R13). 누르면 host가 그 판을 연다: 실행 가능한 문서 format은 격리 문서 view
// (shell#T33)로, 그 밖은 읽기 화면으로 연다. 이름은 문서 read로 따로 읽고, 읽지 못하면 열 수 없는
// 문서로 두며 다른 문서나 최신 판으로 바꾸지 않는다.
import { useEffect, useState } from "react";
import { conversationIcons, Icon, iconPixels } from "@lophn/design/components";
import { t } from "@lophn/wording";

import styles from "./visuals.module.css";

export type TitleRead =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly code: string };

export interface DocumentLinkProps {
  document: string;
  /** 고정 판. null이면 문서의 현재 판이다(결과 링크가 문서만 가리킬 때). */
  version: string | null;
  /** 출처가 가리키는 절. 글로만 보인다. */
  section?: string | null;
  documentTitle: (document: string) => Promise<TitleRead>;
  onOpen?: (document: string, version: string | null) => void;
}

type Title =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly title: string }
  | { readonly state: "unavailable" };

// 결과를 모르는 실패(unavailable·통로)는 이름만 기본값으로 두고 열기는 막지 않는다.
// not_found·forbidden은 지금 열 수 없는 문서다.
const CLOSED = new Set(["not_found", "forbidden", "unauthorized"]);

export function DocumentLink(
  { document, version, section = null, documentTitle, onOpen }:
    DocumentLinkProps,
) {
  const [title, setTitle] = useState<Title>({ state: "loading" });
  useEffect(() => {
    let live = true;
    void documentTitle(document).then((read) => {
      if (!live) return;
      setTitle(
        read.ok
          ? { state: "ready", title: read.value }
          : CLOSED.has(read.code)
          ? { state: "unavailable" }
          : { state: "loading" },
      );
    });
    return () => {
      live = false;
    };
  }, [document, documentTitle]);

  const closed = title.state === "unavailable";
  const name = title.state === "ready"
    ? title.title
    : closed
    ? t("conversation.label.visual-document-unavailable")
    : t("conversation.label.document");
  return (
    <button
      type="button"
      className={styles.document}
      data-visual-document={version === null
        ? document
        : `${document}@${version}`}
      data-unavailable={closed || undefined}
      disabled={closed || onOpen === undefined}
      onClick={() => onOpen?.(document, version)}
    >
      <Icon icon={conversationIcons.result} pixels={iconPixels("base")} />
      <span className={styles.documentTitle}>{name}</span>
      {section === null
        ? null
        : <span className={styles.documentSection}>{section}</span>}
    </button>
  );
}
