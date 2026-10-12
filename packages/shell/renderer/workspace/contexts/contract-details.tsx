// Contract: "Details for Context Engineer and the curious" 아래에 개체 관계 그림, 개체마다 카드
// (이름·public·kind와 경로·문서 수·field와 관계), 선언된 검색마다 이름과 예시 검사 결과.
// 판 번호·단추가 있는 머리는 ContextFrame의 몫이다.
// 값 만들기는 contract-details-model.ts, 그림 자리는 contract-details-layout.ts,
// 카드와 검색 목록은 contract-details-cards.tsx·contract-details-searches.tsx가 맡는다.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.heading.contract-fields
//   contexts.heading.contract-relations
//   contexts.heading.contract-searches
//   contexts.label.contract-diagram
//   contexts.label.contract-documents
//   contexts.label.contract-examples-fail
//   contexts.label.contract-examples-pass
//   contexts.label.contract-field-section
//   contexts.label.contract-field-values
//   contexts.label.contract-kind
//   contexts.label.contract-public
//   contexts.label.contract-relation
//   contexts.label.sub-contract (load 실패 때 대상 이름)
//   common.error.load-failed
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ErrorState, Loading, Skeleton } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { TypeCard } from "./contract-details-cards.tsx";
import { ContractDiagram } from "./contract-details-diagram.tsx";
import {
  buildContractModel,
  type ContractModel,
} from "./contract-details-model.ts";
import { DeclaredSearches } from "./contract-details-searches.tsx";
import type { ContextsSource } from "./source.ts";
import styles from "./contract-details.module.css";

export interface ContractDetailsProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
}

type Load =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "loaded"; readonly model: ContractModel | null };

export function ContractDetails(
  { source, context }: ContractDetailsProps,
): ReactNode {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setLoad({ state: "loading" });
    setAttempt((count) => count + 1);
  }, []);

  useEffect(() => {
    let current = true;
    Promise.all([
      source.overview(context),
      source.contract(context),
      source.bundles(context),
    ]).then(
      ([overview, contract, bundles]) => {
        if (!current) return;
        setLoad(
          overview.ok && contract.ok && bundles.ok
            ? {
              state: "loaded",
              // 적용된 판이 없으면 계약도 없다.
              model: contract.value.content === null
                ? null
                : buildContractModel(
                  contract.value.content,
                  overview.value.types,
                  bundles.value,
                ),
            }
            : { state: "failed" },
        );
      },
      () => {
        if (current) setLoad({ state: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [source, context, attempt]);

  return (
    <Loading
      loading={load.state === "loading"}
      placeholder={<Skeleton lines={4} />}
    >
      {load.state === "failed"
        ? (
          <ErrorState
            target={t("contexts.label.sub-contract")}
            onRetry={retry}
          />
        )
        : null}
      {load.state === "loaded" && load.model !== null
        ? <ContractView model={load.model} />
        : null}
    </Loading>
  );
}

function ContractView({ model }: { readonly model: ContractModel }): ReactNode {
  return (
    <div className={styles.contract}>
      <ContractDiagram graph={model.graph} />
      <div className={styles.cards}>
        {model.types.map((card) => <TypeCard key={card.name} card={card} />)}
      </div>
      {model.searches.length === 0
        ? null
        : <DeclaredSearches rows={model.searches} />}
    </div>
  );
}
