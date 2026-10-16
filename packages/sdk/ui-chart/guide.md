# @lophn/ui-chart

## 목적

시계열·막대·누적 막대·분포·산점 차트와 node·edge 도표다. 계산은
d3-scale·d3-shape, 그리기는 React SVG다. 앱 화면과 세션 시각 블록이 같은 선언형
props를 넘긴다. 함수 식이나 HTML을 받지 않는다.

## 공개 API와 type

```tsx
import {
  BarChart,
  DistributionChart,
  GraphDiagram,
  LineChart,
  ScatterChart,
} from "@lophn/ui-chart";
```

- `LineChart({series, ...})` — 시계열 차트다.
- `BarChart({groups, ...})` — 막대와 누적 막대 차트다.
- `DistributionChart({values, ...})` — 분포 차트다.
- `ScatterChart({groups, ...})` — 산점 차트다.
- `GraphDiagram({nodes, edges, ...})` — node·edge 도표다.
- type: `LineChartProps`, `BarChartProps`, `DistributionChartProps`,
  `ScatterChartProps`, `GraphDiagramProps`, `Series`, `ScatterGroup`,
  `ScatterPoint`, `GraphNode`, `GraphEdge`, `ChartStateProps`,
  `ChartLocaleProps`

## 요구 permission

없다. 그리기는 React SVG의 일이다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다.

| peer           | version |
| -------------- | ------- |
| `react`        | 19.3.0  |
| `lucide-react` | 1.51.0  |
| `d3-scale`     | 4.0.2   |
| `d3-shape`     | 3.2.0   |

## 예제

```tsx
import { BarChart } from "@lophn/ui-chart";

<BarChart
  groups={[{ label: "10월", series: [{ key: "count", value: 3 }] }]}
/>;
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 component·prop 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
