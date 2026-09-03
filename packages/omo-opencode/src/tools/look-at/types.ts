import type { AgentOverrides, CategoriesConfig } from "../../config/schema"

export interface LookAtArgs {
  file_path?: string
  file_paths?: string[]
  image_data?: string  // base64 encoded image data (for clipboard images)
  image_data_list?: string[]
  goal: string
}

export interface LookAtInheritOptions {
  inheritedModel?: string
  inheritParentModel?: boolean
  agentOverrides?: AgentOverrides
  userCategories?: CategoriesConfig
}

export interface LookAtToolOptions {
  inheritParentModel?: boolean
  agentOverrides?: AgentOverrides
  userCategories?: CategoriesConfig
}
