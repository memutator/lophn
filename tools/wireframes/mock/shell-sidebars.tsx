// shell 틀 gallery page의 sidebar 자리 그림. 오른쪽 sidebar의 진짜 모양은 right task가 그린다.
const row = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-4)",
  minHeight: "var(--control-sm-height)",
  padding: "var(--space-1) var(--space-3)",
  color: "var(--color-text-secondary)",
  fontSize: "var(--type-small-size)",
} as const;

export function MockRightSidebar({ title }: { title: string }) {
  return (
    <>
      <div
        style={{
          ...row,
          paddingInlineStart: "var(--space-3)",
          color: "var(--color-text-primary)",
          fontWeight: "var(--font-weight-semibold)",
        }}
      >
        {title}
      </div>
      {["body/", "gaze/", "README.md", "package.json"].map((name) => (
        <div key={name} style={row}>
          {name}
        </div>
      ))}
    </>
  );
}
