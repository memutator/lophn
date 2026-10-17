import type { Area } from "../../types.ts";
import { TokensChart } from "./tokens-chart.tsx";
import {
  TokensColors,
  TokensIcons,
  TokensSpace,
  TokensType,
} from "./tokens-pages.tsx";

export const tokensArea: Area = {
  id: "tokens",
  title: "tokens",
  summary: "색, 글자, 간격·폭, 아이콘, 차트 색 token.",
  pages: [
    {
      id: "tokens-colors",
      title: "Tokens · colors",
      description:
        "packages/design의 색 token 전부를 이름과 값이 있는 견본으로 보인다. 모든 견본은 light와 dark 값을 나란히 놓아 위쪽 테마 선택과 상관없이 둘이 한눈에 비교된다.",
      render: () => <TokensColors />,
    },
    {
      id: "tokens-type",
      title: "Tokens · type",
      description:
        "글자 크기·줄 높이·굵기·자간과 sans·mono 글꼴을 영어와 한국어 견본 문장으로 보인다.",
      render: () => <TokensType />,
    },
    {
      id: "tokens-space",
      title: "Tokens · space & layout",
      description:
        "간격·모서리·테두리·그림자·z-index와 페이지 틀·sidebar·dialog 같은 폭 token을 막대와 상자로 보인다. 폭은 가장 긴 1440px 기준의 비율이다.",
      render: () => <TokensSpace />,
    },
    {
      id: "tokens-icons",
      title: "Tokens · icons",
      description:
        "packages/design/components의 아이콘 묶음(*-icons.ts) 전부를 이름과 함께 격자로 보인다. 모두 선 1.5의 Lucide 한 벌이다.",
      render: () => <TokensIcons />,
    },
    {
      id: "tokens-chart",
      title: "Tokens · chart colors",
      description:
        "앱 CSS 밖에서 token 값이 필요할 때 읽는 차트 계열 색과 기타 회색을 light·dark별로 보인다(예제 chart-colors).",
      render: () => <TokensChart />,
    },
  ],
};
