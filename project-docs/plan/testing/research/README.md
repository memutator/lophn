# 조사 자료

planner session이 roadmap(`project-docs/products/roadmap/testing.md`)을 쓰기 전에 모은 것이다. 다른 harness는 GitHub 기본 branch를 `--depth 1`로 받아 읽기만 했고(clean room: 코드는 옮기지 않는다), lophn은 main을 읽었다. 계획이 끝나면 폴더째 지운다.

| file | 무엇 | 언제 읽나 |
|---|---|---|
| `facts-main.md` | lophn main(`4b3029f48`)의 사실. test·check, model 호출 길, provider 연결, catalog, core 기동과 token, 앱 release, Deno 권한, 사람 역할 route, 재시작, secret | 모든 brief. path와 이름을 여기서 시작해 코드로 다시 확인한다 |
| `survey-cases.md` | harness case 재료. adapter 판정 표, HTTP 분류 표, loop가 결과마다 하는 일, 한도와 retry | harness loop·wire brief. **2-3절(지금 fake로 낼 수 있나)과 provider 등록 길은 옛 `tools/fake-provider`와 지워진 `providers/register` 기준이라 쓰지 않는다.** 5절(models.dev)은 `facts-main.md` 5절이 맞다 |
| `research-sdk.md` | agent SDK(Vercel AI SDK, pydantic-ai, OpenAI Agents SDK, LangChain, 공식 SDK, LiteLLM, Mastra)의 fake model, 녹화·재생, provider 꼴 맞추기 | scripted model, 녹화 재생, live suite |
| `research-cli.md` | coding agent CLI(Codex, OpenCode, Gemini CLI, Goose, Aider)의 fake provider와 test 환경 | fake server, core E2E support |
| `research-hermes.md` | hermes agent의 test 층, fake server(응답 7종, main/aux 분리), live canary, failure class 시나리오 | fake server, E2E 시나리오 table, live 비용 상한 |
| `research-flows-cli.md` | CLI들의 E2E·integration 시나리오 목록과 고르는 기준 | case 고르는 규칙, E2E flow brief |
| `research-flows-apps.md` | desktop·IDE agent 앱(Zed, Cline, Continue, OpenHands, Mastra, Roo Code)의 시나리오와 기준 | case 고르는 규칙, E2E flow brief |
