/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { resolveMultimodalLookerAgentMetadata } from "./multimodal-agent-metadata"
import { setVisionCapableModelsCache, clearVisionCapableModelsCache } from "../../shared/vision-capable-models-cache"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import * as modelAvailability from "../../shared/model-availability"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

function createPluginInput(agentData: Array<Record<string, unknown>>): PluginInput {
  const client = {} as PluginInput["client"]
  Object.assign(client, {
    app: {
      agents: mock(async () => ({ data: agentData })),
    },
  })

  return {
    client,
    project: {} as PluginInput["project"],
    directory: "/project",
    worktree: "/project",
    serverUrl: new URL("http://localhost"),
    $: {} as PluginInput["$"],
  }
}

describe("resolveMultimodalLookerAgentMetadata", () => {
  beforeEach(() => {
    clearVisionCapableModelsCache()
  })

  afterEach(() => {
    clearVisionCapableModelsCache()
    ;(unsafeTestValue<{ mockRestore?: () => void }>(modelAvailability.fetchAvailableModels)).mockRestore?.()
    ;(unsafeTestValue<{ mockRestore?: () => void }>(connectedProvidersCache.readConnectedProvidersCache)).mockRestore?.()
  })

  test("returns configured multimodal-looker model when it already matches a vision-capable override", async () => {
    // given
    setVisionCapableModelsCache(new Map([
      [
        "rundao/public/qwen3.5-397b",
        { providerID: "rundao", modelID: "public/qwen3.5-397b" },
      ],
    ]))
    spyOn(modelAvailability, "fetchAvailableModels").mockResolvedValue(
      new Set(["rundao/public/qwen3.5-397b"]),
    )
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["rundao"])
    const ctx = createPluginInput([
      {
        name: "multimodal-looker",
        model: { providerID: "rundao", modelID: "public/qwen3.5-397b" },
      },
    ])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx)

    // then
    expect(result).toEqual({
      agentModel: { providerID: "rundao", modelID: "public/qwen3.5-397b" },
      agentVariant: undefined,
    })
  })

  test("returns registered model variant directly without merging from dynamic resolution", async () => {
    // given - registered model is in the vision-capable cache
    setVisionCapableModelsCache(new Map([
      [
        "openai/gpt-5.4",
        { providerID: "openai", modelID: "gpt-5.4" },
      ],
    ]))
    spyOn(modelAvailability, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.4"]),
    )
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
    const ctx = createPluginInput([
      {
        name: "multimodal-looker",
        model: { providerID: "openai", modelID: "gpt-5.4" },
      },
    ])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx)

    // then - returns registered metadata directly, variant is undefined since none was set
    expect(result).toEqual({
      agentModel: { providerID: "openai", modelID: "gpt-5.4" },
      agentVariant: undefined,
    })
  })

  test("prefers registered model over dynamically resolved vision-capable model", async () => {
    // given - registered model is openai/gpt-5.4, dynamic would resolve to rundao model
    setVisionCapableModelsCache(new Map([
      [
        "rundao/public/qwen3.5-397b",
        { providerID: "rundao", modelID: "public/qwen3.5-397b" },
      ],
    ]))
    spyOn(modelAvailability, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.4", "rundao/public/qwen3.5-397b"]),
    )
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai", "rundao"])
    const ctx = createPluginInput([
      {
        name: "multimodal-looker",
        model: { providerID: "openai", modelID: "gpt-5.4" },
        variant: "medium",
      },
    ])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx)

    // then - registered model takes priority even when not in vision cache
    expect(result).toEqual({
      agentModel: { providerID: "openai", modelID: "gpt-5.4" },
      agentVariant: "medium",
    })
  })

  test("falls back to the hardcoded multimodal chain when no dynamic vision model exists", async () => {
    // given
    setVisionCapableModelsCache(new Map([
      [
        "google/gemini-3-flash",
        { providerID: "google", modelID: "gemini-3-flash" },
      ],
    ]))
    spyOn(modelAvailability, "fetchAvailableModels").mockResolvedValue(
      new Set(["google/gemini-3-flash"]),
    )
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["google"])
    const ctx = createPluginInput([])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx)

    // then
    expect(result).toEqual({
      agentModel: { providerID: "google", modelID: "gemini-3-flash" },
      agentVariant: undefined,
    })
  })

  test("returns registered model even when not in vision-capable cache", async () => {
    // given - registered model exists but is NOT in the vision-capable cache
    spyOn(modelAvailability, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.4"]),
    )
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
    const ctx = createPluginInput([
      {
        name: "multimodal-looker",
        model: { providerID: "openai", modelID: "gpt-5.4" },
      },
    ])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx)

    // then - trusts user's configured model regardless of vision cache
    expect(result).toEqual({
      agentModel: { providerID: "openai", modelID: "gpt-5.4" },
      agentVariant: undefined,
    })
  })

  test("returns inherited parent model when inherit is enabled and no explicit model is configured", async () => {
    // given - no registered agents, empty vision cache, parent model available
    const ctx = createPluginInput([])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx, {
      inheritedModel: "rundao/public/qwen3.5-397b",
      inheritParentModel: true,
    })

    // then - parent model wins without touching registered/dynamic resolution
    expect(result).toEqual({
      agentModel: { providerID: "rundao", modelID: "public/qwen3.5-397b" },
      agentVariant: undefined,
    })
  })

  test("returns inherited parent model when agent model is explicitly inherit", async () => {
    // given - global inherit off but agent opts in via the inherit sentinel
    const ctx = createPluginInput([])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx, {
      inheritedModel: "openai/gpt-5.4",
      inheritParentModel: false,
      agentOverrides: { "multimodal-looker": { model: "inherit" } },
    })

    // then
    expect(result).toEqual({
      agentModel: { providerID: "openai", modelID: "gpt-5.4" },
      agentVariant: undefined,
    })
  })

  test("keeps registered model when an explicit override blocks global inherit", async () => {
    // given - explicit agent model configured, global inherit on
    spyOn(modelAvailability, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.4"]),
    )
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
    const ctx = createPluginInput([
      {
        name: "multimodal-looker",
        model: { providerID: "openai", modelID: "gpt-5.4" },
      },
    ])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx, {
      inheritedModel: "rundao/public/qwen3.5-397b",
      inheritParentModel: true,
      agentOverrides: { "multimodal-looker": { model: "openai/gpt-5.4" } },
    })

    // then - explicit config wins over global inherit
    expect(result).toEqual({
      agentModel: { providerID: "openai", modelID: "gpt-5.4" },
      agentVariant: undefined,
    })
  })

  test("keeps old behavior when inherit is disabled despite a parent model", async () => {
    // given - parent model present but inherit flag off
    spyOn(modelAvailability, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.4"]),
    )
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])
    const ctx = createPluginInput([
      {
        name: "multimodal-looker",
        model: { providerID: "openai", modelID: "gpt-5.4" },
      },
    ])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx, {
      inheritedModel: "rundao/public/qwen3.5-397b",
      inheritParentModel: false,
    })

    // then - registered model path untouched
    expect(result).toEqual({
      agentModel: { providerID: "openai", modelID: "gpt-5.4" },
      agentVariant: undefined,
    })
  })

  test("prefers configured variant over inherited parent variant", async () => {
    // given - parent carries a variant, agent config overrides it
    const ctx = createPluginInput([])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx, {
      inheritedModel: "rundao/public/qwen3.5-397b(low)",
      inheritParentModel: true,
      agentOverrides: { "multimodal-looker": { variant: "high" } },
    })

    // then
    expect(result).toEqual({
      agentModel: { providerID: "rundao", modelID: "public/qwen3.5-397b" },
      agentVariant: "high",
    })
  })

  test("passes through inherited parent variant when none is configured", async () => {
    // given - parent carries a variant, nothing overrides it
    const ctx = createPluginInput([])

    // when
    const result = await resolveMultimodalLookerAgentMetadata(ctx, {
      inheritedModel: "rundao/public/qwen3.5-397b(low)",
      inheritParentModel: true,
    })

    // then
    expect(result).toEqual({
      agentModel: { providerID: "rundao", modelID: "public/qwen3.5-397b" },
      agentVariant: "low",
    })
  })
})
