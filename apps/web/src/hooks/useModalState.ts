import { useState, useCallback } from 'react'
import type { Task, TaskInput, TaskPatchInput, ProjectInput, PlanInput } from '../types/contracts'

export interface UseModalStateProps {
  createProject: (input: ProjectInput) => Promise<{ ok: boolean; error?: string }>
  createPlan: (input: PlanInput) => Promise<{ ok: boolean; error?: string }>
  createTask: (input: TaskInput) => Promise<{ ok: boolean; error?: string }>
  updateTask: (taskId: string, input: TaskPatchInput) => Promise<{ ok: boolean; error?: string }>
  onSuccess: () => Promise<void>
}

export function useModalState({
  createProject,
  createPlan,
  createTask,
  updateTask,
  onSuccess,
}: UseModalStateProps) {
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false)
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false)
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [modalBusy, setModalBusy] = useState(false)

  const openNewTask = useCallback(() => {
    setEditingTask(null)
    setIsTaskModalOpen(true)
  }, [])

  const openEditTask = useCallback((task: Task) => {
    setEditingTask(task)
    setIsTaskModalOpen(true)
  }, [])

  const handleProjectSubmit = useCallback(
    async (input: ProjectInput) => {
      setModalBusy(true)
      try {
        const res = await createProject(input)
        if (!res.ok) throw new Error(res.error || 'Failed to create project')
        await onSuccess()
      } finally {
        setModalBusy(false)
      }
    },
    [createProject, onSuccess]
  )

  const handlePlanSubmit = useCallback(
    async (input: PlanInput) => {
      setModalBusy(true)
      try {
        const res = await createPlan(input)
        if (!res.ok) throw new Error(res.error || 'Failed to create plan')
        await onSuccess()
      } finally {
        setModalBusy(false)
      }
    },
    [createPlan, onSuccess]
  )

  const handleTaskSubmit = useCallback(
    async (input: TaskInput | TaskPatchInput, taskId?: string) => {
      setModalBusy(true)
      try {
        if (taskId) {
          const res = await updateTask(taskId, input as TaskPatchInput)
          if (!res.ok) throw new Error(res.error || 'Failed to update task')
        } else {
          const res = await createTask(input as TaskInput)
          if (!res.ok) throw new Error(res.error || 'Failed to create task')
        }
        await onSuccess()
      } finally {
        setModalBusy(false)
      }
    },
    [createTask, updateTask, onSuccess]
  )

  return {
    isProjectModalOpen,
    setIsProjectModalOpen,
    isPlanModalOpen,
    setIsPlanModalOpen,
    isTaskModalOpen,
    setIsTaskModalOpen,
    editingTask,
    modalBusy,
    openNewTask,
    openEditTask,
    handleProjectSubmit,
    handlePlanSubmit,
    handleTaskSubmit,
  }
}
