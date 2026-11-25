import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import {
  DragonFlowConfigSchema,
  type AgentProfile,
  type DragonFlowConfig,
  type SanitizedConfig,
} from '@dragonflow/shared';
import { DEFAULT_AGENT_PRESETS } from './presets.js';

export function mergeAgentProfiles(configured: AgentProfile[]): AgentProfile[] {
  const byId = new Map<string, AgentProfile>();
  for (const preset of DEFAULT_AGENT_PRESETS) {
    byId.set(preset.id, { ...preset });
  }
  for (const agent of configured) {
    const existing = byId.get(agent.id);
    if (existing) {
      byId.set(agent.id, {
        ...existing,
        ...agent,
        args: agent.args.length > 0 ? agent.args : existing.args,
        strengths: agent.strengths.length > 0 ? agent.strengths : existing.strengths,
        envAllowlist:
          agent.envAllowlist.length > 0 ? agent.envAllowlist : existing.envAllowlist,
      });
    } else {
      byId.set(agent.id, agent);
    }
  }
  return Array.from(byId.values());
}

export function parseConfigFromYaml(yamlContent: string): DragonFlowConfig {
  const raw = (YAML.parse(yamlContent) ?? {}) as Record<string, unknown>;
  const parsed = DragonFlowConfigSchema.parse(raw);
  return {
    ...parsed,
    agents: mergeAgentProfiles(parsed.agents),
  };
}

export async function loadConfig(filePath?: string): Promise<DragonFlowConfig> {
  if (!filePath) {
    const parsed = DragonFlowConfigSchema.parse({});
    return {
      ...parsed,
      agents: mergeAgentProfiles(parsed.agents),
    };
  }
  const content = await readFile(filePath, 'utf8');
  return parseConfigFromYaml(content);
}

export function sanitizeConfigForUi(
  config: DragonFlowConfig,
  env: NodeJS.ProcessEnv = process.env,
): SanitizedConfig {
  return {
    ...config,
    github: {
      ...config.github,
      tokenConfigured: Boolean(env[config.github.tokenEnv]),
      webhookSecretConfigured: Boolean(env[config.github.webhookSecretEnv]),
    },
    llm: {
      ...config.llm,
      apiKeyConfigured: Boolean(env[config.llm.apiKeyEnv]),
    },
  };
}
