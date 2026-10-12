// 앱의 공개 예제를 실제 renderer loader로 묶어 같은 React·token·입력 계약을 확인한다.
import { createRoot } from "react-dom/client";
import {
  type ResizeSource,
  ResizeSourceProvider,
} from "@lophn/design/components";
import { OrdersTable } from "../../../sdk/ui-table/examples/orders-table.tsx";
import {
  SalesDashboard,
} from "../../../sdk/ui-chart/examples/sales-dashboard.tsx";

export function mount(element: HTMLElement): () => void {
  const source: ResizeSource = {
    observe(_element, onSize) {
      onSize({ width: 800, height: 600 });
      return () => {};
    },
  };
  const root = createRoot(element);
  root.render(
    <ResizeSourceProvider value={source}>
      <OrdersTable
        orders={[
          {
            id: "a",
            customer: "Example customer",
            total: 125,
            placed: new Date("2026-09-25T00:00:00Z"),
          },
        ]}
        now={new Date("2026-09-26T00:00:00Z")}
        loading={false}
        failed={false}
        reload={() => {}}
      />
      <SalesDashboard loading={false} failed={false} reload={() => {}} />
    </ResizeSourceProvider>,
  );
  return () => root.unmount();
}
