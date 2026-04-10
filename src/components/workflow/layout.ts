// ProtoForge Workflow — Dagre auto-layout helper
// Computes positions for FlowNodes using the Dagre directed-graph layout algorithm.

import dagre from 'dagre';
import type { FlowNode, FlowEdge, NodePosition } from '@/types/workflow';
import { NODE_TYPE_META } from '@/types/workflow';

export type LayoutDirection = 'TB' | 'LR';

interface NodeDimensions {
  width: number;
  height: number;
}

/** Approximate rendered dimensions for each shape — must roughly match the custom node JSX. */
function getNodeDimensions(nodeType: FlowNode['nodeType']): NodeDimensions {
  const shape = NODE_TYPE_META[nodeType]?.shape;
  if (shape === 'circle') return { width: 56, height: 56 };
  if (shape === 'diamond') return { width: 80, height: 80 };
  // Rectangle (default) — matches min-w-[160px] in RectangleNode
  return { width: 180, height: 56 };
}

/**
 * Compute auto-layout positions for the given nodes and edges using Dagre.
 *
 * @param nodes  Existing FlowNode array (positions will be replaced)
 * @param edges  FlowEdge array used to determine the directed graph structure
 * @param direction  'TB' = top-to-bottom (default), 'LR' = left-to-right
 * @returns      A new array of FlowNodes with updated positions; original array is not mutated
 */
export function getLayoutedNodes(
  nodes: FlowNode[],
  edges: FlowEdge[],
  direction: LayoutDirection = 'TB',
): FlowNode[] {
  if (nodes.length === 0) return nodes;

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: direction === 'TB' ? 60 : 80,
    ranksep: direction === 'TB' ? 90 : 120,
    marginx: 20,
    marginy: 20,
  });

  for (const node of nodes) {
    const dims = getNodeDimensions(node.nodeType);
    dagreGraph.setNode(node.id, dims);
  }
  for (const edge of edges) {
    // Only include edges where both endpoints exist (defensive)
    if (dagreGraph.hasNode(edge.sourceNodeId) && dagreGraph.hasNode(edge.targetNodeId)) {
      dagreGraph.setEdge(edge.sourceNodeId, edge.targetNodeId);
    }
  }

  dagre.layout(dagreGraph);

  return nodes.map((node) => {
    const layouted = dagreGraph.node(node.id);
    if (!layouted) return node;
    const dims = getNodeDimensions(node.nodeType);
    // Dagre returns the center of the node; React Flow expects top-left, so we offset by half-size
    const position: NodePosition = {
      x: Math.round(layouted.x - dims.width / 2),
      y: Math.round(layouted.y - dims.height / 2),
    };
    return { ...node, position };
  });
}
