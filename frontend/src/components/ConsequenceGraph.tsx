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
import { agentStyle, humanTool, inr } from "../lib/format";

type CascadeNode = Node<{ node: GraphNode }, "cascade">;

const STATUS_BADGE: Record<GraphNode["status"], { text: string; style: string } | null> = {
  WILL_EXECUTE: null,
  BLOCKED: { text: "BLOCKED", style: "bg-rose-500/20 text-rose-200 ring-rose-400/50" },
  WOULD_FAIL: { text: "WOULD FAIL", style: "bg-orange-500/20 text-orange-200 ring-orange-400/50" },
  SKIPPED_LIMIT: { text: "NOT EXPLORED", style: "bg-slate-500/20 text-slate-300 ring-slate-400/40" },
};

function CascadeNodeView({ data }: NodeProps<CascadeNode>) {
  const { node } = data;
  const style = agentStyle(node.agent_id);
  const money = nodeMoneyOut(node);
  const badge = STATUS_BADGE[node.status];
  const muted = node.status !== "WILL_EXECUTE";
  return (
    <div
      data-testid={`graph-node-${node.id}`}
      data-status={node.status}
      className={`w-[230px] rounded-xl border bg-slate-900/95 px-3 py-2 shadow-lg ${
        node.status === "BLOCKED" ? "border-rose-500/70 border-dashed" : muted ? "border-orange-400/60 border-dashed" : "border-slate-700"
      }`}
      style={{ borderLeft: `4px solid ${style.color}` }}
      title={node.status_message ?? node.summary}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-500" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: style.color }}>
          {node.trigger_type === "ROOT" ? `${style.label} · proposed` : style.label}
        </span>
        {money && (
          <span data-testid="money-badge" className="rounded-md bg-amber-400/15 px-1.5 py-0.5 font-mono text-[11px] text-amber-200 ring-1 ring-amber-400/40">
            −{inr(money)}
          </span>
        )}
      </div>
      <div className={`mt-0.5 font-medium ${muted ? "text-slate-400 line-through decoration-slate-500/60" : "text-slate-100"}`}>
        {humanTool(node.tool_id)}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-slate-500">{node.rule_id ? `${node.rule_id}@${node.rule_version}` : "root action"}</span>
        {badge && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${badge.style}`}>{badge.text}</span>}
      </div>
      {node.status_code && <div className="mt-1 truncate font-mono text-[10px] text-rose-300">{node.status_code}</div>}
      <Handle type="source" position={Position.Right} className="!bg-slate-500" />
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
        labelStyle: { fill: "#cbd5e1", fontSize: 10, fontFamily: "ui-monospace, monospace" },
        labelBgStyle: { fill: "#0f172a" },
        labelBgPadding: [4, 2] as [number, number],
        markerEnd: { type: MarkerType.ArrowClosed, color: special ? "#f59e0b" : "#94a3b8" },
      };
    });
    return { nodes: flowNodes, edges: flowEdges, bounds };
  }, [report]);

  return (
    <div ref={paneRef} data-testid="consequence-graph" className="h-[400px] w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
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
