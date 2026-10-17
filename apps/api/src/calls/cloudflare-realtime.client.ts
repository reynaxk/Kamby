import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';

const API = 'https://rtc.live.cloudflare.com/v1';

export interface SessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

/** Cloudflare Realtime's own reply for a tracks / renegotiate call, passed to the app as-is. */
export interface RealtimeTracksResponse {
  requiresImmediateRenegotiation?: boolean;
  sessionDescription?: SessionDescription;
  tracks?: { mid?: string; trackName?: string; sessionId?: string; errorCode?: string; errorDescription?: string }[];
  errorCode?: string;
  errorDescription?: string;
}

/**
 * The server side of Cloudflare Realtime (2026-10-17): sessions, tracks and TURN credentials.
 * The app token never leaves the API — every browser call goes through CallsService, which
 * checks who may publish/pull what before forwarding here.
 */
@Injectable()
export class CloudflareRealtimeClient {
  private readonly appId: string | null;
  private readonly appToken: string | null;
  private readonly turnKeyId: string | null;
  private readonly turnToken: string | null;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.appId = config.get('CF_REALTIME_APP_ID', { infer: true }) ?? null;
    this.appToken = config.get('CF_REALTIME_APP_TOKEN', { infer: true }) ?? null;
    this.turnKeyId = config.get('CF_TURN_KEY_ID', { infer: true }) ?? null;
    this.turnToken = config.get('CF_TURN_API_TOKEN', { infer: true }) ?? null;
    this.logger.setContext('CloudflareRealtimeClient');
  }

  get enabled(): boolean {
    return Boolean(this.appId && this.appToken);
  }

  async newSession(): Promise<string> {
    const body = await this.call<{ sessionId?: string }>('POST', '/sessions/new');
    if (!body.sessionId) throw new ServiceUnavailableException("Couldn't start the call — try again.");
    return body.sessionId;
  }

  tracksNew(sessionId: string, payload: unknown): Promise<RealtimeTracksResponse> {
    return this.call('POST', `/sessions/${encodeURIComponent(sessionId)}/tracks/new`, payload);
  }

  renegotiate(sessionId: string, payload: unknown): Promise<RealtimeTracksResponse> {
    return this.call('PUT', `/sessions/${encodeURIComponent(sessionId)}/renegotiate`, payload);
  }

  tracksClose(sessionId: string, payload: unknown): Promise<RealtimeTracksResponse> {
    return this.call('PUT', `/sessions/${encodeURIComponent(sessionId)}/tracks/close`, payload);
  }

  /** STUN + short-lived TURN credentials for one call (calls still work over STUN alone on
   *  most networks if TURN isn't configured). */
  async iceServers(ttlSeconds = 3 * 3600): Promise<{ urls: string | string[]; username?: string; credential?: string }[]> {
    const stun = [{ urls: 'stun:stun.cloudflare.com:3478' }];
    if (!this.turnKeyId || !this.turnToken) return stun;
    try {
      const res = await fetch(`${API}/turn/keys/${this.turnKeyId}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.turnToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: ttlSeconds }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { iceServers?: { urls: string | string[]; username?: string; credential?: string }[] };
      return body.iceServers?.length ? body.iceServers : stun;
    } catch (error) {
      this.logger.warn({ err: error }, 'TURN credentials failed — the call falls back to STUN only');
      return stun;
    }
  }

  private async call<T>(method: 'POST' | 'PUT', path: string, payload?: unknown): Promise<T> {
    if (!this.appId || !this.appToken) throw new ServiceUnavailableException('Calls are not available right now.');
    const res = await fetch(`${API}/apps/${this.appId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.appToken}`, 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as T & { errorCode?: string; errorDescription?: string };
    if (!res.ok) {
      this.logger.warn({ status: res.status, path: path.replace(/sessions\/[^/]+/, 'sessions/:id'), code: body.errorCode, description: body.errorDescription }, 'Cloudflare Realtime call failed');
      throw new ServiceUnavailableException("The call couldn't connect — try again.");
    }
    return body;
  }
}
