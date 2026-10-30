import { verdict, videoVerdict } from './image-moderation.service';

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

describe('video moderation verdict', () => {
  const frame = (position: number, extra: object = {}) => ({ info: { position }, nudity: { sexual_activity: 0.01 }, gore: { prob: 0.01 }, weapon: { classes: { firearm: 0.01 } }, ...extra });

  it('passes a clean short clip', () => {
    expect(videoVerdict({ status: 'success', data: { frames: [frame(0), frame(3), frame(6)] } }, 15).ok).toBe(true);
  });

  it('refuses one bad frame, a long clip, or an odd answer', () => {
    expect(videoVerdict({ status: 'success', data: { frames: [frame(0), frame(3, { gore: { prob: 0.9 } })] } }, 15).reason).toBe('gore');
    expect(videoVerdict({ status: 'success', data: { frames: [frame(0), frame(30)] } }, 15).reason).toBe('long');
    expect(videoVerdict({ status: 'failure' }, 15).reason).toBe('error');
  });
});
