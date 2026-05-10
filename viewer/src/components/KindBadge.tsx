import { useT } from "../i18n";
import { kindColor } from "../lib/format";

interface Props {
  kind: string;
  size?: "sm" | "md";
}

export function KindBadge({ kind, size = "sm" }: Props) {
  const t = useT();
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 uppercase tracking-wider",
        size === "sm" ? "text-[10px]" : "text-xs",
      ].join(" ")}
      style={{ color: kindColor(kind) }}
    >
      <span
        aria-hidden
        className="inline-block"
        style={{
          width: 6,
          height: 6,
          borderRadius: 1,
          background: kindColor(kind),
        }}
      />
      {t(`kind.${kind}`)}
    </span>
  );
}
