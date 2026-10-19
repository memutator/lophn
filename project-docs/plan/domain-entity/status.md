# 상태

lead만 고친다. `tools/status.py domain-entity build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `de-domain-core` | domain-core | 1 | 없음 | running | domain-core/de-domain-core |  | 띄우기 전에 lead가 packages/core/domains/mod.ts와 catalog 항목 commit |
| `de-drafts` | drafts | 1 | 없음 | running | drafts/de-drafts |  |  |
| `de-place-restore` | place-restore | 1 | 없음 | running | place-restore/de-place-restore |  |  |
| `de-tool-domain` | tool-domain | 1 | 없음 | merged | tool-domain/de-tool-domain | ecbfd090e |  |
| `de-app-domains` | apps | 2 | de-apps-storage | todo |  |  |  |
| `de-apps-storage` | apps | 2 | 없음 | todo |  |  |  |
| `de-public-tools` | apps | 2 | de-apps-storage, de-routing-events | todo |  |  |  |
| `de-kinds-domain` | domain-kinds | 2 | de-routing-events, de-turn-domains | todo |  |  |  |
| `de-agents-domains` | harness | 2 | 없음 | todo |  |  |  |
| `de-tool-filter` | harness | 2 | 없음 | todo |  |  |  |
| `de-turn-domains` | harness | 2 | 없음 | todo |  |  |  |
| `de-roles-core` | roles | 2 | 없음 | todo |  |  |  |
| `de-roles-text` | roles | 2 | 없음 | todo |  |  |  |
| `de-coding-routing` | routing | 2 | 없음 | todo |  |  |  |
| `de-routing-events` | routing | 2 | 없음 | todo |  |  |  |
| `de-shell-agents` | shell | 2 | 없음 | todo |  |  |  |
| `de-shell-app-space` | shell | 2 | 없음 | todo |  |  |  |
| `de-shell-artifact-data` | shell | 2 | de-routing-events | todo |  |  |  |
| `de-apps-unbind` | apps | 3 | 없음 | todo |  |  |  |
| `de-place-info` | roles | 3 | 없음 | todo |  |  |  |
| `de-names-tool` | names | 4 | 없음 | todo |  |  |  |
| `de-final` | final | 5 | de-shell-domain-list, de-shell-operator-domains, de-shell-artifact-domain | todo |  |  |  |
| `de-shell-artifact-domain` | shell-domains | 5 | 없음 | todo |  |  | 사람이 de-drafts의 모양을 고른 뒤 띄운다(brief의 고른 모양 줄을 채운다) |
| `de-shell-domain-list` | shell-domains | 5 | 없음 | todo |  |  | 사람이 de-drafts의 모양을 고른 뒤 띄운다(brief의 고른 모양 줄을 채운다) |
| `de-shell-operator-domains` | shell-domains | 5 | 없음 | todo |  |  | 사람이 de-drafts의 모양을 고른 뒤 띄운다(brief의 고른 모양 줄을 채운다) |
