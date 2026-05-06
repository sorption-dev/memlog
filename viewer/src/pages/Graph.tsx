import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { useT } from "../i18n";
import { useTheme } from "../theme";
import { api } from "../lib/api";
import { kindColor } from "../lib/format";
import { KINDS } from "../lib/types";
import type { GraphData, GraphEdge, GraphNode, Kind, Relation } from "../lib/types";

/**
 * Canvas API can't resolve var(--color-*) strings — we read the live computed
 * values from the document root every time the theme flips. Cheap (one getter
 * call + N var lookups), triggers a graph re-render through React props.
 */
function resolveGraphColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim() || "#888";
  return {
    bg: v("--color-bg"),
    link: v("--color-ink-faint"),
    text: v("--color-ink-dim"),
    supersededOutline: v("--color-border-strong"),
    kind: Object.fromEntries(
      KINDS.map((k) => [k, v(`--color-kind-${k}`)]),
    ) as Record<Kind, string>,
  };
}

interface FGNode extends GraphNode {
  value?: number;
  color?: string;
}
interface FGLink {
  source: number;
  target: number;
  relation: string;
}
interface FGData {
  nodes: FGNode[];
  links: FGLink[];
}

export function GraphPage() {
  const t = useT();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<FGNode, FGLink> | undefined>(undefined);

  const [raw, setRaw] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hoveredNode, setHoveredNode] = useState<FGNode | null>(null);

  // Resolve theme-dependent canvas colors. Recomputed when `theme` changes
  // (useTheme's context flip causes re-render → useMemo re-resolves).
  const colors = useMemo(() => resolveGraphColors(), [theme]);

  const [activeKinds, setActiveKinds] = useState<Set<string>>(new Set(KINDS));
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [includeSuperseded, setIncludeSuperseded] = useState(false);

  useEffect(() => {
    void api
      .graph({ include_superseded: includeSuperseded })
      .then(setRaw)
      .catch((e) => setError((e as Error).message));
  }, [includeSuperseded]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data: FGData = useMemo(() => {
    if (!raw) return { nodes: [], links: [] };

    const degree = new Map<number, number>();
    for (const l of raw.links) {
      degree.set(l.from_id, (degree.get(l.from_id) ?? 0) + 1);
      degree.set(l.to_id, (degree.get(l.to_id) ?? 0) + 1);
    }

    const filteredNodes: FGNode[] = raw.nodes
      .filter((n) => activeKinds.has(n.kind))
      .filter((n) => !activeSession || n.session_id === activeSession)
      .map((n) => ({
        ...n,
        value: (degree.get(n.id) ?? 0) + 1,
        // Resolved color for canvas rendering (canvas can't parse var(...)).
        color: colors.kind[n.kind as Kind] ?? kindColor(n.kind),
      }));

    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks: FGLink[] = raw.links
      .filter((l) => nodeIds.has(l.from_id) && nodeIds.has(l.to_id))
      .map((l) => ({ source: l.from_id, target: l.to_id, relation: l.relation }));

    return { nodes: filteredNodes, links: filteredLinks };
  }, [raw, activeKinds, activeSession, colors]);

  const sessions = useMemo(() => {
    if (!raw) return [];
    const counts = new Map<string, number>();
    for (const n of raw.nodes) {
      const s = n.session_id ?? "(null)";
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }, [raw]);

  if (error) {
    return (
      <div className="px-10 py-16">
        <div className="font-mono text-xs uppercase text-[var(--color-danger)]">
          {t("common.error")}
        </div>
        <pre className="mt-3 text-sm text-[var(--color-ink-dim)] whitespace-pre-wrap">
          {error}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div ref={wrapRef} className="flex-1 relative bg-[var(--color-bg)]">
        {raw === null ? (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-[var(--color-ink-faint)]">
            {t("common.loading_graph")}
          </div>
        ) : data.nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-[var(--color-ink-faint)]">
            {t("graph.empty")}
          </div>
        ) : (
          <ForceGraph2D
            ref={fgRef}
            graphData={data}
            width={size.w}
            height={size.h}
            backgroundColor={colors.bg}
            nodeRelSize={4}
            nodeLabel={(n) => `#${(n as FGNode).id} · ${(n as FGNode).title}`}
            nodeVal={(n) => (n as FGNode).value ?? 1}
            nodeColor={(n) => (n as FGNode).color ?? "#888"}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const n = node as FGNode & { x?: number; y?: number };
              if (n.x === undefined || n.y === undefined) return;
              const r = Math.sqrt(n.value ?? 1) * 3;
              ctx.beginPath();
              ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
              ctx.fillStyle = n.color ?? "#888";
              ctx.fill();
              if (n.superseded) {
                ctx.strokeStyle = colors.supersededOutline;
                ctx.lineWidth = 1 / globalScale;
                ctx.stroke();
              }
              if ((n.value ?? 1) >= 3 && globalScale > 0.8) {
                ctx.font = `${11 / globalScale}px Geist, sans-serif`;
                ctx.fillStyle = colors.text;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                const label = n.title.length > 30 ? n.title.slice(0, 30) + "…" : n.title;
                ctx.fillText(label, n.x, n.y + r + 2);
              }
            }}
            linkColor={() => colors.link}
            linkWidth={0.6}
            linkDirectionalArrowLength={3}
            linkDirectionalArrowRelPos={1}
            linkLabel={(l) =>
              t(`relation.${(l as unknown as GraphEdge).relation as Relation}`)
            }
            onNodeHover={(n) => setHoveredNode(n as FGNode | null)}
            onNodeClick={(n) => navigate(`/entry/${(n as FGNode).id}`)}
            cooldownTicks={120}
          />
        )}

        {hoveredNode && (
          <div className="absolute bottom-4 left-4 right-4 md:right-auto md:max-w-md bg-[var(--color-surface-solid)] border border-[var(--color-border)] rounded-[3px] p-3 pointer-events-none">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
              #{hoveredNode.id} · {t(`kind.${hoveredNode.kind}`)}
              {hoveredNode.session_id ? ` · ${hoveredNode.session_id}` : ""}
            </div>
            <div className="mt-1 text-sm text-[var(--color-ink)]">{hoveredNode.title}</div>
          </div>
        )}
      </div>

      <aside className="w-64 shrink-0 border-l border-[var(--color-border)] p-5 flex flex-col gap-6 overflow-y-auto">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
            {t("graph.legend")}
          </div>
          <ul className="mt-2 flex flex-col gap-1 font-mono text-xs">
            {KINDS.map((k) => {
              const on = activeKinds.has(k);
              return (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveKinds((s) => {
                        const next = new Set(s);
                        if (next.has(k)) next.delete(k);
                        else next.add(k);
                        return next;
                      })
                    }
                    className={[
                      "flex items-center gap-2 w-full px-1.5 py-1 rounded-[3px] transition-colors text-left",
                      on
                        ? "text-[var(--color-ink)]"
                        : "text-[var(--color-ink-faint)] opacity-50",
                    ].join(" ")}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-[1px]"
                      style={{ background: kindColor(k) }}
                    />
                    <span className="uppercase tracking-wider">{t(`kind.${k}`)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {sessions.length > 0 && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
              {t("graph.session_filter")}
            </div>
            <ul className="mt-2 flex flex-col gap-0.5 font-mono text-xs">
              <li>
                <button
                  type="button"
                  onClick={() => setActiveSession(null)}
                  className={[
                    "flex items-baseline justify-between w-full px-1.5 py-1 rounded-[3px]",
                    activeSession === null
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]",
                  ].join(" ")}
                >
                  <span className="uppercase tracking-wider">{t("common.all")}</span>
                  <span className="tabular text-[var(--color-ink-faint)]">
                    {raw?.nodes.length ?? 0}
                  </span>
                </button>
              </li>
              {sessions.map(([s, n]) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveSession(
                        activeSession === s ? null : s === "(null)" ? null : s,
                      )
                    }
                    className={[
                      "flex items-baseline justify-between w-full px-1.5 py-1 rounded-[3px] text-left",
                      activeSession === s
                        ? "text-[var(--color-accent)]"
                        : "text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]",
                    ].join(" ")}
                  >
                    <span className="truncate pr-2">{s}</span>
                    <span className="tabular text-[var(--color-ink-faint)] shrink-0">
                      {n}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <label className="flex items-center gap-2 font-mono text-xs text-[var(--color-ink-dim)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeSuperseded}
              onChange={(e) => setIncludeSuperseded(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            <span className="uppercase tracking-wider">{t("graph.show_superseded")}</span>
          </label>
        </div>

        <div className="mt-auto font-mono text-[10px] text-[var(--color-ink-faint)] leading-relaxed">
          {t("graph.hint_size")}
          <br />
          {t("graph.hint_click")}
          <br />
          {t("graph.hint_hover")}
        </div>
      </aside>
    </div>
  );
}
