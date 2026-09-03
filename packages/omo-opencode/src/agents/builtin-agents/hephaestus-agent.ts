import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isAnyProviderConnected, isModelAvailable } from "../../shared"
import { log } from "../../shared/logger"
import { createHephaestusAgent, isHephaestusSupportedModel } from "../hephaestus"
import { applyEnvironmentContext } from "./environment-context"
import { applyCategoryOverride, mergeAgentConfig } from "./agent-overrides"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"
import { applyFrontierToolSchemaPermission } from "../frontier-tool-schema-guard"

function isInheritValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "inherit"
}

export function maybeCreateHephaestusConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  availableModels: Set<string>
  systemDefaultModel?: string
  isFirstRunNoCache: boolean
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  availableCategories: AvailableCategory[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
  useTaskSystem: boolean
  disableOmoEnv?: boolean
  inheritParentModel?: boolean
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
    useTaskSystem,
    disableOmoEnv = false,
    inheritParentModel = false,
  } = input

  if (disabledAgents.includes("hephaestus")) return undefined

  const hephaestusOverride = agentOverrides["hephaestus"]
  const hephaestusRequirement = AGENT_MODEL_REQUIREMENTS["hephaestus"]
  const hasHephaestusExplicitConfig = hephaestusOverride !== undefined
  const hepOverrideCategory = (hephaestusOverride as Record<string, unknown> | undefined)?.category as string | undefined
  const hepCategoryModel = hepOverrideCategory ? mergedCategories[hepOverrideCategory]?.model : undefined
  const concreteModel = hephaestusOverride?.model && !isInheritValue(hephaestusOverride.model)
    ? hephaestusOverride.model
    : undefined
  const agentIsInherit = isInheritValue(hephaestusOverride?.model) || isInheritValue(hepCategoryModel)

  const hasRequiredProvider =
    inheritParentModel ||
    agentIsInherit ||
    !hephaestusRequirement?.requiresProvider ||
    hasHephaestusExplicitConfig ||
    isFirstRunNoCache ||
    isAnyProviderConnected(hephaestusRequirement.requiresProvider, availableModels)

  if (!hasRequiredProvider) {
    log("[agent-registration] Agent skipped: required provider not connected", {
      agent: "hephaestus",
      requiredProvider: hephaestusRequirement?.requiresProvider,
    })
    return undefined
  }

  let hephaestusResolution = applyModelResolution({
    userModel: concreteModel,
    requirement: hephaestusRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (isFirstRunNoCache && !concreteModel) {
    hephaestusResolution = getFirstFallbackModel(hephaestusRequirement)
  }

  if (!hephaestusResolution && (inheritParentModel || agentIsInherit)) {
    if (concreteModel) {
      log("[agent-registration] Inherit enabled: using explicitly configured model as-is", {
        agent: "hephaestus",
        configuredModel: concreteModel,
      })
      hephaestusResolution = { model: concreteModel, provenance: "override" as const }
    } else {
      hephaestusResolution = getFirstFallbackModel(hephaestusRequirement)
    }
  }

  if (!hephaestusResolution) {
    log("[agent-registration] Agent skipped: model resolution returned no result", {
      agent: "hephaestus",
      configuredModel: hephaestusOverride?.model,
    })
    return undefined
  }
  const { model: hephaestusModel, variant: hephaestusResolvedVariant } = hephaestusResolution

  if (!isHephaestusSupportedModel(hephaestusModel)) {
    log("[agent-registration] Agent skipped: unsupported Hephaestus model", {
      agent: "hephaestus",
      configuredModel: hephaestusModel,
    })
    return undefined
  }

  let hephaestusConfig = createHephaestusAgent(
    hephaestusModel,
    availableAgents,
    undefined,
    availableSkills,
    availableCategories,
    useTaskSystem
  )

  hephaestusConfig = { ...hephaestusConfig, variant: hephaestusResolvedVariant ?? "medium" }

  if (hepOverrideCategory) {
    hephaestusConfig = applyCategoryOverride(hephaestusConfig, hepOverrideCategory, mergedCategories)
    if (!isHephaestusSupportedModel(hephaestusConfig.model)) {
      log("[agent-registration] Agent skipped: unsupported Hephaestus category model", {
        agent: "hephaestus",
        configuredModel: hephaestusConfig.model,
      })
      return undefined
    }
  }

  hephaestusConfig = applyEnvironmentContext(hephaestusConfig, directory, { disableOmoEnv })

  if (hephaestusOverride) {
    hephaestusConfig = mergeAgentConfig(hephaestusConfig, hephaestusOverride, directory)
    if (!isHephaestusSupportedModel(hephaestusConfig.model)) {
      log("[agent-registration] Agent skipped: unsupported Hephaestus override model", {
        agent: "hephaestus",
        configuredModel: hephaestusConfig.model,
      })
      return undefined
    }
  }

  const resolvedModel = hephaestusConfig.model ?? ""
  hephaestusConfig.permission = applyFrontierToolSchemaPermission(
    hephaestusConfig.permission,
    resolvedModel,
    hephaestusOverride?.permission,
    (hephaestusOverride as { tools?: Record<string, boolean> } | undefined)?.tools
  )

  // With inherit semantics and no concrete model, a placeholder the current
  // environment cannot serve would make opencode reject the agent on switch.
  // Omit it so the session model is used instead.
  if ((inheritParentModel || agentIsInherit) && !concreteModel && hephaestusConfig.model
    && !isModelAvailable(hephaestusConfig.model, availableModels)) {
    delete hephaestusConfig.model
    const explicitVariant = hephaestusOverride?.variant
      ?? (hepOverrideCategory ? mergedCategories[hepOverrideCategory]?.variant : undefined)
    if (!explicitVariant) {
      delete hephaestusConfig.variant
    }
  }

  return hephaestusConfig
}
