package adapters

import (
	"context"
	"sync"
	"time"

	"github.com/dragonflow/desktop/internal/domain"
	"github.com/dragonflow/desktop/internal/events"
)

type AdapterFactory func(profile domain.AgentProfile) CodingAgentAdapter

type Registry struct {
	mu          sync.RWMutex
	order       []string
	adapters    map[string]CodingAgentAdapter
	healthCache map[string]domain.AgentHealthInfo
	eventBus    *events.EventBus
}

func NewRegistry(profiles []domain.AgentProfile, eventBus *events.EventBus, factory AdapterFactory) *Registry {
	r := &Registry{
		adapters:    make(map[string]CodingAgentAdapter),
		healthCache: make(map[string]domain.AgentHealthInfo),
		eventBus:    eventBus,
	}
	for _, p := range profiles {
		var adapter CodingAgentAdapter
		if factory != nil {
			adapter = factory(p)
		} else {
			adapter = NewCliCodingAgentAdapter(p, nil)
		}
		r.RegisterAdapter(adapter)
	}
	return r
}

func (r *Registry) RegisterAdapter(adapter CodingAgentAdapter) {
	r.mu.Lock()
	defer r.mu.Unlock()

	id := adapter.ID()
	if _, exists := r.adapters[id]; !exists {
		r.order = append(r.order, id)
	}
	r.adapters[id] = adapter
	if _, hasHealth := r.healthCache[id]; !hasHealth {
		p := adapter.Profile()
		strengths := append([]string{}, p.Strengths...)
		if strengths == nil {
			strengths = []string{}
		}
		r.healthCache[id] = domain.AgentHealthInfo{
			ID:            p.ID,
			DisplayName:   p.DisplayName,
			Type:          string(p.Type),
			Enabled:       p.Enabled,
			Available:     false,
			Command:       p.Command,
			Strengths:     strengths,
			CostTier:      p.CostTier,
			LastCheckedAt: time.Unix(0, 0).UTC().Format(time.RFC3339Nano),
		}
	}
}

func (r *Registry) GetAdapter(id string) CodingAgentAdapter {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.adapters[id]
}

func (r *Registry) ProbeAll(ctx context.Context) []domain.AgentHealthInfo {
	r.mu.RLock()
	list := make([]CodingAgentAdapter, 0, len(r.order))
	for _, id := range r.order {
		if a, ok := r.adapters[id]; ok {
			list = append(list, a)
		}
	}
	r.mu.RUnlock()

	results := make([]domain.AgentHealthInfo, len(list))
	var wg sync.WaitGroup
	for i, a := range list {
		wg.Add(1)
		go func(idx int, adapter CodingAgentAdapter) {
			defer wg.Done()
			results[idx] = adapter.Probe(ctx)
		}(i, a)
	}
	wg.Wait()

	r.mu.Lock()
	for _, info := range results {
		r.healthCache[info.ID] = info
	}
	r.mu.Unlock()

	if r.eventBus != nil {
		r.eventBus.Emit(domain.AppEvent{
			Type:   "agent:health",
			Agents: results,
		})
	}
	return results
}

func (r *Registry) ListHealth() []domain.AgentHealthInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]domain.AgentHealthInfo, 0, len(r.order))
	for _, id := range r.order {
		if info, ok := r.healthCache[id]; ok {
			out = append(out, info)
		}
	}
	return out
}

func (r *Registry) GetAvailableAgents() []domain.AgentHealthInfo {
	all := r.ListHealth()
	out := make([]domain.AgentHealthInfo, 0, len(all))
	for _, h := range all {
		if h.Enabled && h.Available {
			out = append(out, h)
		}
	}
	return out
}

func (r *Registry) IsAvailable(id string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	info, ok := r.healthCache[id]
	return ok && info.Enabled && info.Available
}
