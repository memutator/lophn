// agent avatar의 캐릭터 색과 browser profile의 색 점이 같이 쓰는 색 이름이다. 값은 shell이 그린다.
// protocol 최상위 영역(lophn-agent, shell)이 서로를 import하지 않게 base에 둔다.
export const AGENT_CHARACTER_COLORS = [
  "coral",
  "periwinkle",
  "yellow",
  "sage",
  "lavender",
  "peach",
  "blue",
  "teal",
] as const;
