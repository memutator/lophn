// pairing code의 QR. module을 path 하나로 그린다(innerHTML을 쓰지 않는다).
import { useMemo } from "react";
import { encode } from "uqr";

import styles from "./remote.module.css";

export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(text, { ecc: "M", border: 2 });
    const parts: string[] = [];
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
      }),
    );
    return { size: qr.size, path: parts.join("") };
  }, [text]);
  // QR은 theme을 따르지 않고 늘 흰 바탕에 검은 점이다. 어두운 바탕의 뒤집힌 QR을 못 읽는 scanner가 있다.
  return (
    <svg
      className={styles.qr}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      data-remote-qr=""
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
