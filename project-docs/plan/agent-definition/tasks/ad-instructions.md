# ad-instructions

모든 role에 같은 말을 `PRODUCT_INSTRUCTIONS` 한 곳에 두고 role 지침 넷에서 지운다. 옮길 말은 role 지침 넷(과 `PRODUCT_INSTRUCTIONS`)에 같은 뜻으로 두 번 이상 있는 문단이고, 한 role에만 있는 말은 그 role에 둔다. PM과 App Engineer 지침의 domain 폴더 설명은 `guide-domains` skill로, kind 위반 다루기는 `kinds-yaml` skill로 옮긴다. App Engineer 지침은 ae-builds가 직접 짓는 흐름으로 다시 쓴 글을 기준으로 겹친 말만 걷어 낸다.

- 단위: instructions (wave 2)
- 선행: ad-builtin-skills. `guide-domains`, `guide-artifact`, `check-kinds` skill이 있고 `guide.read`를 뺀 지침 위에서 고친다.
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/roles/prompts.ts`
  - `packages/core/agent-roles/roles/{lophn,project-manager,app-engineer,operator}/prompt.md`
  - `packages/core/agent-roles/skills/{guide-domains,kinds-yaml,guide-artifact,check-kinds}/SKILL.md`
- 읽을 것:
  - 계획: `project-docs/plan/agent-definition/README.md`의 "정한 것"(`PRODUCT_INSTRUCTIONS`로 옮길 말은 같은 뜻으로 두 번 이상 있는 문단, domain 폴더 설명과 kind 다루기는 내장 skill로)
  - roadmap: `project-docs/products/roadmap/agent-definition.md`의 "instruction은 한 번만 말한다", "끝남 기준" 셋째 줄(같은 문단이 두 곳에 없다)
  - 앞 계획: `project-docs/plan/ae-builds/README.md`의 "정한 것"의 "App Engineer 지침을 다시 쓴다"(흐름, 반 정도 길이, lophn과 PM 지침의 ticket 줄 지우기)와 "공개 tool 막기는 준비 결과의 알림이다"
  - architecture: `project-docs/architecture/agent-definition.md`의 "같은 재료는 같은 bytes다"(고정 본문은 고정 문장), "고정 규칙은 영어 고정 본문 하나"(왜 이 모양인가), "skill은 목록(이름과 설명)만 prompt에 넣고 본문은 tool로 읽는다". `project-docs/architecture/approval.md` 첫 절과 "agent는 자기 할당을 넓히지 못한다"(옮기는 문단의 말은 grant가 아니라 assign이다). `project-docs/architecture/domain.md`(domain 폴더와 쓰는 쪽)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
  - 코드
    - `packages/core/agent-roles/roles/prompts.ts` 24-54(`rolePrompt`, `PRODUCT_INSTRUCTIONS`. "Who can give you instructions" 39-47, "How you work" 49-54)
    - role 지침 넷(줄 번호는 아래 표)
    - skill: `packages/core/agent-roles/skills/kinds-yaml/SKILL.md`(4. Check 37-46, What you do not do 101-107), ad-builtin-skills가 만든 `guide-domains`·`guide-artifact`·`check-kinds`의 SKILL.md
- 계약:
  - 쓰는 것:
    - ad-builtin-skills의 내장 skill과 role: `guide-domains`(lophn, PM, App Engineer), `guide-artifact`(PM, App Engineer, Operator), `kinds-yaml`(PM, App Engineer), `check-kinds`(PM)
    - ae-builds land 뒤의 App Engineer 지침과 ticket 줄을 지운 lophn·PM 지침. 앞 계획 land 뒤 path 확인.
  - 내놓는 것:
    - `PRODUCT_INSTRUCTIONS`(export 이름 그대로, `rolePrompt`의 꼴 `${PRODUCT_INSTRUCTIONS}\n\n${role 지침}` 그대로)에 Calls, 앱과 data 규칙, 결정 묻기(한 번에 하나, 설명한 선택지 2~3개와 추천, `ask`), artifact 한 줄이 한 번씩 있다. artifact 줄은 "그 skill이 있으면" 꼴이라 lophn에게도 맞다(lophn은 artifact를 쓰지 않고 `guide-artifact` skill이 없다).
    - role 지침에 `## Calls`와 `## Rules for apps and data` 절이 없고, 같은 문단이 두 곳에 없다. role 지침 넷의 줄 합이 ae-builds land 뒤보다 줄어든다.
    - PM과 App Engineer 지침에는 domain 폴더(`DOMAIN.md`, `kinds.yaml`, `skills/`, `artifacts/`)를 설명하는 목록이 없고 `guide-domains` skill을 가리킨다. kind 위반 다루기는 `kinds-yaml` skill에 있고 `check-kinds`가 그것을 가리킨다.

## 할 일

줄 번호는 main `dd956b49f` 기준이다(`f778bf6c1`도 `packages`는 같다). App Engineer 지침과 lophn·PM 지침의 ticket 줄은 ae-builds가 고친다(앞 계획 land 뒤 path 확인). 아래 표의 App Engineer 줄은 ae-builds 앞 글의 위치다. land 뒤 글에서 같은 뜻의 줄을 찾아 맞추고, 없어졌으면 건너뛴다. lophn·PM 줄도 ticket 줄이 빠진 만큼 밀린다.

1. 겹친 문단을 표로 확인한다. 아래가 main에서 찾은 것이다. ae-builds 뒤 글에서 다시 보고, 더 찾으면 같은 규칙으로 더한다. 규칙: 네 role 모두에 맞는 말이면 `PRODUCT_INSTRUCTIONS`, tool이나 skill이 있는 role에만 맞는 말은 "If you have …" 꼴로 `PRODUCT_INSTRUCTIONS`, domain 폴더와 kind에 관한 말은 skill, 받는 쪽이나 범위가 role마다 다른 말은 role에 둔다.

   | # | 뜻 | 지금 있는 곳 | 갈 곳 |
   |---|---|---|---|
   | 1 | 결과를 바라는 call을 받으면 끝나고 `reply`, 맡지 않으면 이유와 `reply` | `prompts.ts` 50, lophn 73-74, PM 105-106, AE 230-231, Operator 57-58 | `PRODUCT_INSTRUCTIONS`(이미 있다) |
   | 2 | call이 실패·거절되거나 일이 막혀도 다른 agent에게 넘기지 않고 사람에게 말한다 | `prompts.ts` 51, lophn 71-72, PM 103-104, AE 228-229, Operator 55-56 | `PRODUCT_INSTRUCTIONS`(이미 있다) |
   | 3 | 보낸 call은 기다리지 않는다. 답은 나중에 새 입력으로 온다 | lophn 69-70, PM 102, AE 227, Operator 54 | `PRODUCT_INSTRUCTIONS` |
   | 4 | 받는 쪽은 일이 걸린 앱이나 project로 고른다 | lophn 67-68, PM 101, AE 226 | `PRODUCT_INSTRUCTIONS` |
   | 5 | call을 받으면 call을 먼저, 그다음 가리킨 근거를 읽는다 | PM 17, AE 17-18 | `PRODUCT_INSTRUCTIONS` |
   | 6 | 앱 DB를 직접 열지 않고 앱 tool로만 앱 data에 닿는다 | `prompts.ts` 52, lophn 78-79, PM 110-111, AE 235-236, Operator 62-63 | `PRODUCT_INSTRUCTIONS`(이미 있다) |
   | 7 | 사람 대신 정하지 않는다. 사람의 결정은 `ask`로 한 번에 하나, 설명한 선택지 2~3개와 추천 | lophn 11-12·61, PM 49-50·64-66, AE 91-93·221, Operator 50 | `PRODUCT_INSTRUCTIONS`. role마다 다른 말은 role에 남긴다: lophn "뜻이 분명해질 때까지 묻는다"(11), AE "사람이 받는 것을 바꾸는 선택만 사람의 말로 묻고 기술은 스스로 정한다"(91-93), PM "domain 자르기는 사람의 결정"(49-50) |
   | 8 | 용어의 뜻은 사람만 정한다. 답이 없으면 그 변경을 쓰지 않고 정하지 않았다고 보고한다 | PM 89-91, AE 45 | `PRODUCT_INSTRUCTIONS` |
   | 9 | 읽은 것에 근거한다. 확인한 것과 추정을 나눈다 | lophn 50-51·80, Operator 25-26, AE 180 | `PRODUCT_INSTRUCTIONS`. lophn의 "State risk first"(80)와 "not confirmed"(51)는 lophn에 남긴다 |
   | 10 | 사람이 넓히지 않은 것을 넓히지 않는다. 자기 정의나 할당을 바꿔야 하면 사람에게 말한다 | lophn 62, Operator 48-49, PM 62-63, AE 189 | `PRODUCT_INSTRUCTIONS` |
   | 11 | 다른 domain의 tool은 `public`일 때만 보이고, 쓰게 하는 것은 사람의 할당이다. 이유와 함께 사람에게 제안한다 | lophn 24-25, PM 71-74, AE 190-194, Operator 34 | `PRODUCT_INSTRUCTIONS`. Operator 34-36의 "그 tool이 바뀌면 PM이나 AE가 알려 준다. 다시 쓰기 전에 읽는다"는 Operator에 남긴다 |
   | 12 | domain의 `DOMAIN.md`·kinds file·skill은 그 그릇의 PM이나 AE만 쓴다. 남의 것이 바뀌어야 하면 그 agent에게 `call`로 넘긴다 | lophn 58-60, PM 95, AE 50-51, Operator 18-20·45-47(Operator 안에서도 두 번) | `PRODUCT_INSTRUCTIONS` |
   | 13 | Operator 만들기·고치기(`operator.create`·`operator.update`, 자기 project나 앱의 것만, `domains`로 domain을 고르고 빼면 전부, 접근은 사람이 할당) | PM 59-63, AE 186-189 | `PRODUCT_INSTRUCTIONS`, "If you have `operator.create`" 꼴 |
   | 14 | 사람이 결과를 화면에서 보려 하면 artifact를 쓴다. `guide-artifact`를 먼저 읽는다 | PM 75-79, AE 207-211, Operator 29-33 | `PRODUCT_INSTRUCTIONS`, "If you have the skill `guide-artifact`" 꼴 |
   | 15 | domain이 무엇이고 그 폴더에 무엇이 있나 | PM 21-25·27-42, AE 22-23·24-37, lophn 18-19 | `guide-domains`. lophn 18-25의 domain 지도 설명은 lophn에만 있어 남긴다 |
   | 16 | domain 만들기(`domain.create`에 이름·제목·목적, 이름은 slug이고 바뀌지 않는다), 같은 domain을 다른 곳에 다시 만들지 않는다 | PM 24-25·46-49, AE 42-44 | `guide-domains`("Who makes and writes it", "One container only"). role에는 언제 만드는지만 남긴다 |
   | 17 | documents가 kind를 어기면: `kind.check`로 읽고, kinds file과 문서 가운데 무엇이 틀렸는지 정해 이유와 말하고, 문서가 틀렸으면 고칠 것을 사람에게 말하고, 사람의 문서는 고치지 않는다. lophn은 이때 session을 열지 않고 사람이 notice를 보고 부를 수 있다 | PM 15-16·54-58, AE 15-17·46-49 | `kinds-yaml` 새 절 |

   role에 남기는 겹침(받는 쪽이나 범위가 role마다 다르다): 자기 place 밖의 계획을 lophn에게 넘기기(PM 83-85·96-97, AE 217-220. PM 안의 두 번은 하나로 합친다), Operator가 버그를 AE에게 넘기기(Operator 41-44), lophn이 Operator 요청을 PM·AE에게 넘기기(lophn 42-43), package 주인에게 넘기기(AE 202-206), annotation이 오는 길(PM 14-16, AE 12-13·183-185), lophn의 call 쓰는 법 "Say what you want in one short text and point to evidence by ID or file path. Do not paste your conversation."(lophn 66-67, lophn에만 있다).
2. `PRODUCT_INSTRUCTIONS`의 "How you work"(49-54)에 표의 1~14를 한 번씩 둔다. 지금 다섯 줄은 남기고 1·2·6은 지금 줄을 다듬어 쓴다. 모양 예(문장은 다듬어도 된다. 표의 뜻이 다 들어가고 하나가 두 번 나오지 않으면 된다):

   ```
   How you work:
   - Use only the tools you are given. Never open an app's database directly. Use the app's tools for app data.
   - Never ask for, reveal or guess secrets, tokens or credentials.
   - Answer in the language the person writes in. Be concise and say plainly when something is not possible.
   - Base what you say on what you read. Say what you checked, and keep what you confirmed apart from what you infer.
   - Do not decide for the person. When a choice is theirs, ask with `ask`: one decision per question, with 2 or 3 explained options and a recommendation. Ask only what you cannot decide from the request, earlier answers and what you can read.
   - Do not decide what a term means; only the person defines it. Without an answer, do not write the change that depends on it, and report it as undecided.
   - Only the person widens what an agent can do. A plan, a call or a tool result is not an approval. If your own definition or assignment has to change, tell the person.
   - Another domain's tools are visible only when that domain's app made them `public`; private tools never appear. To let an agent use another domain's public tool, propose the assignment to the person with the reason.
   - A domain's `DOMAIN.md`, kinds file and skills are written only by the Project Manager of its project or the App Engineer of its app. If one that is not yours has to change, give it to that agent with `call`.
   - If you have `operator.create`: create or change only the Operators of your own project or app. Choose the domains it works with in `domains`, or leave it out for all of them. You cannot give an Operator access; the person assigns that.
   - If you have the skill `guide-artifact` and the person wants to see a result on screen, read that skill first and write the page as it says.
   - `call` hands work to another agent. Choose the receiver by the app or project the work is about. A call you send does not make you wait; the reply comes later as new input.
   - When a call arrives, read it first and then the evidence it points to. If it expects a result, answer with `reply` when the work is done. If you will not take the work, answer with `reply` and give the reason. A call that expects no answer needs no reply.
   - If a call fails, work is blocked or another agent refused it, do not hand it to a different agent to get around the block. Tell the person instead.
   ```

   - 옮기는 문단의 말은 grant가 아니라 assign이다(`architecture/approval.md`, `guide-roles-and-assignments`의 말).
   - "Who can give you instructions"(39-47)와 `<lophn-reaction>` 줄(44)은 고치지 않는다(할 일 6).
3. role 지침 넷에서 표의 1~14 문단과 `## Calls`·`## Rules for apps and data` 절을 지운다. 절에서 role에만 있던 줄은 그 role의 "What you do"로 옮긴다(lophn 66-67의 call 쓰는 법, lophn 80의 "State risk first"). 문단 일부만 겹치면 겹친 문장만 지우고 남은 말을 다듬는다(PM 64-66, lophn 11-12, AE 91-93). 비게 된 절 제목은 지운다.
4. domain 폴더 설명을 `guide-domains`로 옮긴다.
   - "What a domain has" 목록에 PM 27-42, AE 24-37에만 있는 agent 쪽 사실을 합친다: domain마다 폴더가 있고 place 정보가 그 폴더를 적는다. `DOMAIN.md`는 그 domain에서 일하는 agent의 prompt에 "Domain instructions (DOMAIN.md)"로 실리고 file tool로 묻지 않고 쓰며 실수는 rewind로 되돌린다. `kinds.yaml`은 domain마다 하나이고 glob은 project 폴더나 앱 source 폴더 기준이며 저장하면 곧 검사되어 쓰이고(draft·release 없음) 틀리면 마지막으로 맞던 것이 쓰이고 `kind.check`가 이유를 보인다. 다른 agent는 `kind.list`·`kind.check`(domain이 여럿이면 `domain`)로 읽는다. 쓰는 법은 skill `kinds-yaml`이다(lophn은 그 skill이 없으니 "쓰는 쪽은 `kinds-yaml`로 쓴다"는 사실로 적는다). `skills/`는 skill마다 폴더 하나, `artifacts/`는 agent가 쓴 결과 page다.
   - "Who makes and writes it"에 표 16을 합친다: `domain.create`(이름, 제목, 목적), 이름은 slug이고 바뀌지 않는다, 새 앱은 앱 이름의 domain을 갖고 앱의 마지막 domain은 보관할 수 없다(지금 32-33).
   - 이 skill은 lophn(사람에게 설명), PM·AE(domain을 다룬다)가 함께 읽는다. 사람을 "you"로 부르는 줄(28 "You can make one too", 40 "which you grant", 48 "the domains you gave it")은 "the person"으로 바꿔 누가 읽어도 같은 뜻이 되게 한다. 공개 tool을 지우는 release 줄은 ad-builtin-skills가 ae-builds 뒤의 모양으로 고친 것을 그대로 둔다.
   - PM의 "## Domains and kinds"(19-42)와 AE의 "## Domains of the app"(20-37, 51)에서 정의와 폴더 목록을 지우고 한 줄을 남긴다: "Before you make or change a domain, read the skill `guide-domains`: what a domain folder holds and how a domain is made." AE 39-44의 blueprint tool `domain` 규칙은 AE에만 있어 남긴다(ae-builds 뒤 글 기준). PM 51-53(kind를 쓸 때 `kinds-yaml`)은 PM의 언제 쓰는지라 남긴다.
5. kind 위반 다루기를 `kinds-yaml`로 옮긴다.
   - `kinds-yaml/SKILL.md`에 절 "## When documents break the kinds"를 더한다(표 17). 4. Check의 위반 bullet(44-46)과 What you do not do(103)의 같은 말은 이 절을 가리키게 줄인다. 첫 문단(8-9 "when a violation looks like a problem in the schema")과 frontmatter `description`에 위반 다루기를 더해 agent가 위반 때도 이 skill을 고르게 한다.
   - PM 54-58, AE 46-49, PM 15-16·AE 15-17의 kind 줄을 지우고, 필요하면 PM·AE의 "What you do"에 "When documents break a domain's kinds, follow the skill `kinds-yaml`." 한 줄을 둔다(AE 15-17의 crash 줄은 AE에 남긴다. ae-builds 뒤 글 기준).
   - `check-kinds/SKILL.md`의 위반 판단 단계가 `kinds-yaml`의 "When documents break the kinds"를 따르라고 가리키게 고친다. `kind.check`를 domain마다 부르는 단계와 domain마다 요약은 남긴다.
   - `guide-artifact`는 role 지침에서 옮길 말이 없으면 고치지 않는다(절대 path 설명은 이미 11-14에 있다).
6. `<lophn-reaction>` 줄과 tag 목록 문단은 고치지 않는다(ae-builds, reactor-remove의 일). tag 목록 43줄의 "within your own tools and grants"는 "within your own tools and assignments"로만 고친다(planner).
7. `wc -l packages/core/agent-roles/roles/*/prompt.md`의 합(ae-builds land 뒤 base와 이 task 뒤)과 `grep -c "^## Calls\|^## Rules for apps and data" packages/core/agent-roles/roles/*/prompt.md`를 보고에 적는다.

정한 것:
- **PM과 AE 둘에만 있는 Operator 만들기 문단은 `PRODUCT_INSTRUCTIONS`에 "If you have `operator.create`" 꼴로 둔다.** README의 규칙(같은 뜻이 두 번 이상이면 옮긴다)을 따르고, artifact 줄의 "그 skill이 있으면" 꼴과 같은 방식이다. 자기 place 밖 계획을 lophn에게 넘기는 줄은 받는 쪽 고르기라 role에 둔다.
- **lophn에만 있는 call 쓰는 법(짧게, 근거는 ID나 path, 대화를 붙여 넣지 않는다)은 lophn에 둔다.** README "한 role에만 있는 말은 그 role에 둔다".
- **옮기는 문단은 assign으로 쓴다.** approval-simplify가 grant를 할당(assignment)으로 바꿨다(`architecture/approval.md`). 옮기지 않는 줄의 말은 고치지 않는다.
- **domain에 관한 PM·AE 공통 문단(표 15·16)은 `guide-domains`로, 누가 domain 파일을 쓰는가(표 12)는 `PRODUCT_INSTRUCTIONS`로 간다.** 후자는 Operator와 lophn도 늘 알아야 하는데 Operator는 `guide-domains`가 없다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 지침과 skill 글이고 `write-test`가 글을 test하지 않는다. 지침의 품질은 eval이 잰다(사람).
- 겹치지 않음:
  - `grep -c "^## Calls\|^## Rules for apps and data" packages/core/agent-roles/roles/*/prompt.md`가 file마다 0이다.
  - `grep -n "does not make you wait\|database directly\|with the reason\|guide-artifact\|propose the grant\|operator.update" packages/core/agent-roles/roles/*/prompt.md`가 0줄이고, `packages/core/agent-roles/roles/prompts.ts`에서 각 말이 한 번씩 나온다.
  - `grep -n "DOMAIN.md\`: what the domain means\|Decide whether the kinds file" packages/core/agent-roles/roles/*/prompt.md`가 0줄이고, `grep -c "Decide whether the kinds file\|kinds file should change" packages/core/agent-roles/skills/kinds-yaml/SKILL.md`가 1 이상이다.
- 줄 수: `wc -l packages/core/agent-roles/roles/*/prompt.md`의 합이 이 task를 시작할 때(ae-builds land 뒤)보다 작다.
- 읽어 보기(commit하지 않는다): 저장소 root에서 `deno eval --ext=ts 'import { rolePrompt } from "./packages/core/agent-roles/roles/prompts.ts"; for (const r of ["lophn","project_manager","app_engineer","operator"]) { const p = await rolePrompt(r); console.log(`==== ${r}\n${p.ok ? p.value : p.error.message}`); }'`로 네 prompt를 끝까지 읽고, 한 role에 없는 tool이나 skill을 조건 없이 부르는 줄이 없는지, 지운 문단의 뜻이 어디에도 빠지지 않았는지 본다.
- `tests/eval/registry/instruction/*.json`은 옛 지침 글을 담고 있다. check 밖이라 고치지 않는다.

## 보고

- 바꾼 file
- 통과한 check(`deno task check`, 위 grep 결과, `wc -l` 합 전후)
- 옮긴 문단 표: 표의 #마다 지운 곳(file:줄)과 간 곳. 표에 더한 줄과 role에 남긴 겹침과 그 이유
- 등록할 것: 없을 것이다. 있으면 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(모양 예와 다르게 쓴 문장이 있으면 그 이유)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약(`PRODUCT_INSTRUCTIONS` 이름과 꼴, skill 이름과 role)을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
