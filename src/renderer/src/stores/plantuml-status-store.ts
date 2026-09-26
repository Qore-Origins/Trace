import { create } from 'zustand'
import type { PlantUmlStatusDto } from '@shared/plantuml-types'

const STOPPED_STATUS: PlantUmlStatusDto = {
  state: 'stopped',
  port: null,
  errorCode: null
}

interface PlantumlStatusState {
  status: PlantUmlStatusDto
  setStatus: (status: PlantUmlStatusDto) => void
  resetStatus: () => void
}

/** Ephemeral service status shared by note renderers; never persisted with user preferences. */
export const usePlantumlStatusStore = create<PlantumlStatusState>((set) => ({
  status: { ...STOPPED_STATUS },
  setStatus: (status) => set({ status: { ...status } }),
  resetStatus: () => set({ status: { ...STOPPED_STATUS } })
}))
