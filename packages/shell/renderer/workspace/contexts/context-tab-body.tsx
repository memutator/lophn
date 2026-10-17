// Context 탭의 본문: 머리와 하위 탭은 ContextFrame이, 하위 탭 본문 다섯은 여기서 이어 붙인다.
import type { ReactNode } from "react";

import { newId } from "../../new-id.ts";
import { ContextFrame, type ContextFrameProps } from "./context-frame.tsx";
import { ContextGlossary } from "./context-glossary.tsx";
import { ContextOverview } from "./context-overview.tsx";
import { ContextSearchList } from "./context-search-list.tsx";
import { ContextViolations } from "./context-violations.tsx";
import { ContractDetails } from "./contract-details.tsx";
import type { SearchTabState } from "./search-tab.tsx";
import type { OpenDocument, SubTab } from "./shared.ts";
import type { ContextsSource, ViolationItem } from "./source.ts";

interface ContextTabBodyProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
  readonly sub: SubTab;
  readonly onSub: (sub: SubTab) => void;
  readonly onOpenDocument: OpenDocument;
  /** Search 하위 탭에서 고른 검색이나 보기를 그 Search 탭에서 연다. */
  readonly onOpenSearch: (state: SearchTabState) => void;
  /** Violations의 [Send to Project Manager]와 [Send all …]: 그 위반들을 chip으로 싣고 Project Manager를 연다. */
  readonly onSendViolations: (violations: readonly ViolationItem[]) => void;
  /** 읽은 context 이름. 복원한 탭이 이름을 얻는다. */
  readonly onTitle?: (title: string) => void;
  /** 탭 안 알림이 닫히기까지를 재는 timer와 "applied 2 hours ago"를 재는 지금. gallery와 시험이 세운다. */
  readonly timer?: ContextFrameProps["timer"];
  readonly now?: Date;
}

export function ContextTabBody(props: ContextTabBodyProps): ReactNode {
  const { source, context, onSub, onOpenDocument, onOpenSearch } = props;
  const panel = (sub: SubTab): ReactNode => {
    switch (sub) {
      case "overview":
        return (
          <ContextOverview
            source={source}
            context={context}
            onOpenDocument={onOpenDocument}
            onSeeAll={() => onSub("search")}
          />
        );
      case "search":
        return (
          <ContextSearchList
            source={source}
            context={context}
            onOpenSearch={onOpenSearch}
          />
        );
      case "violations":
        return (
          <ContextViolations
            source={source}
            context={context}
            onOpenDocument={onOpenDocument}
            onSend={props.onSendViolations}
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
      onTitle={props.onTitle}
      timer={props.timer}
      now={props.now}
    />
  );
}
