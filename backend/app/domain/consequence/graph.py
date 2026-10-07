"""NetworkX helpers over a finished report: execution order, depth, agent sets. The traversal
itself is the engine's BFS; NetworkX is only used for graph algorithms on the result."""

from __future__ import annotations

from collections.abc import Sequence

import networkx as nx

from app.domain.consequence.report import EdgeKind, EdgeOut, NodeOut, NodeStatus


def build_digraph(nodes: Sequence[NodeOut], edges: Sequence[EdgeOut]) -> nx.DiGraph:
    graph = nx.DiGraph()
    for index, node in enumerate(nodes):
        graph.add_node(node.id, index=index, agent=node.agent_id, status=node.status)
    for edge in edges:
        graph.add_edge(edge.source, edge.target, kind=edge.kind)
    return graph


def execution_order(nodes: Sequence[NodeOut], edges: Sequence[EdgeOut]) -> list[str]:
    """Topological order of the nodes that will execute (parents before children; ties broken
    by BFS index so the order is deterministic). CYCLE/DUPLICATE edges never add work."""
    index = {n.id: i for i, n in enumerate(nodes)}
    executing = {n.id for n in nodes if n.status is NodeStatus.WILL_EXECUTE}
    graph = nx.DiGraph()
    graph.add_nodes_from(sorted(executing, key=index.__getitem__))
    for edge in edges:
        if edge.kind is EdgeKind.TRIGGER and edge.source in executing and edge.target in executing:
            graph.add_edge(edge.source, edge.target)
    return list(nx.lexicographical_topological_sort(graph, key=index.__getitem__))


def max_depth(nodes: Sequence[NodeOut], edges: Sequence[EdgeOut]) -> int:
    trigger_edges = [e for e in edges if e.kind is EdgeKind.TRIGGER]
    graph = build_digraph(nodes, trigger_edges)
    if not nodes:
        return 0
    lengths = nx.single_source_shortest_path_length(graph, nodes[0].id)
    return int(max(lengths.values()))
