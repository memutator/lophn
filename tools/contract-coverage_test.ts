import { assertEquals } from "@std/assert";
import {
  eventsBySection,
  routePresence,
  routesBySection,
  sectionFive,
} from "./contract-coverage.ts";

const SAMPLE = `# 예시

## 4. 앞장

| 경로 |
|---|
| \`/v1/outside/counted\` |

## 5. 내놓는 contract

### 5.1 표의 경로

| 경로 | 동작 |
|---|---|
| \`/v1/projects/create\`, \`/update\`, \`/archive\` | 짧은 표기는 같은 행의 resource |
| \`/v1/documents/list\`, \`/v1/documents/get\` | 셀 하나에 전체 경로 둘 |

### 5.2 본문

본문의 \`/v1/projects/create\`는 표가 아니라서 세지 않는다.

### 5.3 event

platform 소유 event 이름은 \`SecretSet\`, \`SettingsChanged\`다.

문서 영역의 실제 event 이름은 다음과 같다.

- Document: \`DocumentSaved\`, \`DocumentCreated\`.

| event | 뜻 |
|---|---|
| \`ProblemOpened\` | 첫 발생 |
| \`ProblemWorkStarted\` / \`ProblemWorkEnded\` | 상태 변화 |

| 경로 | command |
|---|---|
| \`/v1/runs/accept\` | \`AcceptRun\` |

## 6. 쓰는 contract

event는 \`OutsideEvent\`다.
`;

Deno.test("contracts#T8: 5장만 읽고 6장과 앞장은 뺀다", () => {
  const section = sectionFive(SAMPLE);
  assertEquals(section.startsWith("## 5."), true);
  assertEquals(section.includes("## 6."), false);
  assertEquals(section.includes("/v1/outside/counted"), false);
});

Deno.test("contracts#T8: 표의 전체 경로와 짧은 표기를 resource로 펼친다", () => {
  assertEquals(
    routesBySection(SAMPLE).map((section) => [section.heading, section.paths]),
    [
      ["5.1 표의 경로", [
        "/v1/projects/create",
        "/v1/projects/update",
        "/v1/projects/archive",
        "/v1/documents/list",
        "/v1/documents/get",
      ]],
      ["5.3 event", ["/v1/runs/accept"]],
    ],
  );
});

Deno.test("contracts#T8: event 목록 문장과 event 표의 이름만 읽는다", () => {
  assertEquals(
    eventsBySection(SAMPLE).map((section) => [section.heading, section.types]),
    [
      ["5.3 event", [
        "SecretSet",
        "SettingsChanged",
        "DocumentSaved",
        "DocumentCreated",
        "ProblemOpened",
        "ProblemWorkStarted",
        "ProblemWorkEnded",
      ]],
    ],
  );
});

Deno.test("contracts#T8: 경로가 route 목록에 있으면 있음이다", () => {
  const routes = [{ resource: "platform", method: "status" }];
  assertEquals(routePresence("/v1/platform/status", routes), "있음");
  assertEquals(routePresence("/v1/platform/health", routes), "없음");
});
