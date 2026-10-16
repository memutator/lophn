# written: sdk

`requirements/sdk.yaml` req-0500 ~ req-0510 (11개). subject는 모두 `sdk`이고 `interfaces` 칸은 없다.

| 새 ID | 분류표 줄 |
|---|---|
| req-0500 | sdk R5 |
| req-0501 | sdk R24a |
| req-0502 | sdk R24b |
| req-0503 | sdk R24c |
| req-0504 | sdk R31 (preview 대역 부분은 뺐다. 아래 참고) |
| req-0505 | sdk R26 |
| req-0506 | sdk R29 (template 배치 부분은 뺐다. 아래 참고) |
| req-0507 | reporting R13a |
| req-0508 | reporting R13b |
| req-0509 | reporting R16a |
| req-0510 | reporting R16c |

## 합치거나 뺀 것

- 합친 줄은 없다. 11줄이 각각 다른 보장이다.
- sdk R31의 "preview에서 쓰는 대역": 분류표 확인 칸에 판정할 관찰이 없어 뺐다(acceptance에서 새 의무를 꺼내게 된다).
- sdk R29의 "앱 template로 만든 앱에 기본으로 오류 경계가 놓인다": template 소유가 apps이고 분류표가 sdk R33과 같이 정리하라고 했으므로 뺐다.
- sdk R31은 새 secrets 모델에서 앱 secret 쓰기가 어떻게 남는지 secrets 묶음의 결정과 맞춰야 한다(분류표 이유 칸).
- sdk R5는 앱 정의 검사 계약을 app-releases와 맞춰야 한다(분류표 이유 칸).
