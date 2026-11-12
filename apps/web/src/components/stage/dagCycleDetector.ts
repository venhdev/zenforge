import type { Connection, Edge } from '@xyflow/react'
import type { Task } from '../../types/contracts'

/**
 * Validates whether adding a proposed connection (source -> target) creates a cycle
 * in the directed acyclic graph.
 *
 * In ZenForge DAG semantics:
 * source -> target means "source is a prerequisite of target" (target depends on source).
 * Thus, target.dependencies contains source.
 * A cycle occurs if there is already an existing path from target to source.
 */
export function wouldCreateCycle(
  sourceId: string,
  targetId: string,
  tasks: Task[]
): boolean {
  if (sourceId === targetId) return true

  // Build adjacency map: key is prerequisite, value is array of dependent task IDs
  // (task depends on dep -> edge from dep to task)
  const adj = new Map<string, string[]>()
  for (const t of tasks) {
    if (!adj.has(t.id)) adj.set(t.id, [])
    for (const dep of t.dependencies || []) {
      const list = adj.get(dep) || []
      list.push(t.id)
      adj.set(dep, list)
    }
  }

  // Adding source -> target means following edges from target could reach source
  const visited = new Set<string>()
  const queue = [targetId]
  visited.add(targetId)

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === sourceId) {
      return true
    }
    const neighbors = adj.get(current) || []
    for (const n of neighbors) {
      if (!visited.has(n)) {
        visited.add(n)
        queue.push(n)
      }
    }
  }

  return false
}

/**
 * Validates a connection against self-loops, existing edges, and DAG cycles.
 */
export function isValidConnection(
  edgeOrConnection: Connection | Edge,
  tasks: Task[],
  edges: Edge[]
): boolean {
  const source = edgeOrConnection.source
  const target = edgeOrConnection.target
  if (!source || !target || source === target) return false

  // Disallow duplicate edge
  const exists = edges.some((e) => e.source === source && e.target === target)
  if (exists) return false

  return !wouldCreateCycle(source, target, tasks)
}
