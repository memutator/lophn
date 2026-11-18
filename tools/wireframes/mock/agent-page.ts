// 다른 기계의 page 보기에 그리는 고정 그림 하나: agent가 연 로그인 page. 실제 frame은 JPEG이지만 gallery는 svg로 그린다.
// 화면은 frame의 media_type으로 data URL을 짓으므로 이 그림만 media_type을 svg로 둔다.
import type { PageFrame } from "../../../packages/protocol/lophn-agent/page-view.ts";

const WIDTH = 1280;
const HEIGHT = 800;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<rect width="${WIDTH}" height="${HEIGHT}" fill="#f6f8fa"/>
<rect width="${WIDTH}" height="64" fill="#24292f"/>
<circle cx="48" cy="32" r="16" fill="#ffffff"/>
<text x="80" y="40" font-family="sans-serif" font-size="20" fill="#ffffff">Example Cloud</text>
<text x="640" y="200" font-family="sans-serif" font-size="32" fill="#1f2328" text-anchor="middle">Sign in to Example Cloud</text>
<rect x="460" y="240" width="360" height="300" rx="8" fill="#ffffff" stroke="#d0d7de"/>
<text x="484" y="284" font-family="sans-serif" font-size="16" fill="#1f2328">Email address</text>
<rect x="484" y="298" width="312" height="40" rx="6" fill="#ffffff" stroke="#d0d7de"/>
<text x="496" y="324" font-family="sans-serif" font-size="16" fill="#1f2328">me@example.com</text>
<text x="484" y="374" font-family="sans-serif" font-size="16" fill="#1f2328">Password</text>
<rect x="484" y="388" width="312" height="40" rx="6" fill="#ffffff" stroke="#0969da" stroke-width="2"/>
<rect x="484" y="460" width="312" height="44" rx="6" fill="#1f883d"/>
<text x="640" y="488" font-family="sans-serif" font-size="16" fill="#ffffff" text-anchor="middle">Sign in</text>
<text x="640" y="590" font-family="sans-serif" font-size="14" fill="#0969da" text-anchor="middle">Forgot password?</text>
</svg>`;

export const AGENT_PAGE_FRAME: PageFrame = {
  media_type: "image/svg+xml" as "image/jpeg",
  data_base64: btoa(SVG),
  width: WIDTH,
  height: HEIGHT,
};
