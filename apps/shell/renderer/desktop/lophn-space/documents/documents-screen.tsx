import { useEffect, useState } from "react";
import { Tab, TabList, Tabs } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { Catalog, LophnSource, SeriesMember } from "../source.ts";
import { SeriesDetailView } from "../series/series-detail.tsx";
import { SeriesPanel } from "../series/series-panel.tsx";
import { RegisterSeries } from "../series/register-form.tsx";
import { Reader, type ReaderTarget } from "./reader.tsx";
import { SearchPanel } from "./search-panel.tsx";
import { ViewsPanel } from "./views-panel.tsx";
import styles from "./documents.module.css";

export type DocumentsTab = "search" | "views" | "series";

type Detail =
  | { readonly kind: "none" }
  | { readonly kind: "reader"; readonly target: ReaderTarget }
  | { readonly kind: "series"; readonly id: string }
  | { readonly kind: "register" };

export interface DocumentsScreenProps {
  source: LophnSource;
  /** 상대 시각의 기준. 테스트가 고정한다. */
  now?: () => number;
  /** 처음 고른 탭. 테스트가 고른다. */
  initialTab?: DocumentsTab;
  /** 화면 밖(창 팔레트)에서 연 문서. 바뀔 때마다 그 문서를 상세에서 읽는다. */
  reading?: ReaderRequest;
}

/** 팔레트가 고른 문서 판. serial은 같은 문서를 다시 골라도 다시 열게 한다. */
export interface ReaderRequest {
  readonly document: string;
  readonly version: string;
  readonly serial: number;
}

const EMPTY_CATALOG: Catalog = { projects: [], apps: [], contexts: [] };

// documents 화면. 왼쪽 360px 목록 칸에서 찾고 고르며 오른쪽 상세에서 읽는다(desktop#R1).
// 검색·saved view·series가 같은 목록 칸을 나눠 쓰고 대화 없이도 문서에 닿는다.
export function DocumentsScreen(
  { source, now = Date.now, initialTab = "search", reading }:
    DocumentsScreenProps,
) {
  const [tab, setTab] = useState<DocumentsTab>(initialTab);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [formats, setFormats] = useState<readonly string[]>([]);
  const [detail, setDetail] = useState<Detail>({ kind: "none" });
  // series 목록을 다시 읽게 하는 표시. 등록·보관 뒤 올린다.
  const [seriesRevision, setSeriesRevision] = useState(0);
  // 저장한 보기 목록을 다시 읽게 하는 표시. 검색 칸에서 저장한 뒤 올린다.
  const [viewsRevision, setViewsRevision] = useState(0);

  useEffect(() => {
    let live = true;
    void Promise.all([source.catalog(), source.formats()]).then(
      ([loaded, names]) => {
        if (!live) return;
        if (loaded.ok) setCatalog(loaded.value);
        if (names.ok) setFormats(names.value);
      },
    );
    return () => {
      live = false;
    };
  }, [source]);

  const read = (target: ReaderTarget) => setDetail({ kind: "reader", target });

  useEffect(() => {
    if (!reading) return;
    setDetail({
      kind: "reader",
      target: {
        document: reading.document,
        version: reading.version,
        section: null,
      },
    });
  }, [reading]);

  const readMember = (
    series: string,
    members: readonly SeriesMember[],
    index: number,
  ) => {
    const member = members[index];
    if (!member) return;
    read({
      document: member.document,
      version: member.version,
      section: null,
      sequence: { series, members, index },
    });
  };

  const detailView = (() => {
    if (detail.kind === "reader") {
      const sequence = detail.target.sequence;
      return (
        <Reader
          key={`${detail.target.document}:${detail.target.version ?? ""}:${
            detail.target.section ?? ""
          }`}
          source={source}
          target={detail.target}
          now={now}
          onOpen={read}
          onBack={sequence
            ? () => setDetail({ kind: "series", id: sequence.series })
            : undefined}
          onStep={sequence
            ? (index) => readMember(sequence.series, sequence.members, index)
            : undefined}
        />
      );
    }
    if (detail.kind === "series") {
      return (
        <SeriesDetailView
          key={detail.id}
          source={source}
          id={detail.id}
          catalog={catalog}
          onRead={(members, index) => readMember(detail.id, members, index)}
          onChanged={() => setSeriesRevision((value) => value + 1)}
        />
      );
    }
    if (detail.kind === "register") {
      return (
        <RegisterSeries
          source={source}
          catalog={catalog}
          formats={formats}
          onRegistered={(series) => {
            setSeriesRevision((value) => value + 1);
            setDetail({ kind: "series", id: series.id });
          }}
        />
      );
    }
    return (
      <p className={styles.placeholder} data-detail="none">
        {t("documents.empty.pick-document")}
      </p>
    );
  })();

  const currentDocument = detail.kind === "reader"
    ? detail.target.document
    : null;

  return (
    <div className={styles.screen} data-screen-body="documents">
      <div className={styles.listColumn} data-list-column="">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as DocumentsTab)}
        >
          <TabList>
            <Tab value="search">{t("documents.label.tab-search")}</Tab>
            <Tab value="views">{t("documents.label.tab-views")}</Tab>
            <Tab value="series">{t("documents.label.tab-series")}</Tab>
          </TabList>
        </Tabs>
        {/* 탭을 옮겨도 검색어·결과·연 보기를 잃지 않게 세 칸을 모두 두고 숨긴다. */}
        <div hidden={tab !== "search"} data-tab-panel="search">
          <SearchPanel
            source={source}
            catalog={catalog}
            formats={formats}
            current={currentDocument}
            onRead={read}
            onViewSaved={() => setViewsRevision((value) => value + 1)}
          />
        </div>
        <div hidden={tab !== "views"} data-tab-panel="views">
          <ViewsPanel
            source={source}
            revision={viewsRevision}
            current={currentDocument}
            now={now}
            onRead={read}
            onSearch={() => setTab("search")}
          />
        </div>
        <div hidden={tab !== "series"} data-tab-panel="series">
          <SeriesPanel
            source={source}
            catalog={catalog}
            revision={seriesRevision}
            current={detail.kind === "series" ? detail.id : null}
            onOpen={(id) => setDetail({ kind: "series", id })}
            onRegister={() => setDetail({ kind: "register" })}
          />
        </div>
      </div>
      <div className={styles.detailColumn} data-detail-column="">
        {detailView}
      </div>
    </div>
  );
}
