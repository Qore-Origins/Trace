export type PlantUmlMode = 'local' | 'custom' | 'off'

export type PlantUmlServiceState = 'stopped' | 'starting' | 'running' | 'error'

export interface PlantUmlStatusDto {
  state: PlantUmlServiceState
  port: number | null
  errorCode: string | null
}

export const DEFAULT_PLANTUML_PORT = 18080
export const MIN_PLANTUML_PORT = 1024
export const MAX_PLANTUML_PORT = 65535

export function validatePlantumlPort(port: number): number {
  if (!Number.isInteger(port) || port < MIN_PLANTUML_PORT || port > MAX_PLANTUML_PORT) {
    throw new RangeError('PlantUML port must be an integer between 1024 and 65535')
  }
  return port
}
