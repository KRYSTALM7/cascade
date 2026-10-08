import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { ConsequenceReport, GraphNode } from "../api/types";
import { NODE_HEIGHT, NODE_WIDTH, edgeLabel, fitViewport, layoutBounds, layoutGraph, nodeMoneyOut } from "../graph/layout";
import { agentName, agentStyle, inr, toolTitle } from "../lib/format";

type CascadeNode = Node<{ node: GraphNode }, "cascade">;

const STATUS_BADGE: Record<GraphNode["status"], { text: string; style: string }> = {
  WILL_EXECUTE: { text: "✓ Allowed", style: "bg-emerald-500/15 text-emerald-200 ring-emerald-400/40" },
  BLOCKED: { text: "BLOCKED", style: "bg-rose-500/20 text-rose-200 ring-rose-400/50" },
  WOULD_FAIL: { text: "WOULD FAIL", style: "bg-orange-500/20 text-orange-200 ring-orange-400/50" },
  SKIPPED_LIMIT: { text: "NOT EXPLORED", style: "bg-slate-500/20 text-slate-300 ring-slate-400/40" },
};

/** Everything technical about a node, for the hover tooltip (the node face stays plain). */
function nodeTooltip(node: GraphNode): string {
  const lines = [node.trigger_reason, node.summary];
  if (node.rule_id) lines.push(`Rule: ${node.rule_id}@${node.rule_version ?? "?"}`);
  if (node.trigger_event) lines.push(`Event: ${node.trigger_event}`);
  if (node.trigger_condition) lines.push(`Condition: ${node.trigger_condition}`);
  if (node.authorization) lines.push(`Authorization: ${node.authorization.message}`);
  if (node.status_message) lines.push(node.status_message);
  return lines.filter(Boolean).join("\n");
}

function CascadeNodeView({ data }: NodeProps<CascadeNode>) {
  const { node } = data;
  const style = agentStyle(node.agent_id);
  const money = nodeMoneyOut(node);
  const badge = STATUS_BADGE[node.status];
  const muted = node.status !== "WILL_EXECUTE";
  const root = node.trigger_type === "ROOT";
  const auth = node.authorization;
  return (
    <div
      data-testid={`graph-node-${node.id}`}
      data-status={node.status}
      data-trigger={node.trigger_type}
      className={`w-[230px] rounded-xl border px-3 py-2 shadow-lg ${root ? "bg-sky-950/90 ring-2 ring-sky-400/50" : "bg-slate-900/95"} ${
        node.status === "BLOCKED" ? "border-rose-500/70 border-dashed" : muted ? "border-orange-400/60 border-dashed" : "border-slate-700"
      }`}
      style={{ borderLeft: `4px solid ${style.color}` }}
      title={nodeTooltip(node)}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-500" />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold" style={{ color: style.color }}>
          {agentName(node.agent_id)}
        </span>
        {money && (
          <span data-testid="money-badge" className="shrink-0 rounded-md bg-amber-400/15 px-1.5 py-0.5 font-mono text-[11px] text-amber-200 ring-1 ring-amber-400/40">
            −{inr(money)}
          </span>
        )}
      </div>
      <div data-testid="node-role" className={`text-[10px] font-medium ${root ? "text-sky-300" : "text-violet-300"}`}>
        {root ? "proposed this action" : "reacted & proposed"}
      </div>
      <div className={`mt-0.5 font-medium ${muted ? "text-slate-400 line-through decoration-slate-500/60" : "text-slate-100"}`}>{toolTitle(node.tool_id)}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold">
        <span
          data-testid={auth?.granted && node.status === "WILL_EXECUTE" ? "node-auth" : "node-status"}
          className={`rounded px-1.5 py-0.5 ring-1 ${badge.style}`}
        >
          {badge.text}
        </span>
        {!node.required && <span className="rounded px-1.5 py-0.5 text-slate-300 ring-1 ring-slate-500/50">optional</span>}
      </div>
      {node.status_code && <div className="truncate font-mono text-[10px] text-rose-300">{node.status_code}</div>}
      <Handle type="source" position={Position.Right} className="!bg-slate-500" />
    </div>
  );
}

function LegendNode({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={`inline-block h-3 w-5 rounded ${className}`} />
      {label}
    </span>
  );
}

/** What the shapes and colours mean, for a judge seeing the graph for the first time. */
export function GraphLegend() {
  return (
    <div role="list" aria-label="Graph legend" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400">
      <span role="listitem"><LegendNode className="bg-sky-950 ring-2 ring-sky-400/60" label="Proposed action" /></span>
      <span role="listitem"><LegendNode className="border-l-4 border-l-amber-400 bg-slate-900 ring-1 ring-slate-700" label="Agent reacted & proposed its own action" /></span>
      <span role="listitem" className="flex items-center gap-1.5">
        <span aria-hidden className="font-mono text-slate-500">→</span> Event that triggered it
      </span>
      <span role="listitem" className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-200 ring-1 ring-emerald-400/40">✓ Allowed</span>
      <span role="listitem" className="rounded border border-dashed border-rose-500/70 px-1.5 py-0.5 font-semibold text-rose-200">Blocked / would fail</span>
      <span role="listitem" className="rounded px-1.5 py-0.5 text-slate-300 ring-1 ring-slate-500/50">optional</span>
      <span role="listitem" className="rounded-md bg-amber-400/15 px-1.5 py-0.5 font-mono text-amber-200 ring-1 ring-amber-400/40">−₹ money leaves</span>
    </div>
  );
}

const nodeTypes = { cascade: CascadeNodeView };

function usePaneSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function ConsequenceGraph({ report }: { report: ConsequenceReport }) {
  const paneRef = useRef<HTMLDivElement>(null);
  const pane = usePaneSize(paneRef);
  const { nodes, edges, bounds } = useMemo(() => {
    const positioned = layoutGraph(report.nodes, report.edges);
    const bounds = layoutBounds(positioned);
    const flowNodes: CascadeNode[] = positioned.map(({ node, x, y }) => ({
      id: node.id,
      type: "cascade",
      position: { x, y },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: { node },
      draggable: false,
    }));
    const flowEdges: Edge[] = report.edges.map((edge, i) => {
      const special = edge.kind !== "TRIGGER";
      const target = report.nodes.find((n) => n.id === edge.target);
      const dead = target ? target.status !== "WILL_EXECUTE" : false;
      return {
        id: `e${i}-${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        label: edgeLabel(edge),
        animated: !special && !dead,
        style: { stroke: special ? "#f59e0b" : dead ? "#64748b" : "#94a3b8", strokeDasharray: special || dead ? "6 4" : undefined },
        labelStyle: { fill: "#cbd5e1", fontSize: 11 },
        labelBgStyle: { fill: "#0f172a" },
        labelBgPadding: [4, 2] as [number, number],
        markerEnd: { type: MarkerType.ArrowClosed, color: special ? "#f59e0b" : "#94a3b8" },
      };
    });
    return { nodes: flowNodes, edges: flowEdges, bounds };
  }, [report]);

  return (
    <div ref={paneRef} data-testid="consequence-graph" className="h-[460px] w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        style={{ "--xy-background-color": "transparent" } as CSSProperties}
        viewport={fitViewport(bounds, pane.width, pane.height)}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        minZoom={0.2}
      >
        <Background gap={24} color="#1e293b" />
      </ReactFlow>
      <ul className="sr-only" aria-label="Consequence steps">
        {report.nodes.map((n) => (
          <li key={n.id}>
            {n.agent_id} {n.tool_id} {n.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
