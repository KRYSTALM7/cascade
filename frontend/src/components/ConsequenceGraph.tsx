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
  WILL_EXECUTE: { text: "✓ Allowed", style: "bg-emerald-100 text-emerald-800 ring-emerald-300" },
  BLOCKED: { text: "BLOCKED", style: "bg-rose-100 text-rose-800 ring-rose-300" },
  WOULD_FAIL: { text: "WOULD FAIL", style: "bg-orange-100 text-orange-800 ring-orange-300" },
  SKIPPED_LIMIT: { text: "NOT EXPLORED", style: "bg-slate-100 text-slate-700 ring-slate-300" },
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

  // Agent color mapping
  const agentColors: Record<string, { color: string; darkColor: string }> = {
    "customer-support": { color: "#3B82F6", darkColor: "#1D4ED8" },
    crm: { color: "#8B5CF6", darkColor: "#6D28D9" },
    finance: { color: "#10B981", darkColor: "#047857" },
    inventory: { color: "#F59E0B", darkColor: "#B45309" },
  };

  const agentColor = agentColors[node.agent_id] || { color: style.color, darkColor: style.color };

  return (
    <div
      data-testid={`graph-node-${node.id}`}
      data-status={node.status}
      data-trigger={node.trigger_type}
      className={`w-[260px] rounded-xl border px-3 py-2.5 shadow-md bg-white ${
        root ? "ring-2 ring-indigo-600" : ""
      } ${
        node.status === "BLOCKED" ? "border-rose-400 border-dashed" : muted ? "border-orange-400 border-dashed" : "border-slate-300"
      }`}
      style={{ borderLeft: `4px solid ${agentColor.color}` }}
      title={nodeTooltip(node)}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-400" />
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: agentColor.color }} />
          <span className="truncate text-xs font-semibold" style={{ color: agentColor.darkColor }}>
            {agentName(node.agent_id)}
          </span>
        </div>
        {money && (
          <span data-testid="money-badge" className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] text-amber-800 ring-1 ring-amber-300">
            −{inr(money)}
          </span>
        )}
      </div>
      <div data-testid="node-role" className="text-[10px] font-medium text-slate-500 mt-0.5">
        {root ? "proposed this action" : "reacted & proposed"}
      </div>
      <div className={`mt-1 text-sm font-medium leading-snug ${muted ? "text-slate-500 line-through decoration-slate-400" : "text-slate-900"}`}>{toolTitle(node.tool_id)}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-semibold">
        <span
          data-testid={auth?.granted && node.status === "WILL_EXECUTE" ? "node-auth" : "node-status"}
          className={`rounded px-1.5 py-0.5 ring-1 ${badge.style}`}
        >
          {badge.text}
        </span>
        {!node.required && <span className="rounded px-1.5 py-0.5 text-slate-700 ring-1 ring-slate-300">optional</span>}
      </div>
      {node.status_code && <div className="truncate font-mono text-[10px] text-rose-700 mt-0.5">{node.status_code}</div>}
      <Handle type="source" position={Position.Right} className="!bg-slate-400" />
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
    <div>
      <div role="list" aria-label="Graph legend" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-slate-700">
        <span role="listitem"><LegendNode className="bg-white ring-2 ring-indigo-600" label="Proposed action" /></span>
        <span role="listitem"><LegendNode className="border-l-4 border-l-blue-500 bg-white ring-1 ring-slate-300" label="Agent reacted & proposed its own action" /></span>
        <span role="listitem" className="flex items-center gap-1.5">
          <span aria-hidden className="font-mono text-slate-500">→</span> Event that triggered it
        </span>
        <span role="listitem" className="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800 ring-1 ring-emerald-300">✓ Allowed</span>
        <span role="listitem" className="rounded border border-dashed border-rose-400 px-1.5 py-0.5 font-semibold text-rose-800">Blocked / would fail</span>
        <span role="listitem" className="rounded px-1.5 py-0.5 text-slate-700 ring-1 ring-slate-300">optional</span>
        <span role="listitem" className="rounded-md bg-amber-100 px-1.5 py-0.5 font-mono text-amber-800 ring-1 ring-amber-300">−₹ money leaves</span>
      </div>
      <div className="mt-2 text-xs text-slate-600 md:hidden">Drag to pan · pinch to zoom</div>
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
  const [viewMode, setViewMode] = useState<"list" | "graph">(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(min-width: 768px)").matches ? "graph" : "list";
    }
    return "graph";
  });

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
        style: { stroke: special ? "#f59e0b" : dead ? "#94a3b8" : "#475569", strokeWidth: 1.5, strokeDasharray: special || dead ? "6 4" : undefined },
        labelStyle: { fill: "#334155", fontSize: 12, fontWeight: 500 },
        labelBgStyle: { fill: "#ffffff", stroke: "#e2e8f0", strokeWidth: 1 },
        labelBgPadding: [4, 10] as [number, number],
        labelBgBorderRadius: 4,
        markerEnd: { type: MarkerType.ArrowClosed, color: special ? "#f59e0b" : "#94a3b8" },
      };
    });
    return { nodes: flowNodes, edges: flowEdges, bounds };
  }, [report]);

  const agentColors: Record<string, { color: string; darkColor: string }> = {
    "customer-support": { color: "#3B82F6", darkColor: "#1D4ED8" },
    crm: { color: "#8B5CF6", darkColor: "#6D28D9" },
    finance: { color: "#10B981", darkColor: "#047857" },
    inventory: { color: "#F59E0B", darkColor: "#B45309" },
  };

  // Build indentation map
  const depthMap = new Map<string, number>();
  const calculateDepth = (nodeId: string, visited = new Set<string>()): number => {
    if (depthMap.has(nodeId)) return depthMap.get(nodeId)!;
    if (visited.has(nodeId)) return 0;
    visited.add(nodeId);
    const incomingEdges = report.edges.filter(e => e.target === nodeId);
    if (incomingEdges.length === 0) {
      depthMap.set(nodeId, 0);
      return 0;
    }
    const depth = Math.max(...incomingEdges.map(e => calculateDepth(e.source, visited) + 1));
    depthMap.set(nodeId, Math.min(depth, 2));
    return depthMap.get(nodeId)!;
  };
  report.nodes.forEach(n => calculateDepth(n.id));

  return (
    <div>
      {/* View mode toggle */}
      <div className="mb-3 flex gap-0 rounded-lg border border-slate-300 bg-white p-1 w-fit">
        <button
          type="button"
          onClick={() => setViewMode("list")}
          className={`min-h-[44px] rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
            viewMode === "list" ? "bg-indigo-600 text-white" : "text-slate-700 hover:bg-slate-50"
          }`}
        >
          List
        </button>
        <button
          type="button"
          onClick={() => setViewMode("graph")}
          className={`min-h-[44px] rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
            viewMode === "graph" ? "bg-indigo-600 text-white" : "text-slate-700 hover:bg-slate-50"
          }`}
        >
          Graph
        </button>
      </div>

      {viewMode === "graph" ? (
        <div ref={paneRef} data-testid="consequence-graph" className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white" style={{ height: "min(70vh, 520px)" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            style={{ "--xy-background-color": "transparent" } as CSSProperties}
            viewport={fitViewport(bounds, pane.width, pane.height)}
            fitViewOptions={{ padding: 0.12, minZoom: 0.5, maxZoom: 1 }}
            panOnDrag={true}
            zoomOnScroll={true}
            zoomOnPinch={true}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
            colorMode="light"
            minZoom={0.3}
            maxZoom={2}
          >
            <Background gap={24} color="#e2e8f0" />
          </ReactFlow>
          <ul className="sr-only" aria-label="Consequence steps">
            {report.nodes.map((n) => (
              <li key={n.id}>
                {n.agent_id} {n.tool_id} {n.status}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div data-testid="consequence-list" className="space-y-0">
          {report.nodes.map((node, idx) => {
            const style = agentStyle(node.agent_id);
            const money = nodeMoneyOut(node);
            const badge = STATUS_BADGE[node.status];
            const muted = node.status !== "WILL_EXECUTE";
            const agentColor = agentColors[node.agent_id] || { color: style.color, darkColor: style.color };
            const depth = depthMap.get(node.id) || 0;
            const incomingEdge = report.edges.find(e => e.target === node.id);

            return (
              <div key={node.id}>
                {incomingEdge && idx > 0 && (
                  <div className="flex items-center justify-center py-2">
                    <div className="w-0.5 h-4 bg-slate-300" />
                    <span className="mx-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 whitespace-nowrap">
                      {edgeLabel(incomingEdge)}
                    </span>
                    <div className="w-0.5 h-4 bg-slate-300" />
                  </div>
                )}
                <div
                  className="w-full rounded-xl border bg-white px-4 py-3 shadow-sm"
                  style={{
                    borderLeft: `4px solid ${agentColor.color}`,
                    marginLeft: `${depth * 16}px`
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: agentColor.color }} />
                        <span className="text-xs font-semibold" style={{ color: agentColor.darkColor }}>
                          {agentName(node.agent_id)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        {node.trigger_type === "ROOT" ? "proposed this action" : "reacted & proposed"}
                      </div>
                      <div className={`mt-2 text-base font-semibold leading-snug ${muted ? "text-slate-500 line-through decoration-slate-400" : "text-slate-900"}`}>
                        {toolTitle(node.tool_id)}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                        <span className={`rounded px-2 py-1 ring-1 ${badge.style}`}>
                          {badge.text}
                        </span>
                        {!node.required && <span className="rounded px-2 py-1 text-slate-700 ring-1 ring-slate-300">optional</span>}
                        {money && (
                          <span className="rounded-md bg-amber-100 px-2 py-1 font-mono text-amber-800 ring-1 ring-amber-300">
                            −{inr(money)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
