// Tokens · chart colors. 앱 CSS 밖에서 token 값이 필요할 때 읽는 차트 색(예제 chart-colors).
import { tokens } from "@lophn/ui";

import { kit, Page, Section } from "../kit.tsx";
import { otherColor, seriesColors } from "./chart-colors.ts";

/** Tokens · chart colors. 예제 chart-colors. */
export function TokensChart() {
  return (
    <Page>
      <Section
        title="chart-colors"
        note="앱 CSS 밖에서 token 값이 필요할 때: 차트 계열 색과 기타 회색을 theme별로 읽는다."
      >
        {(["light", "dark"] as const).map((theme) => (
          <div key={theme} className={kit.row}>
            <span className={kit.label}>seriesColors("{theme}")</span>
            <div className={kit.value}>
              {seriesColors(theme).map((color) => (
                <span key={color} className={kit.swatch}>
                  <span
                    className={kit.chipColor}
                    style={{ background: color }}
                  />
                  <span className={kit.hex}>{color}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
        <div className={kit.row}>
          <span className={kit.label}>otherColor</span>
          <div className={kit.value}>
            <span className={kit.hex}>{otherColor}</span>
            <span
              className={kit.chipColor}
              style={{ background: otherColor }}
            />
          </div>
        </div>
        <p className={kit.note}>
          export된 token은 {Object.keys(tokens).length}묶음이다(@lophn/ui).
        </p>
      </Section>
    </Page>
  );
}
