import { EventEmitter } from 'node:events';
import type { SseEvent } from '@dragonflow/shared';

export class DragonFlowEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emitEvent(event: SseEvent): void {
    this.emitter.emit('event', event);
  }

  subscribe(listener: (event: SseEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => {
      this.emitter.off('event', listener);
    };
  }
}
