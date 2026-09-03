import type { PluginInput } from "@opencode-ai/plugin"
import { MULTIMODAL_LOOKER_AGENT } from "./constants"
import type { AgentOverrides } from "../../config/schema"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { fetchAvailableModels } from "../../shared/model-availability"
import { parseModelString } from "../../shared"
import { log } from "../../shared/logger"
import { readConnectedProvidersCache } from "../../shared/connected-providers-cache"
import { resolveModelPipeline } from "../../shared/model-resolution-pipeline"
import { readVisionCapableModelsCache } from "../../shared/vision-capable-models-cache"
import { buildMultimodalLookerFallbackChain } from "./multimodal-fallback-chain"
import type { LookAtInheritOptions } from "./types"

type AgentModel = { providerID: string; modelID: string }

type ResolvedAgentMetadata = {
  agentModel?: AgentModel
  agentVariant?: string
}

type AgentInfo = {
  name?: string
  model?: AgentModel
  variant?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getFullModelKey(model: AgentModel): string {
  return `${model.providerID}/${model.modelID}`
}

function isVisionCapableAgentModel(
  agentModel: AgentModel | undefined,
  visionCapableModels: Array<AgentModel>,
): agentModel is AgentModel {
  if (!agentModel) {
    return false
  }

  return visionCapableModels.some((visionCapableModel) =>
    getFullModelKey(visionCapableModel) === getFullModelKey(agentModel),
  )
}

function parseAgentModel(model: string): AgentModel | undefined {
  const [providerID, ...modelIDParts] = model.split("/")
  const modelID = modelIDParts.join("/")
  if (!providerID || modelID.length === 0) {
    return undefined
  }

  return { providerID, modelID }
}

function toAgentInfo(value: unknown): AgentInfo | null {
  if (!isObject(value)) return null
  const name = typeof value["name"] === "string" ? value["name"] : undefined
  const variant = typeof value["variant"] === "string" ? value["variant"] : undefined
  const modelValue = value["model"]
  const model =
    isObject(modelValue) &&
    typeof modelValue["providerID"] === "string" &&
    typeof modelValue["modelID"] === "string"
      ? { providerID: modelValue["providerID"], modelID: modelValue["modelID"] }
      : undefined
  return { name, model, variant }
}

async function resolveRegisteredAgentMetadata(
  ctx: PluginInput,
): Promise<ResolvedAgentMetadata> {
  const agentsResult = await ctx.client.app?.agents?.()
  const agentsRaw = isObject(agentsResult) ? agentsResult["data"] : undefined
  const agents = Array.isArray(agentsRaw) ? agentsRaw.map(toAgentInfo).filter(Boolean) : []

  const matched = agents.find(
    (agent) => agent?.name?.toLowerCase() === MULTIMODAL_LOOKER_AGENT.toLowerCase()
  )

  return {
    agentModel: matched?.model,
    agentVariant: matched?.variant,
  }
}

async function resolveDynamicAgentMetadata(
  ctx: PluginInput,
  visionCapableModels = readVisionCapableModelsCache(),
): Promise<ResolvedAgentMetadata> {
  const fallbackChain = buildMultimodalLookerFallbackChain(visionCapableModels)
  const connectedProviders = readConnectedProvidersCache()
  const availableModels = await fetchAvailableModels(ctx.client, {
    connectedProviders,
  })

  const resolution = resolveModelPipeline({
    constraints: {
      availableModels,
      connectedProviders,
    },
    policy: {
      fallbackChain,
    },
  })

  const agentModel = resolution ? parseAgentModel(resolution.model) : undefined
  if (!isVisionCapableAgentModel(agentModel, visionCapableModels)) {
    return {}
  }

  return {
    agentModel,
    agentVariant: resolution?.variant,
  }
}

function isConfiguredVisionModel(
  configuredModel: AgentModel | undefined,
  dynamicModel: AgentModel | undefined,
): boolean {
  if (!configuredModel || !dynamicModel) {
    return false
  }

  return getFullModelKey(configuredModel) === getFullModelKey(dynamicModel)
}

function isInheritValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "inherit"
}

function findAgentOverride(agentOverrides: AgentOverrides | undefined, agentConfigKey: string) {
  return agentOverrides?.[agentConfigKey as keyof AgentOverrides]
    ?? Object.entries(agentOverrides ?? {}).find(([key]) => key.toLowerCase() === agentConfigKey)?.[1]
}

function resolveInheritedAgentMetadata(inherit?: LookAtInheritOptions): ResolvedAgentMetadata | undefined {
  const inheritedModel = inherit?.inheritedModel
  if (!inheritedModel) {
    return undefined
  }
  const agentConfigKey = getAgentConfigKey(MULTIMODAL_LOOKER_AGENT)
  const agentOverride = findAgentOverride(inherit?.agentOverrides, agentConfigKey)
  const agentCategoryConfig = agentOverride?.category
    ? inherit?.userCategories?.[agentOverride.category]
    : undefined
  const rawAgentCategoryModel = agentCategoryConfig?.model
  const rawAgentModel = agentOverride?.model ?? rawAgentCategoryModel
  const agentIsInherit = isInheritValue(agentOverride?.model) || isInheritValue(rawAgentCategoryModel)
  const hasExplicitUserModel = Boolean(rawAgentModel) && !agentIsInherit
  const shouldInheritParent = agentIsInherit || (inherit?.inheritParentModel === true && !hasExplicitUserModel)
  if (!shouldInheritParent) {
    return undefined
  }
  const normalized = parseModelString(inheritedModel)
  if (!normalized) {
    return undefined
  }
  const parsedVariant = (normalized as { variant?: string })?.variant
  const variantToUse = agentOverride?.variant ?? agentCategoryConfig?.variant ?? parsedVariant
  return {
    agentModel: { providerID: normalized.providerID, modelID: normalized.modelID },
    agentVariant: variantToUse,
  }
}

export async function resolveMultimodalLookerAgentMetadata(
  ctx: PluginInput,
  inherit?: LookAtInheritOptions,
): Promise<ResolvedAgentMetadata> {
  try {
    const inheritedMetadata = resolveInheritedAgentMetadata(inherit)
    if (inheritedMetadata?.agentModel) {
      log("[look_at] Using inherited parent model for multimodal-looker", {
        model: getFullModelKey(inheritedMetadata.agentModel),
      })
      return inheritedMetadata
    }

    const registeredMetadata = await resolveRegisteredAgentMetadata(ctx)
    const visionCapableModels = readVisionCapableModelsCache()

    if (registeredMetadata.agentModel) {
      const registeredModelIsVisionCapable = isVisionCapableAgentModel(
        registeredMetadata.agentModel,
        visionCapableModels,
      )

      if (registeredModelIsVisionCapable) {
        log("[look_at] Using registered multimodal-looker model (vision-capable)", {
          model: getFullModelKey(registeredMetadata.agentModel),
        })
        return registeredMetadata
      }

      log("[look_at] Registered multimodal-looker model not in vision-capable cache, using it anyway", {
        model: getFullModelKey(registeredMetadata.agentModel),
      })
      return registeredMetadata
    }

    const dynamicMetadata = await resolveDynamicAgentMetadata(ctx, visionCapableModels)
    if (dynamicMetadata.agentModel) {
      log("[look_at] No registered model, using dynamic resolution", {
        model: getFullModelKey(dynamicMetadata.agentModel),
      })
      return dynamicMetadata
    }

    return {}
  } catch (error) {
    log("[look_at] Failed to resolve multimodal-looker model info", error)
    return {}
  }
}
