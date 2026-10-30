import { verdict } from './image-moderation.service';

describe('picture moderation verdict', () => {
  const clean = { status: 'success', nudity: { sexual_activity: 0.01, sexual_display: 0.01, erotica: 0.02, very_suggestive: 0.03 }, weapon: { classes: { firearm: 0.01, knife: 0.01 } }, gore: { prob: 0.01 } };

  it('lets a clean picture through', () => {
    expect(verdict(clean)).toEqual({ ok: true, reason: null });
  });

  it('refuses nudity, gore and weapons', () => {
    expect(verdict({ ...clean, nudity: { ...clean.nudity, sexual_display: 0.6 } }).reason).toBe('nudity');
    expect(verdict({ ...clean, gore: { prob: 0.9 } }).reason).toBe('gore');
    expect(verdict({ ...clean, weapon: { classes: { firearm: 0.95 } } }).reason).toBe('weapon');
  });

  it('fails closed on any non-success answer', () => {
    expect(verdict({ status: 'failure' })).toEqual({ ok: false, reason: 'error' });
    expect(verdict({})).toEqual({ ok: false, reason: 'error' });
  });
});
