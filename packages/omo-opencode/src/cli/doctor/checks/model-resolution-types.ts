import type { ModelCapabilitiesDiagnostics } from "../../../shared/model-capabilities"
import type { ModelRequirement } from "../../../shared/model-requirements"

export interface AgentResolutionInfo {
  name: string
  requirement: ModelRequirement
  userOverride?: string
  userVariant?: string
  effectiveModel: string
  effectiveResolution: string
  inheritsParentModel?: boolean
  capabilityDiagnostics?: ModelCapabilitiesDiagnostics
}

export interface CategoryResolutionInfo {
  name: string
  requirement: ModelRequirement
  userOverride?: string
  userVariant?: string
  effectiveModel: string
  effectiveResolution: string
  inheritsParentModel?: boolean
  capabilityDiagnostics?: ModelCapabilitiesDiagnostics
}

export interface ModelResolutionInfo {
  agents: AgentResolutionInfo[]
  categories: CategoryResolutionInfo[]
}

export interface OmoConfig {
  agents?: Record<string, { model?: string; variant?: string; category?: string }>
  categories?: Record<string, { model?: string; variant?: string }>
  inherit?: boolean
}

export interface AvailableModelsInfo {
  providers: string[]
  modelCount: number
  cacheExists: boolean
}
