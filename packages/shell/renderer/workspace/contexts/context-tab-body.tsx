// Context 탭의 본문: 머리와 하위 탭은 ContextFrame이, 하위 탭 본문 다섯은 여기서 이어 붙인다
// (shell/workspace#R17~R22). 만드는 중인 context는 ContextFrame이 ContextDrafting으로 그린다(R30).
import type { ReactNode } from "react";

import { newId } from "../../desktop/lophn-space/model.ts";
import { ContextComposition } from "./context-composition.tsx";
import { ContextFrame } from "./context-frame.tsx";
import { ContextGlossary } from "./context-glossary.tsx";
import { ContextOverview } from "./context-overview.tsx";
import { ContextSearchList } from "./context-search-list.tsx";
import { ContextViolations } from "./context-violations.tsx";
import { ContractDetails } from "./contract-details.tsx";
import type { SearchTabState } from "./search-tab.tsx";
import type { OpenDocument, SubTab } from "./shared.ts";
import type { ContextsSource } from "./source.ts";

export interface ContextTabBodyProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
  readonly sub: SubTab;
  readonly onSub: (sub: SubTab) => void;
  readonly onOpenDocument: OpenDocument;
  /** Search 하위 탭에서 고른 검색이나 보기를 그 Search 탭에서 연다(R22). */
  readonly onOpenSearch: (state: SearchTabState) => void;
  /** [Ask Context Engineer]와 [History]. */
  readonly onAsk: () => void;
  /** 작업대 watch가 알리는 이 context의 읽을 거리 표(drafting에서 active로 넘어가는 것을 따른다). */
  readonly stamp?: string;
}

export function ContextTabBody(props: ContextTabBodyProps): ReactNode {
  const { source, context, onSub, onOpenDocument, onOpenSearch, onAsk } = props;
  const panel = (sub: SubTab): ReactNode => {
    switch (sub) {
      case "overview":
        return (
          <>
            <ContextOverview
              source={source}
              context={context}
              onOpenDocument={onOpenDocument}
              onSeeAll={() => onSub("search")}
            />
            <ContextComposition source={source} context={context} />
          </>
        );
      case "search":
        return (
          <ContextSearchList
            source={source}
            context={context}
            onOpenSearch={onOpenSearch}
            onAsk={onAsk}
          />
        );
      case "violations":
        return (
          <ContextViolations
            source={source}
            context={context}
            onOpenDocument={onOpenDocument}
          />
        );
      case "glossary":
        return (
          <ContextGlossary
            source={source}
            context={context}
            newId={() => newId("trm")}
          />
        );
      case "contract":
        return <ContractDetails source={source} context={context} />;
    }
  };
  return (
    <ContextFrame
      source={source}
      context={context}
      sub={props.sub}
      onSub={onSub}
      renderPanel={panel}
      onAsk={onAsk}
      onHistory={onAsk}
      stamp={props.stamp}
    />
  );
}
