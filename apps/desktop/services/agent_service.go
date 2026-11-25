package services

import (
	"context"
	"time"

	"github.com/dragonflow/desktop/internal/desktop"
	"github.com/dragonflow/desktop/internal/domain"
)

type AgentService struct {
	rt *desktop.Runtime
}

func NewAgentService(rt *desktop.Runtime) *AgentService {
	return &AgentService{rt: rt}
}

func (s *AgentService) ListAgents() []domain.AgentHealthInfo {
	return s.rt.Registry.ListHealth()
}

func (s *AgentService) ProbeAgents() []domain.AgentHealthInfo {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return s.rt.Registry.ProbeAll(ctx)
}
