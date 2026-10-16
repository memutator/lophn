# written: app-runtime

`requirements/core-app-runtime.yaml` req-0850 ~ req-1269 (120개). subject는 app-runtime, app-capability-api, app-direct-protocol. 분류표 줄 이름은 `묶음 R번호`이고, `mcp-server`는 coding-1, `responsiveness`·`identity`·`security`는 server-supervision, `approvals`는 approvals-config, `secrets`·`sdk`는 각 분류표의 줄이다.

| 새 ID | 분류표 줄 |
|---|---|
| req-0850 | runtime R1; releases R13b |
| req-0851 | runtime R2a |
| req-0852 | runtime R2b |
| req-0853 | runtime R3a |
| req-0854 | runtime R23; permissions R19 |
| req-0855 | runtime R7; runtime R24a |
| req-0856 | runtime R4b; permissions R4; security R3 |
| req-0857 | permissions R18 |
| req-0858 | permissions R23 |
| req-0859 | permissions R1 |
| req-0860 | permissions R2 |
| req-0861 | permissions R3 |
| req-0862 | permissions R5 |
| req-0863 | permissions R6 |
| req-0864 | permissions R7 |
| req-0865 | permissions R8; permissions R10a |
| req-0866 | permissions R12 |
| req-0867 | permissions R9 |
| req-0868 | permissions R10b |
| req-0869 | permissions R11 |
| req-0870 | security R9 |
| req-0871 | permissions R24 |
| req-0872 | permissions R14; secrets R10 |
| req-0873 | permissions R20; permissions R29 앞 |
| req-0874 | permissions R21; permissions R29 뒤 |
| req-0875 | permissions R22 |
| req-0876 | permissions R27 |
| req-0877 | permissions R28 |
| req-0878 | blueprint R7a |
| req-0879 | blueprint R7b |
| req-0880 | runtime R5a |
| req-0881 | sdk R22 |
| req-0882 | sdk R23 |
| req-0883 | runtime R5b |
| req-0884 | runtime R6 |
| req-0885 | runtime R9a |
| req-0886 | runtime R9b |
| req-0887 | runtime R10; invocations R1; responsiveness R2; mcp-server R29e; connections R4 뒤 |
| req-0888 | runtime R11a |
| req-0889 | runtime R11b |
| req-0890 | runtime R12; connections R6 일부 |
| req-0891 | runtime R31b |
| req-0892 | runtime R31a; preview R7a |
| req-0893 | invocations R2a |
| req-0894 | invocations R3; preview R7b 기록 부분 |
| req-0895 | invocations R4a |
| req-0896 | invocations R4b |
| req-0897 | invocations R5 |
| req-0898 | invocations R6a |
| req-0899 | invocations R6b |
| req-0900 | invocations R10 |
| req-0901 | invocations R11 |
| req-0902 | invocations R12b |
| req-0903 | invocations R13 |
| req-0904 | invocations R16 |
| req-0905 | invocations R17a |
| req-0906 | invocations R19b |
| req-0907 | invocations R19c |
| req-0908 | invocations R19d |
| req-0909 | invocations R7a |
| req-0910 | invocations R7c; approvals R8c |
| req-0911 | invocations R8a |
| req-0912 | invocations R8b |
| req-0913 | invocations R9 |
| req-0914 | invocations R19a |
| req-0915 | connections R1b; permissions R26 앞 |
| req-0916 | connections R2a; permissions R26 뒤; sdk R40 앞 |
| req-0917 | connections R2b |
| req-0918 | connections R3a |
| req-0919 | connections R4 앞 |
| req-0920 | sdk R40 뒤 |
| req-0921 | connections R5c; identity R9b |
| req-0922 | connections R6 |
| req-0923 | connections R7a |
| req-0924 | connections R7b |
| req-0925 | runtime R13a |
| req-0926 | runtime R14 |
| req-0927 | runtime R15a |
| req-0928 | runtime R15b |
| req-0929 | runtime R16 |
| req-0930 | runtime R17a |
| req-0931 | runtime R18 |
| req-0932 | runtime R20 |
| req-0933 | runtime R19a |
| req-0934 | runtime R19b |
| req-0935 | runtime R22 |
| req-0936 | runtime R28 |
| req-0937 | runtime R25a |
| req-0938 | runtime R25b |
| req-0939 | runtime R29 |
| req-0940 | runtime R26a |
| req-0941 | runtime R26b |
| req-0942 | runtime R26c |
| req-0943 | runtime R27a |
| req-0944 | runtime R27b |
| req-0945 | preview R1 |
| req-0946 | preview R2; mcp-server R20c |
| req-0947 | preview R3 |
| req-0948 | preview R4 |
| req-0949 | preview R5 |
| req-1250 | preview R7b |
| req-1251 | preview R9 |
| req-1252 | preview R10 |
| req-1253 | blueprint R12 |
| req-1254 | automations R1 |
| req-1255 | automations R2a |
| req-1256 | automations R4; runtime R3c |
| req-1257 | automations R6 |
| req-1258 | automations R8a; automations R11 |
| req-1259 | automations R9 |
| req-1260 | automations R10 |
| req-1261 | invocations R2b |
| req-1262 | automations R12 |
| req-1263 | automations R13 |
| req-1264 | preview R6 |
| req-1265 | agent-context R2 |
| req-1266 | agent-context R3 |
| req-1267 | agent-context R4 |
| req-1268 | agent-context R5 |
| req-1269 | agent-context R6 |

## 합친 것

- runtime R10, invocations R1, responsiveness R2, mcp-server R29e, connections R4(뒤쪽): 일반 호출이 core와 기록 저장을 지나지 않고 직접 간다는 같은 보장 하나(app-direct-protocol).
- runtime R1, releases R13b: 같은 DB에 process 둘이 쓰지 않는다.
- runtime R7, R24a: 앱 process에 token과 secret이 넘어가지 않는다.
- runtime R23, permissions R19: 운영 앱은 준비된 코드와 고정 SDK만 쓴다.
- runtime R4b, permissions R4, security R3: 앱의 기본 접근 범위.
- permissions R14, secrets R10: 승인된 secret은 호출자 종류로 막지 않는다.
- permissions R8, R10a: network 접근 단위.
- permissions R20, R29(앞쪽): 승인 변경 때 막고, 종료 확인 뒤 새 범위로 다시 시작. permissions R21, R29(뒤쪽): 요청 접수와 적용 완료를 구별해 알림.
- permissions R26 + connections R1b, R2a: 방향 있는 허락(R1b+R26 앞쪽)과 교집합 범위(R2a+R26 뒤쪽)로 나눠 합쳤다.
- connections R5c, identity R9b: 허락이 위임되거나 합쳐지지 않는다.
- invocations R7c, approvals R8c: 같은 접수를 다시 보내면 기존 접수만 돌려준다.
- runtime R12, connections R6(자동 재호출 금지 부분): 결과 모름 표시와 쓰기 자동 재호출 금지. connections R6의 나머지(대상 앱이 멈춰도 다른 일은 계속)는 따로 썼다.
- runtime R31a, preview R7a: view session 분리.
- preview R2, mcp-server R20c: preview가 운영 자료를 바꾸지 않는다.
- sdk R40: 선언하고 허락받은 연결로만 부른다는 부분은 connections R2a 요구에, 부른 앱과 부모 호출 문맥 전달은 따로 쓴 요구에 나눠 담았다.
- preview R7b: 응답의 운영/preview 구분은 따로 쓰고, 기록의 구분은 invocations R3 요구가 덮는다.
- automations R4, runtime R3c: automation이 시작할 수 있는 조건.
- automations R8a, R11: automation 호출은 자동으로 다시 시도하지 않는다.
