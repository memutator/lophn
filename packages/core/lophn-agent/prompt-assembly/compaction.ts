// 요약 request의 크기 계산이다. compact 실행은 session/compactor가 한다.

// 요약 출력 상한은 예산 10%와 4,000 중 작은 값이다(예산 20,000 → 2,000).
export function summaryOutputCap(inputBudget: number): number {
  return Math.min(Math.floor(inputBudget / 10), 4000);
}
