export type TrashEntryKind = 'plan' | 'folder'
export type TrashEntryStatus = 'trashed' | 'needs_attention' | 'purge_interrupted'
export type TrashManifestPhase = 'staging' | 'trashed' | 'restoring' | 'purging'
export type TrashOperation = 'restore' | 'purge'

export interface TrashDirectoryIdentity {
  device: string
  inode: string
  birthtime_ns: string
}

export interface TrashPlanSnapshot {
  relative_path: string
  plan_id: string | null
  updated_at: string | null
  content_digest: string
}

export interface TrashManifest {
  schema_version: 1
  revision: number
  entry_id: string
  library_id: string
  root_generation: number
  kind: TrashEntryKind
  name: string
  original_relative_path: string
  deleted_at: string
  directory_identity: TrashDirectoryIdentity
  original_parent_identity: TrashDirectoryIdentity
  plans: TrashPlanSnapshot[]
  phase: TrashManifestPhase
  restore_relative_path?: string
  restore_parent_identity?: TrashDirectoryIdentity
}

export interface TrashEntry {
  id: string
  kind: TrashEntryKind
  name: string
  original_relative_path: string
  deleted_at: string
  manifest_revision: number
  status: TrashEntryStatus
  can_restore: boolean
  can_purge: boolean
  issue?: 'manifest_invalid' | 'entry_incomplete' | 'identity_mismatch' | 'purge_interrupted'
}

export interface TrashRestoreDestination {
  parent_path: string
  name: string
}

export interface TrashReferenceImpactSummary {
  signature: string
  reference_count: number
}

export interface TrashOperationPreview {
  operation: TrashOperation
  entry_id: string
  name: string
  original_relative_path: string
  restore_relative_path?: string
  plan_count: number
  reference_count: number
  reference_impact_signature: string
  preview_digest: string
  confirmation_token: string
  expires_at: string
}

export interface TrashEntryTargetGrant {
  entry_id: string
  token: string
  expires_at: string
}

export interface TrashOperationCommitResult {
  path?: string
  changed_plan_ids: string[]
}
