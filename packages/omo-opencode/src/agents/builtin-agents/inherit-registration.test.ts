/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { maybeCreateAtlasConfig } from "./atlas-agent"
import { maybeCreateHephaestusConfig } from "./hephaestus-agent"
import { maybeCreateSisyphusConfig } from "./sisyphus-agent"
import { collectPendingBuiltinAgents } from "./general-agents"
import { createExploreAgent } from "../explore"
import type { AgentSource } from "../agent-builder"

const EMPTY_MODELS = new Set<string>()

describe("inherit-enabled agent registration", () => {
  describe("#given no available models and inherit disabled", () => {
    test("#when creating hephaestus #then it is skipped", () => {
      // given
      const input = {
        disabledAgents: [],
        agentOverrides: {},
        availableModels: EMPTY_MODELS,
        isFirstRunNoCache: false,
        availableAgents: [],
        availableSkills: [],
        availableCategories: [],
        mergedCategories: {},
        useTaskSystem: false,
      }

      // when
      const config = maybeCreateHephaestusConfig(input)

      // then
      expect(config).toBeUndefined()
    })

    test("#when creating atlas #then it is skipped", () => {
      // given
      const input = {
        disabledAgents: [],
        agentOverrides: {},
        availableModels: EMPTY_MODELS,
        isFirstRunNoCache: false,
        availableAgents: [],
        availableSkills: [],
        mergedCategories: {},
      }

      // when
      const config = maybeCreateAtlasConfig(input)

      // then
      expect(config).toBeUndefined()
    })
  })

  describe("#given no available models and inherit enabled", () => {
    test("#when creating hephaestus #then it registers without a model so opencode uses the session model", () => {
      // given
      const input = {
        disabledAgents: [],
        agentOverrides: {},
        availableModels: EMPTY_MODELS,
        isFirstRunNoCache: false,
        availableAgents: [],
        availableSkills: [],
        availableCategories: [],
        mergedCategories: {},
        useTaskSystem: false,
        inheritParentModel: true,
      }

      // when
      const config = maybeCreateHephaestusConfig(input)

      // then
      expect(config).toBeDefined()
      expect(config?.model).toBeUndefined()
    })

    test("#when creating atlas #then it registers without a model so opencode uses the session model", () => {
      // given
      const input = {
        disabledAgents: [],
        agentOverrides: {},
        availableModels: EMPTY_MODELS,
        isFirstRunNoCache: false,
        availableAgents: [],
        availableSkills: [],
        mergedCategories: {},
        inheritParentModel: true,
      }

      // when
      const config = maybeCreateAtlasConfig(input)

      // then
      expect(config).toBeDefined()
      expect(config?.model).toBeUndefined()
    })

    test("#when creating sisyphus #then it registers", () => {
      // given
      const input = {
        disabledAgents: [],
        agentOverrides: {},
        availableModels: EMPTY_MODELS,
        isFirstRunNoCache: false,
        availableAgents: [],
        availableSkills: [],
        availableCategories: [],
        mergedCategories: {},
        useTaskSystem: false,
        inheritParentModel: true,
      }

      // when
      const config = maybeCreateSisyphusConfig(input)

      // then
      expect(config).toBeDefined()
    })

    test("#when agent is in disabled_agents #then inherit does not revive it", () => {
      // given
      const input = {
        disabledAgents: ["hephaestus"],
        agentOverrides: {},
        availableModels: EMPTY_MODELS,
        isFirstRunNoCache: false,
        availableAgents: [],
        availableSkills: [],
        availableCategories: [],
        mergedCategories: {},
        useTaskSystem: false,
        inheritParentModel: true,
      }

      // when
      const config = maybeCreateHephaestusConfig(input)

      // then
      expect(config).toBeUndefined()
    })

    test("#when explicit model is configured with inherit #then the model is kept", () => {
      // given
      const input = {
        disabledAgents: [],
        agentOverrides: { hephaestus: { model: "openai/gpt-5.6-sol" } },
        availableModels: EMPTY_MODELS,
        isFirstRunNoCache: false,
        availableAgents: [],
        availableSkills: [],
        availableCategories: [],
        mergedCategories: {},
        useTaskSystem: false,
        inheritParentModel: true,
      }

      // when
      const config = maybeCreateHephaestusConfig(input)

      // then
      expect(config?.model).toBe("openai/gpt-5.6-sol")
    })

    test("#when explicit variant is configured with inherit #then the variant is kept while the model is omitted", () => {
      // given
      const input = {
        disabledAgents: [],
        agentOverrides: { hephaestus: { variant: "high" } },
        availableModels: EMPTY_MODELS,
        isFirstRunNoCache: false,
        availableAgents: [],
        availableSkills: [],
        availableCategories: [],
        mergedCategories: {},
        useTaskSystem: false,
        inheritParentModel: true,
      }

      // when
      const config = maybeCreateHephaestusConfig(input)

      // then
      expect(config).toBeDefined()
      expect(config?.model).toBeUndefined()
      expect(config?.variant).toBe("high")
    })

    test("#when creating a general agent with inherit #then its unservable placeholder is omitted", () => {
      // given
      const { pendingAgentConfigs } = collectPendingBuiltinAgents({
        agentSources: { explore: createExploreAgent } as unknown as Record<string, AgentSource>,
        agentMetadata: {},
        disabledAgents: [],
        agentOverrides: {},
        mergedCategories: {},
        availableModels: EMPTY_MODELS,
        isFirstRunNoCache: false,
        inheritParentModel: true,
      })

      // when
      const config = pendingAgentConfigs.get("explore")

      // then
      expect(config).toBeDefined()
      expect(config?.model).toBeUndefined()
    })

    test("#when creating a general agent without inherit #then its fallback default is kept", () => {
      // given
      const { pendingAgentConfigs } = collectPendingBuiltinAgents({
        agentSources: { explore: createExploreAgent } as unknown as Record<string, AgentSource>,
        agentMetadata: {},
        disabledAgents: [],
        agentOverrides: {},
        mergedCategories: {},
        availableModels: EMPTY_MODELS,
        isFirstRunNoCache: false,
      })

      // when
      const config = pendingAgentConfigs.get("explore")

      // then
      expect(config?.model).toBe("openai/gpt-5.6-luna-fast")
    })
  })
})
