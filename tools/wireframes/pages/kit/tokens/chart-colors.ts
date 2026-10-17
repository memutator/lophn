// 앱 CSS 밖에서 token 값이 필요할 때의 예: 차트 계열 색과 기타 회색을 theme별로 읽는다.
import { type Theme, tokens, vars } from "@lophn/ui";

export function seriesColors(theme: Theme): string[] {
  return tokens.chart.series.map((slot) => slot[theme]);
}

export const otherColor = vars.chart.other;
