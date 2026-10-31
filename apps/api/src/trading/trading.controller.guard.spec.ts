import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { TradingController } from './trading.controller';

// 2026-10-31: a DTO inserted between `@UseGuards(JwtAuthGuard)` and the controller moved the
// guard onto the DTO — every /trade route then ran with no session and answered 500.
describe('TradingController auth', () => {
  it('requires a session on the whole controller', () => {
    const guards = (Reflect.getMetadata(GUARDS_METADATA, TradingController) ?? []) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });
});
