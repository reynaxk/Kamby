import { Controller, Get, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { interval, map, merge, type Observable } from 'rxjs';
import { NarrativesService } from './narratives.service';

/** Narratives — public. See NarrativesService. */
@Controller('narratives')
export class NarrativesController {
  constructor(private readonly narratives: NarrativesService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  list() {
    return this.narratives.snapshot();
  }

  /** The whole snapshot (event `narratives`) about every 30s, plus a heartbeat. */
  @Sse('stream')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  stream(): Observable<MessageEvent> {
    const snapshots$ = this.narratives.updates$.pipe(map((data): MessageEvent => ({ type: 'narratives', data })));
    const heartbeat$ = interval(25_000).pipe(map((): MessageEvent => ({ type: 'heartbeat', data: { atIso: new Date().toISOString() } })));
    return merge(snapshots$, heartbeat$);
  }
}
