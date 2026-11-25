package events

import (
	"sync"

	"github.com/dragonflow/desktop/internal/domain"
)

type Listener func(ev domain.AppEvent)

type EventBus struct {
	mu        sync.RWMutex
	nextID    uint64
	listeners map[uint64]Listener
}

func NewEventBus() *EventBus {
	return &EventBus{
		listeners: make(map[uint64]Listener),
	}
}

func (b *EventBus) Subscribe(fn Listener) func() {
	if fn == nil {
		return func() {}
	}
	b.mu.Lock()
	b.nextID++
	id := b.nextID
	b.listeners[id] = fn
	b.mu.Unlock()

	return func() {
		b.mu.Lock()
		delete(b.listeners, id)
		b.mu.Unlock()
	}
}

func (b *EventBus) Emit(ev domain.AppEvent) {
	if b == nil {
		return
	}
	b.mu.RLock()
	snapshot := make([]Listener, 0, len(b.listeners))
	for _, fn := range b.listeners {
		snapshot = append(snapshot, fn)
	}
	b.mu.RUnlock()

	for _, fn := range snapshot {
		fn(ev)
	}
}
