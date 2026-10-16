# written: app-releases, app-data, app-packages

분류표: `triage/apps-1.md`, `apps-2.md`, `apps-3.md`, `coding-1.md`, `coding-2.md`, `deferred-to-apps-coding.md`. 모든 요구는 `proposed`다.

## core-app-releases.yaml (req-0800 ~ req-0832, 33개)

| 새 ID | 분류표 줄 |
|---|---|
| req-0800 | blueprint R3 |
| req-0801 | blueprint R8 |
| req-0802 | connections R1a |
| req-0803 | blueprint R16b |
| req-0804 | blueprint R17 |
| req-0805 | blueprint R18a |
| req-0806 | releases R1a |
| req-0807 | releases R1b |
| req-0808 | releases R4 |
| req-0809 | releases R17 |
| req-0810 | sdk R10 |
| req-0811 | sdk R34 |
| req-0812 | releases R2 (source 읽기와 bundle 내용 중 앞 절반) |
| req-0813 | releases R2 (credential, agent 도구, 임시 설정 절반) + guides R19 (합침) |
| req-0814 | releases R3a |
| req-0815 | releases R3b |
| req-0816 | releases R19 |
| req-0817 | releases R5 + mcp-server R21b + mcp-server R20b (합침) |
| req-0818 | tests R6 |
| req-0819 | tests R7 + problem-codes R8 + problem-codes R9 (합침) |
| req-0820 | tests R8 |
| req-0821 | tests R9 (automation 실행 범위 검사는 뺐다) |
| req-0822 | releases R18 |
| req-0823 | releases R6 (ask) |
| req-0824 | releases R7 (ask) |
| req-0825 | releases R8 + mcp-server R21d (합침) |
| req-0826 | releases R9 |
| req-0827 | releases R10 |
| req-0828 | releases R12 |
| req-0829 | releases R13a |
| req-0830 | releases R14 |
| req-0831 | releases R15a |
| req-0832 | releases R16 |

## core-app-data.yaml (req-0950 ~ req-0961, 12개. req-0029는 그대로)

| 새 ID | 분류표 줄 |
|---|---|
| req-0950 | data R1 |
| req-0951 | data R3 |
| req-0952 | data R4 |
| req-0953 | data R5 |
| req-0954 | data R10b |
| req-0955 | data R6a |
| req-0956 | data R6b |
| req-0957 | data R7 |
| req-0958 | data R8 |
| req-0959 | data R9 |
| req-0960 | data R11 |
| req-0961 | data R12 + releases R15b (합침) |

## core-app-packages.yaml (req-1000 ~ req-1008, 9개, `interfaces: [package-spi]`)

| 새 ID | 분류표 줄 |
|---|---|
| req-1000 | sdk R2 |
| req-1001 | sdk R3 |
| req-1002 | sdk R6 (목록 조회는 R3 쪽에 두고 사용처만 남겼다) |
| req-1003 | sdk R7 (정확한 SemVer 부분) |
| req-1004 | sdk R7 (bundle 의존의 내용 hash 부분) |
| req-1005 | sdk R8 (subject package-spi) |
| req-1006 | sdk R12 (subject package-spi) |
| req-1007 | sdk R9 |
| req-1008 | sdk R11 |

## 합치거나 나눈 것

- 합침: releases R5 + mcp-server R21b + mcp-server R20b, releases R8 + mcp-server R21d, tests R7 + problem-codes R8 + problem-codes R9, data R12 + releases R15b, releases R2(뒤 절반) + guides R19.
- 나눔: releases R2 -> req-0812, req-0813. sdk R7 -> req-1003, req-1004.
- sdk R34는 운영에서 build·다운로드를 하지 않는다는 부분을 sdk R10(req-0810)과 releases R4(req-0808)가 덮어 import 제한만 남겼다.
- tests R8은 app-releases로 썼다(분류표가 app-releases 또는 app-data로 적었다).
- 분류표 줄을 뺀 것은 없다.

| req-0833 | req-0819에서 lead가 나눔(앱의 예외 수집·redaction 경로 갖추기) |
