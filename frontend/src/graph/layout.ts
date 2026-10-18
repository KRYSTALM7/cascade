import dagre from "@dagrejs/dagre";
import type { GraphEdge, GraphNode } from "../api/types";
import { humanEvent } from "../lib/format";

export const NODE_WIDTH = 260;
export const NODE_HEIGHT = 120;

export interface Positioned {
  node: GraphNode;
  x: number;
  y: number;
}

/** Deterministic left-to-right layout. Only TRIGGER edges shape the layout; DUPLICATE/CYCLE edges are drawn on top. */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): Positioned[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 180, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of edges) if (edge.kind === "TRIGGER") g.setEdge(edge.source, edge.target);
  dagre.layout(g);
  return nodes.map((node) => {
    const pos = g.node(node.id);
    return { node, x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 };
  });
}

/** Total money leaving NovaCart at one node (decimal strings summed exactly in paise). */
export function nodeMoneyOut(node: GraphNode): string | null {
  const outs = node.money.filter((m) => m.direction === "OUT");
  if (outs.length === 0) return null;
  const paise = outs.reduce((sum, m) => {
    const [whole = "0", frac = "0"] = m.amount.split(".");
    return sum + BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0").slice(0, 2));
  }, 0n);
  return `${paise / 100n}.${(paise % 100n).toString().padStart(2, "0")}`;
}

export function edgeLabel(edge: GraphEdge): string {
  if (edge.kind === "DUPLICATE") return "duplicate · runs once";
  if (edge.kind === "CYCLE") return "cycle · cut";
  return humanEvent(edge.event);
}

export interface Bounds {
  width: number;
  height: number;
}

export function layoutBounds(positioned: Positioned[]): Bounds {
  if (positioned.length === 0) return { width: NODE_WIDTH, height: NODE_HEIGHT };
  return {
    width: Math.max(...positioned.map((p) => p.x + NODE_WIDTH)) + 40,
    height: Math.max(...positioned.map((p) => p.y + NODE_HEIGHT)) + 40,
  };
}

/** Centre the whole graph in the pane; never zoom in past 110%. */
export function fitViewport(bounds: Bounds, width: number, height: number, pad = 40) {
  if (width <= 0 || height <= 0) return { x: 0, y: 0, zoom: 1 };
  const zoom = Math.max(0.2, Math.min(1.1, (width - 2 * pad) / bounds.width, (height - 2 * pad) / bounds.height));
  return { x: (width - bounds.width * zoom) / 2, y: (height - bounds.height * zoom) / 2, zoom };
}
