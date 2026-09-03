import { join } from "node:path"

import { getOpenCodeCacheDir } from "../../../shared"
import type { AvailableModelsInfo, ModelResolutionInfo, OmoConfig } from "./model-resolution-types"
import { formatModelWithVariant, getCategoryEffectiveVariant, getEffectiveVariant } from "./model-resolution-variant"

function formatCapabilityResolutionLabel(mode: string | undefined): string {
  return mode ?? "unknown"
}

function getInheritDisplayVariant(
  kind: "agent" | "category",
  name: string,
  config: OmoConfig
): string | undefined {
  if (kind === "category") {
    return config.categories?.[name]?.variant
  }
  const agentOverride = config.agents?.[name]
  return agentOverride?.variant
    ?? (agentOverride?.category ? config.categories?.[agentOverride.category]?.variant : undefined)
}

export function buildModelResolutionDetails(options: {
  info: ModelResolutionInfo
  available: AvailableModelsInfo
  config: OmoConfig
}): string[] {
  const details: string[] = []
  const cacheFile = join(getOpenCodeCacheDir(), "models.json")

  details.push("═══ Available Models (from cache) ═══")
  details.push("")
  if (options.available.cacheExists) {
    details.push(`  Providers in cache: ${options.available.providers.length}`)
    details.push(
      `  Sample: ${options.available.providers.slice(0, 6).join(", ")}${options.available.providers.length > 6 ? "..." : ""}`
    )
    details.push(`  Total models: ${options.available.modelCount}`)
    details.push(`  Cache: ${cacheFile}`)
    details.push(`  ℹ Runtime: only connected providers used`)
    details.push(`  Refresh: opencode models --refresh`)
  } else {
    details.push("  ⚠ Cache not found. Run 'opencode' to populate.")
  }
  details.push("")

  details.push("═══ Configured Models ═══")
  details.push("")
  details.push("Agents:")
  for (const agent of options.info.agents) {
    const marker = agent.userOverride ? "●" : agent.inheritsParentModel ? "◐" : "○"
    const variant = agent.inheritsParentModel
      ? getInheritDisplayVariant("agent", agent.name, options.config)
      : getEffectiveVariant(agent.name, agent.requirement, options.config)
    const display = formatModelWithVariant(agent.effectiveModel, variant)
    details.push(`  ${marker} ${agent.name}: ${display} [capabilities: ${formatCapabilityResolutionLabel(agent.capabilityDiagnostics?.resolutionMode)}]`)
  }
  details.push("")
  details.push("Categories:")
  for (const category of options.info.categories) {
    const marker = category.userOverride ? "●" : category.inheritsParentModel ? "◐" : "○"
    const variant = category.inheritsParentModel
      ? getInheritDisplayVariant("category", category.name, options.config)
      : getCategoryEffectiveVariant(category.name, category.requirement, options.config)
    const display = formatModelWithVariant(category.effectiveModel, variant)
    details.push(`  ${marker} ${category.name}: ${display} [capabilities: ${formatCapabilityResolutionLabel(category.capabilityDiagnostics?.resolutionMode)}]`)
  }
  details.push("")
  details.push("● = user override, ○ = provider fallback, ◐ = parent inheritance")

  return details
}
