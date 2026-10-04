import { assertEquals } from "@std/assert";
import { SalesDashboard } from "./examples/sales-dashboard.tsx";
import { sized } from "./testing.tsx";

Deno.test("apps/sdk#R17: 예제는 시계열·막대·누적 막대·분포·산점·node·edge 여섯 종류를 공개 이름으로 그린다", () => {
  using view = sized(
    <SalesDashboard loading={false} failed={false} reload={() => {}} />,
  );
  assertEquals(
    [...view.container.querySelectorAll("svg[data-chart]")].map((svg) =>
      svg.getAttribute("data-chart")
    ),
    ["line", "bar", "stacked", "distribution", "scatter", "graph"],
  );
});
