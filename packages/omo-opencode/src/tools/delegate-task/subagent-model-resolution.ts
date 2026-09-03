import type { AgentOverrides } from "../../config/schema"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { fuzzyMatchModel } from "../../shared/model-availability"
import { buildFallbackChainFromModels } from "../../shared/fallback-chain-from-models"
import { normalizeModelFormat } from "../../shared/model-format-normalizer"
import { parseModelString } from "../../shared/model-string-parser"
import { flattenToFallbackModelStrings, normalizeFallbackModels } from "../../shared/model-resolver"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { log } from "../../shared/logger"
import { getAvailableModelsForDelegateTask } from "./available-models"
import { applyCategoryParams } from "./delegated-model-config"
import type { ExecutorContext } from "./executor-types"
import { applyFallbackEntrySettings } from "./fallback-entry-settings"
import { resolveEffectiveFallbackEntry } from "./fallback-entry-resolution"
import { resolveModelForDelegateTask } from "./model-selection"
import type { AgentInfo } from "./subagent-discovery"
import type { ResolvedSubagentModel } from "./subagent-resolution-types"

function findAgentOverride(agentOverrides: AgentOverrides | undefined, agentConfigKey: string) {
  return agentOverrides?.[agentConfigKey]
    ?? Object.entries(agentOverrides ?? {}).find(([key]) => key.toLowerCase() === agentConfigKey)?.[1]
}

function isInheritValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "inherit"
}

export async function resolveSubagentModel(
  agentToUse: string,
  matchedAgent: AgentInfo,
  executorCtx: ExecutorContext,
): Promise<ResolvedSubagentModel> {
  let categoryModel = undefined
  let fallbackChain = undefined

  const agentConfigKey = getAgentConfigKey(agentToUse)
  const agentOverride = findAgentOverride(executorCtx.agentOverrides, agentConfigKey)
  const agentRequirement = AGENT_MODEL_REQUIREMENTS[agentConfigKey]
  const agentCategoryConfig = agentOverride?.category
    ? executorCtx.userCategories?.[agentOverride.category]
    : undefined
  const rawAgentCategoryModel = agentCategoryConfig?.model
  const rawAgentModel = agentOverride?.model ?? rawAgentCategoryModel
  const agentIsInherit = isInheritValue(agentOverride?.model) || isInheritValue(rawAgentCategoryModel)
  const hasExplicitUserModel = Boolean(rawAgentModel) && !agentIsInherit
  const inheritedModel = executorCtx.inheritedModel
  const inheritParent = executorCtx.inheritParentModel === true
  const shouldInheritParent = Boolean(inheritedModel) && (agentIsInherit || (inheritParent === true && !hasExplicitUserModel))
  if (shouldInheritParent && inheritedModel) {
    const parsedParent = parseModelString(inheritedModel)
    const normalized = parsedParent ?? normalizeModelFormat(inheritedModel)
    if (normalized) {
      const parsedVariant = (parsedParent as { variant?: string } | null)?.variant
      const variantToUse = agentOverride?.variant ?? agentCategoryConfig?.variant ?? parsedVariant
      const resolvedModel = variantToUse && variantToUse !== parsedVariant ? { ...normalized, variant: variantToUse } : normalized
      categoryModel = applyCategoryParams(resolvedModel as import("../../shared/model-resolution-types").DelegatedModelConfig, agentCategoryConfig)
      const defaultProviderID = categoryModel.providerID
      const normalizedAgentFallbackModels = normalizeFallbackModels(
        agentOverride?.fallback_models
        ?? agentCategoryConfig?.fallback_models
      )
      const configuredFallbackChain = buildFallbackChainFromModels(
        normalizedAgentFallbackModels,
        defaultProviderID,
      )
      fallbackChain = configuredFallbackChain ?? undefined
      const effectiveEntry = resolveEffectiveFallbackEntry({
        categoryModel,
        configuredFallbackChain,
        resolution: { model: inheritedModel, variant: (parsedParent as { variant?: string } | null)?.variant } as unknown as ReturnType<typeof resolveModelForDelegateTask>,
      })
      if (categoryModel && effectiveEntry) {
        categoryModel = applyFallbackEntrySettings({
          categoryModel,
          effectiveEntry,
          variantOverride: agentOverride?.variant,
        })
      }
      return { categoryModel, fallbackChain }
    }
  }
  const effectiveAgentOverrideModel = isInheritValue(agentOverride?.model) ? undefined : agentOverride?.model
  const agentCategoryModel = isInheritValue(rawAgentCategoryModel) ? undefined : rawAgentCategoryModel
  const normalizedAgentFallbackModels = normalizeFallbackModels(
    agentOverride?.fallback_models
    ?? agentCategoryConfig?.fallback_models
  )

  const availableModels = await getAvailableModelsForDelegateTask(executorCtx.client)
  const normalizedMatchedModel = matchedAgent.model
    ? normalizeModelFormat(matchedAgent.model)
    : undefined
  const matchedAgentModelStr = normalizedMatchedModel
    ? `${normalizedMatchedModel.providerID}/${normalizedMatchedModel.modelID}`
    : undefined

  if (effectiveAgentOverrideModel || agentCategoryModel || agentRequirement || matchedAgent.model) {
    const resolution = resolveModelForDelegateTask({
      userModel: effectiveAgentOverrideModel ?? agentCategoryModel,
      userFallbackModels: flattenToFallbackModelStrings(normalizedAgentFallbackModels),
      categoryDefaultModel: matchedAgentModelStr,
      fallbackChain: agentRequirement?.fallbackChain,
      availableModels,
      systemDefaultModel: undefined,
    })

    const resolutionSkipped = resolution && "skipped" in resolution

    if (resolution && !resolutionSkipped) {
      const normalized = normalizeModelFormat(resolution.model)
      if (normalized) {
        const variantToUse = agentOverride?.variant ?? resolution.variant ?? agentCategoryConfig?.variant
        const resolvedModel = variantToUse ? { ...normalized, variant: variantToUse } : normalized
        categoryModel = applyCategoryParams(resolvedModel, agentCategoryConfig)
      }
    } else if (resolutionSkipped && (effectiveAgentOverrideModel ?? agentCategoryModel)) {
      const explicitModel = effectiveAgentOverrideModel ?? agentCategoryModel
      const normalized = explicitModel ? normalizeModelFormat(explicitModel) : undefined
      if (normalized) {
        const variantToUse = agentOverride?.variant ?? agentCategoryConfig?.variant
        const resolvedModel = variantToUse ? { ...normalized, variant: variantToUse } : normalized
        categoryModel = applyCategoryParams(resolvedModel, agentCategoryConfig)
        log("[delegate-task] Cold cache: using explicit user override for subagent", {
          agent: agentToUse,
          model: agentOverride?.model ?? agentCategoryModel,
        })
      }
    }

    const defaultProviderID = categoryModel?.providerID
      ?? normalizedMatchedModel?.providerID
      ?? "opencode"
    const configuredFallbackChain = buildFallbackChainFromModels(
      normalizedAgentFallbackModels,
      defaultProviderID,
    )
    fallbackChain = configuredFallbackChain
      ?? ((resolutionSkipped || hasExplicitUserModel) ? undefined : agentRequirement?.fallbackChain)
    const effectiveEntry = resolveEffectiveFallbackEntry({
      categoryModel,
      configuredFallbackChain,
      resolution,
    })

    if (categoryModel && effectiveEntry) {
      categoryModel = applyFallbackEntrySettings({
        categoryModel,
        effectiveEntry,
        variantOverride: agentOverride?.variant,
      })
    }
  }

  if (!categoryModel && normalizedMatchedModel) {
    const fullModel = `${normalizedMatchedModel.providerID}/${normalizedMatchedModel.modelID}`
    if (availableModels.size === 0 || fuzzyMatchModel(fullModel, availableModels, [normalizedMatchedModel.providerID])) {
      categoryModel = normalizedMatchedModel
    } else {
      log("[delegate-task] Skipping unavailable agent default model", {
        agent: agentToUse,
        model: fullModel,
      })
    }
  }

  return { categoryModel, fallbackChain }
}
