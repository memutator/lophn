// Kit · feedback. @lophn/ui/feedback의 상태 표시와 예제(orders-status).
import { useState } from "react";
import {
  EmptyState,
  ErrorState,
  Skeleton,
  StaleNote,
  StatusMark,
} from "@lophn/ui/feedback";
import { launcherEmptyIcon } from "../../../../../packages/shell/renderer/icons/mod.ts";

import { AppRoot, OrdersStatus } from "./orders-status.tsx";
import { kit, Page, Row, Section } from "../kit.tsx";

const NOW = new Date("2026-10-11T12:00:00Z");
const EXAMPLE_NOW = new Date("2026-10-06T15:30:00Z");
const NOOP = () => {};

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
      <Section title="StaleNote">
        <Row label="2 hours ago">
          <StaleNote updatedAt={new Date("2026-10-11T10:00:00Z")} now={NOW} />
        </Row>
        <Row label="3 days ago">
          <StaleNote updatedAt={new Date("2026-10-08T12:00:00Z")} now={NOW} />
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
          <AppRoot>
            {status(READY, new Date("2026-10-06T17:30:00Z"))}
          </AppRoot>
        </Row>
      </Section>
    </Page>
  );
}
