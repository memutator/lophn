import { useEffect, useState } from "react";
import { Tab, TabList, Tabs } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { EditorSessions } from "../../../editor/sessions.ts";
import type {
  Catalog,
  LophnSource,
  Series,
  SeriesMember,
} from "../source.ts";
import { MemberWriter } from "../series/member-writer.tsx";
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
  | { readonly kind: "write"; readonly series: Series }
  | { readonly kind: "register" };

export interface DocumentsScreenProps {
  source: LophnSource;
  /** 상대 시각의 기준. 테스트가 고정한다. */
  now?: () => number;
  /** 처음 고른 탭. 테스트가 고른다. */
  initialTab?: DocumentsTab;
  /** 처음 읽을 문서. 대화의 결과 링크가 연다. */
  initialRead?: ReaderTarget;
  /** 창의 편집 session 묶음. 있으면 series 새 멤버를 이 화면에서 쓴다. */
  sessions?: EditorSessions;
}

const EMPTY_CATALOG: Catalog = { projects: [], apps: [], contexts: [] };

// documents 화면. 왼쪽 360px 목록 칸에서 찾고 고르며 오른쪽 상세에서 읽는다(desktop#R1).
// 검색·saved view·series가 같은 목록 칸을 나눠 쓰고 대화 없이도 문서에 닿는다.
export function DocumentsScreen(
  { source, now = Date.now, initialTab = "search", initialRead, sessions }:
    DocumentsScreenProps,
) {
  const [tab, setTab] = useState<DocumentsTab>(initialTab);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [formats, setFormats] = useState<readonly string[]>([]);
  const [detail, setDetail] = useState<Detail>(
    initialRead ? { kind: "reader", target: initialRead } : { kind: "none" },
  );
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
          {...(sessions
            ? { onWrite: (series: Series) => setDetail({ kind: "write", series }) }
            : {})}
        />
      );
    }
    if (detail.kind === "write" && sessions && detail.series.draft) {
      const id = detail.series.id;
      return (
        <MemberWriter
          key={detail.series.draft.document}
          source={source}
          sessions={sessions}
          series={detail.series}
          onSaved={() => {
            // 첫 판이 멤버가 되었다. 가족 목록과 순서를 다시 읽는다.
            setSeriesRevision((value) => value + 1);
            setDetail({ kind: "series", id });
          }}
          onBack={() => setDetail({ kind: "series", id })}
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
