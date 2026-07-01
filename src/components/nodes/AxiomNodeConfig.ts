/**
 * Generalized Axiom Node Configurations
 * 
 * Formalizes node characteristics across the graph:
 * - hasSidepane: Determines if clicking this node triggers sidepane details.
 * - usesLLMModel: Indication that the node relies on LLM inference.
 */

export interface AxiomNodeConfig {
  type: string;
  hasSidepane: boolean;
  usesLLMModel: boolean;
}

export const AXIOM_NODE_CONFIGS: Record<string, AxiomNodeConfig> = {
  stickyNode: { type: "stickyNode", hasSidepane: false, usesLLMModel: false },
  boundaryNode: { type: "boundaryNode", hasSidepane: false, usesLLMModel: false },
  contextNode: { type: "contextNode", hasSidepane: false, usesLLMModel: false },
  globalChatNode: { type: "globalChatNode", hasSidepane: true, usesLLMModel: true },
  taskNode: { type: "taskNode", hasSidepane: true, usesLLMModel: true },
  mcpNode: { type: "mcpNode", hasSidepane: false, usesLLMModel: true },
};

export function getNodeConfig(type: string): AxiomNodeConfig {
  return AXIOM_NODE_CONFIGS[type] || { type, hasSidepane: false, usesLLMModel: false };
}
