// Kit · feedback. @lophn/ui/feedback의 상태 표시와 예제(orders-status).
import { useState } from "react";
import {
  EmptyState,
  ErrorState,
  Loading,
  ReadState,
  Shimmer,
  Skeleton,
  StaleNote,
  StatusMark,
} from "@lophn/ui/feedback";
import { launcherEmptyIcon } from "../../../../../packages/shell/renderer/icons/mod.ts";

import { AppRoot, OrdersStatus } from "./orders-status.tsx";
import { FROZEN_TIMER, kit, Page, Row, Section } from "../kit.tsx";

const NOW = new Date("2026-10-11T12:00:00Z");
const EXAMPLE_NOW = new Date("2026-10-06T15:30:00Z");
const NOOP = () => {};
// 지연 시간이 이미 지난 것으로 본다.
const ELAPSED_TIMER = {
  set: (callback: () => void) => {
    callback();
    return 0;
  },
  clear: () => {},
};
const FRESHNESS = {
  updatedAt: new Date("2026-10-11T11:55:00Z"),
  now: NOW,
  staleAfterMs: 60 * 60 * 1000,
};
const LIST = <p>ord_1 · Harbor Books</p>;
const READ_EMPTY = {
  message: "No orders yet.",
  action: { label: "Reload", onSelect: NOOP },
};

const READY = {
  loading: false,
  failed: false,
  orders: ["ord_1 · Harbor Books", "ord_2 · Yeon-ho Kim"],
  updatedAt: new Date("2026-10-06T15:20:00Z"),
};

export function KitFeedback() {
  const [reloads, setReloads] = useState(0);
  const status = (result: typeof READY, now = EXAMPLE_NOW) => (
    <OrdersStatus result={result} now={now} reload={NOOP} />
  );
  return (
    <Page>
      <div className={kit.colTwo}>
        <Section title="EmptyState" note="다음 행동은 언제나 하나다.">
          <div className={kit.panel}>
            <EmptyState
              icon={launcherEmptyIcon}
              message="No projects yet."
              action={{ label: "Register project", onSelect: NOOP }}
            />
          </div>
        </Section>
        <Section title="ErrorState" note="원인은 추측하지 않는다.">
          <div className={kit.panel}>
            <ErrorState
              target="projects"
              onRetry={() => setReloads(reloads + 1)}
            />
          </div>
        </Section>
      </div>
      <Section
        title="Skeleton"
        note="내용과 같은 자리를 지킨다. 300ms 뒤에만 보인다."
      >
        <Row label="line ×3">
          <Skeleton lines={3} />
        </Row>
        <Row label="control">
          <Skeleton shape="control" />
        </Row>
        <Row label="icon">
          <Skeleton shape="icon" />
        </Row>
      </Section>
      <Section
        title="Loading"
        note="300ms 안에 끝나면 아무것도 보이지 않는다. 길어지면 skeleton, 끝나면 내용이다."
      >
        <Row label="loading, before delay">
          <Loading
            loading
            placeholder={<Skeleton lines={2} />}
            timer={FROZEN_TIMER}
          >
            {LIST}
          </Loading>
        </Row>
        <Row label="loading, after delay">
          <Loading
            loading
            placeholder={<Skeleton lines={2} />}
            timer={ELAPSED_TIMER}
          >
            {LIST}
          </Loading>
        </Row>
        <Row label="loaded">
          <Loading loading={false} placeholder={<Skeleton lines={2} />}>
            {LIST}
          </Loading>
        </Row>
      </Section>
      <Section title="StaleNote">
        <Row label="2 hours ago">
          <StaleNote updatedAt={new Date("2026-10-11T10:00:00Z")} now={NOW} />
        </Row>
        <Row label="3 days ago">
          <StaleNote updatedAt={new Date("2026-10-08T12:00:00Z")} now={NOW} />
        </Row>
      </Section>
      <Section
        title="Shimmer"
        note="끝을 모르는 짧은 기다림. 움직임을 줄인 설정에서는 흐린 글자로 멈춘다."
      >
        <Row label="working">
          <Shimmer>Working</Shimmer>
        </Row>
      </Section>
      <Section
        title="StatusMark"
        note="색 없이도 아이콘 모양과 글자로 구별한다."
      >
        <div className={kit.row}>
          <StatusMark tone="good" label="Running" />
          <StatusMark tone="warning" label="Needs attention" />
          <StatusMark tone="serious" label="Failing" />
          <StatusMark tone="critical" label="Stopped" />
          <StatusMark tone="neutral" label="Not checked" />
        </div>
      </Section>
      <Section
        title="ReadState"
        note="loading → error → empty → 내용 중 하나만 그리고, 낡은 내용에는 나이를 붙인다."
      >
        <Row label="loading">
          <ReadState
            loading
            onRetry={NOOP}
            isEmpty={false}
            empty={READ_EMPTY}
            timer={ELAPSED_TIMER}
          >
            {LIST}
          </ReadState>
        </Row>
        <Row label="empty">
          <ReadState onRetry={NOOP} isEmpty empty={READ_EMPTY}>
            {LIST}
          </ReadState>
        </Row>
        <Row label="error">
          <ReadState
            failed="orders"
            onRetry={NOOP}
            isEmpty={false}
            empty={READ_EMPTY}
          >
            {LIST}
          </ReadState>
        </Row>
        <Row label="fresh">
          <ReadState
            onRetry={NOOP}
            isEmpty={false}
            empty={READ_EMPTY}
            freshness={FRESHNESS}
          >
            {LIST}
          </ReadState>
        </Row>
        <Row label="stale">
          <ReadState
            onRetry={NOOP}
            isEmpty={false}
            empty={READ_EMPTY}
            freshness={{
              ...FRESHNESS,
              updatedAt: new Date("2026-10-11T08:00:00Z"),
            }}
          >
            {LIST}
          </ReadState>
        </Row>
      </Section>
      <Section
        title="orders-status"
        note="읽기 결과의 loading·empty·error·freshness. 네 상태를 나란히 놓았다."
      >
        <Row label="Ready">
          <AppRoot>{status(READY)}</AppRoot>
        </Row>
        <Row label="Empty">
          <AppRoot>{status({ ...READY, orders: [] })}</AppRoot>
        </Row>
        <Row label="Failed">
          <AppRoot>{status({ ...READY, failed: true })}</AppRoot>
        </Row>
        <Row label="Stale (read an hour ago)">
          <AppRoot>{status(READY, new Date("2026-10-06T17:30:00Z"))}</AppRoot>
        </Row>
      </Section>
    </Page>
  );
}
