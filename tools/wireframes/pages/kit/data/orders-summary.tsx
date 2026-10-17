// 앱 화면 예: 주문 read command 결과의 이번 기간과 지난 기간 값으로 수치와 변화량을 보인다.
import { StatRow, StatTile } from "@lophn/ui/data";

// read command가 돌려준 요약. 변화량은 앱이 같은 단위로 계산한다.
export interface OrdersSummaryResult {
  orders: { current: number; previous: number };
  revenue: { current: number; previous: number };
  late: { current: number; previous: number };
}

// 앱이 자기 catalog에서 가져오는 문구 자리다.
const TEXT = {
  orders: "Orders",
  revenue: "Revenue",
  late: "Late shipments",
  dollars: "USD",
  versus: "vs last period",
};

export function OrdersSummary({ result }: { result: OrdersSummaryResult }) {
  const change = (value: { current: number; previous: number }) =>
    value.current - value.previous;
  return (
    <StatRow>
      <StatTile
        label={TEXT.orders}
        value={result.orders.current}
        change={change(result.orders)}
        changeLabel={TEXT.versus}
      />
      <StatTile
        label={TEXT.revenue}
        value={result.revenue.current}
        unit={TEXT.dollars}
        change={change(result.revenue)}
        changeLabel={TEXT.versus}
      />
      <StatTile
        label={TEXT.late}
        value={result.late.current}
        change={change(result.late)}
        changeLabel={TEXT.versus}
      />
    </StatRow>
  );
}
