import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoriesConfig, CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isModelAvailable } from "../../shared"
import { log } from "../../shared/logger"
import { applyOverrides } from "./agent-overrides"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"
import { createAtlasAgent } from "../atlas"

function isInheritValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "inherit"
}

export function maybeCreateAtlasConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  uiSelectedModel?: string
  availableModels: Set<string>
  systemDefaultModel?: string
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
  userCategories?: CategoriesConfig
  useTaskSystem?: boolean
  inheritParentModel?: boolean
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    availableAgents,
    availableSkills,
    mergedCategories,
    directory,
    userCategories,
    inheritParentModel = false,
  } = input

  if (disabledAgents.includes("atlas")) return undefined

  const orchestratorOverride = agentOverrides["atlas"]
  const atlasRequirement = AGENT_MODEL_REQUIREMENTS["atlas"]
  const orchestratorCategory = orchestratorOverride?.category
  const concreteModel = orchestratorOverride?.model && !isInheritValue(orchestratorOverride.model)
    ? orchestratorOverride.model
    : undefined
  const agentIsInherit = isInheritValue(orchestratorOverride?.model)
    || isInheritValue(orchestratorCategory ? mergedCategories[orchestratorCategory]?.model : undefined)

  let atlasResolution = applyModelResolution({
    uiSelectedModel: orchestratorOverride?.model !== undefined ? undefined : uiSelectedModel,
    userModel: concreteModel,
    requirement: atlasRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (!atlasResolution && concreteModel) {
    // User explicitly configured a model but resolution failed (e.g., cold cache, no system default).
    // Honor the user's choice directly instead of dropping Atlas entirely.
    atlasResolution = { model: concreteModel, provenance: "override" as const }
  }

  if (!atlasResolution && (inheritParentModel || agentIsInherit)) {
    atlasResolution = getFirstFallbackModel(atlasRequirement)
  }

  if (!atlasResolution) {
    log("[agent-registration] Agent skipped: model resolution returned no result", {
      agent: "atlas",
      configuredModel: orchestratorOverride?.model,
    })
    return undefined
  }
  const { model: atlasModel, variant: atlasResolvedVariant } = atlasResolution

  let orchestratorConfig = createAtlasAgent({
    model: atlasModel,
    availableAgents,
    availableSkills,
    userCategories,
  })

  if (atlasResolvedVariant) {
    orchestratorConfig = { ...orchestratorConfig, variant: atlasResolvedVariant }
  }

  orchestratorConfig = applyOverrides(orchestratorConfig, orchestratorOverride, mergedCategories, directory)

  if ((inheritParentModel || agentIsInherit) && !concreteModel && orchestratorConfig.model
    && !isModelAvailable(orchestratorConfig.model, availableModels)) {
    delete orchestratorConfig.model
    const explicitVariant = orchestratorOverride?.variant
      ?? (orchestratorCategory ? mergedCategories[orchestratorCategory]?.variant : undefined)
    if (!explicitVariant) {
      delete orchestratorConfig.variant
    }
  }

  return orchestratorConfig
}
