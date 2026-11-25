import type { AgentHealthInfo, AgentProfile } from '@dragonflow/shared';
import type { DragonFlowEventBus } from '../events/event-bus.js';
import { CliCodingAgentAdapter, type CodingAgentAdapter } from './coding-adapters.js';

export class AgentRegistry {
  private readonly adapters = new Map<string, CodingAgentAdapter>();
  private readonly healthCache = new Map<string, AgentHealthInfo>();

  constructor(
    profiles: AgentProfile[] = [],
    private readonly eventBus?: DragonFlowEventBus,
    adapterFactory?: (profile: AgentProfile) => CodingAgentAdapter,
  ) {
    for (const profile of profiles) {
      const adapter = adapterFactory
        ? adapterFactory(profile)
        : new CliCodingAgentAdapter(profile);
      this.registerAdapter(adapter);
    }
  }

  registerAdapter(adapter: CodingAgentAdapter): void {
    this.adapters.set(adapter.id, adapter);
    if (!this.healthCache.has(adapter.id)) {
      this.healthCache.set(adapter.id, {
        id: adapter.id,
        displayName: adapter.profile.displayName,
        type: adapter.profile.type,
        enabled: adapter.profile.enabled,
        available: false,
        command: adapter.profile.command,
        strengths: adapter.profile.strengths,
        costTier: adapter.profile.costTier,
        lastCheckedAt: new Date(0).toISOString(),
      });
    }
  }

  getAdapter(id: string): CodingAgentAdapter | undefined {
    return this.adapters.get(id);
  }

  async probeAll(): Promise<AgentHealthInfo[]> {
    const entries = Array.from(this.adapters.values());
    const results = await Promise.all(entries.map((adapter) => adapter.probe()));
    for (const info of results) {
      this.healthCache.set(info.id, info);
    }
    this.eventBus?.emitEvent({ type: 'agent:health', agents: results });
    return results;
  }

  listHealth(): AgentHealthInfo[] {
    return Array.from(this.healthCache.values());
  }

  getAvailableAgents(): AgentHealthInfo[] {
    return this.listHealth().filter((h) => h.enabled && h.available);
  }

  isAvailable(id: string): boolean {
    const info = this.healthCache.get(id);
    return Boolean(info && info.enabled && info.available);
  }
}
