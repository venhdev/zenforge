import { describe, it, expect } from 'vitest'
import { wouldCreateCycle, isValidConnection } from './dagCycleDetector'
import type { Task } from '../../types/contracts'
import type { Connection, Edge } from '@xyflow/react'

describe('dagCycleDetector', () => {
  const tasks: Task[] = [
    {
      id: 'A',
      title: 'Task A',
      status: 'READY',
      dependencies: [],
      created_at: '',
      updated_at: '',
    },
    {
      id: 'B',
      title: 'Task B',
      status: 'PENDING',
      dependencies: ['A'], // A -> B
      created_at: '',
      updated_at: '',
    },
    {
      id: 'C',
      title: 'Task C',
      status: 'PENDING',
      dependencies: ['B'], // B -> C
      created_at: '',
      updated_at: '',
    },
  ]

  const edges: Edge[] = [
    { id: 'edge-A-B', source: 'A', target: 'B' },
    { id: 'edge-B-C', source: 'B', target: 'C' },
  ]

  it('rejects self-loops', () => {
    expect(wouldCreateCycle('A', 'A', tasks)).toBe(true)
    const conn: Connection = { source: 'A', target: 'A', sourceHandle: null, targetHandle: null }
    expect(isValidConnection(conn, tasks, edges)).toBe(false)
  })

  it('detects direct reverse cycle (B -> A when A -> B exists)', () => {
    expect(wouldCreateCycle('B', 'A', tasks)).toBe(true)
    const conn: Connection = { source: 'B', target: 'A', sourceHandle: null, targetHandle: null }
    expect(isValidConnection(conn, tasks, edges)).toBe(false)
  })

  it('detects transitive cycle (C -> A when A -> B -> C exists)', () => {
    expect(wouldCreateCycle('C', 'A', tasks)).toBe(true)
    const conn: Connection = { source: 'C', target: 'A', sourceHandle: null, targetHandle: null }
    expect(isValidConnection(conn, tasks, edges)).toBe(false)
  })

  it('rejects duplicate edges', () => {
    const conn: Connection = { source: 'A', target: 'B', sourceHandle: null, targetHandle: null }
    expect(isValidConnection(conn, tasks, edges)).toBe(false)
  })

  it('allows valid acyclic additions (A -> C direct shortcut)', () => {
    expect(wouldCreateCycle('A', 'C', tasks)).toBe(false)
    const conn: Connection = { source: 'A', target: 'C', sourceHandle: null, targetHandle: null }
    expect(isValidConnection(conn, tasks, edges)).toBe(true)
  })
})
