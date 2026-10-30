// 앱 view 위 층의 화면 문구. preload는 packages/design/i18n을 읽지 못해 여기 한 곳에 모은다.
export const labels = {
  notePlaceholder: "Add a note",
  noteHint: "Notes stay here until you send them all.",
  noteAria: (n: number) => `Note for annotation ${n}`,
} as const;
