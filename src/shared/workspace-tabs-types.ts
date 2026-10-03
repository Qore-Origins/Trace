/** Only relative plan paths are persisted; the active library is selected in main. */
export interface WorkspaceTabsState {
  library_id: string
  open_paths: Array<{ path: string; plan_id?: string }>
  active_path: string | null
}
