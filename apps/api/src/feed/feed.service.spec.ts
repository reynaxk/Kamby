import { BadRequestException } from '@nestjs/common';
import { cleanBody } from './feed.service';

describe('feed post rules', () => {
  it('keeps normal text', () => {
    expect(cleanBody('  bought $SOL here  ', 500)).toBe('bought $SOL here');
  });

  it('refuses links, empty and too-long posts', () => {
    expect(() => cleanBody('check https://scam.xyz', 500)).toThrow(BadRequestException);
    expect(() => cleanBody('   ', 500)).toThrow(BadRequestException);
    expect(() => cleanBody('x'.repeat(501), 500)).toThrow(BadRequestException);
  });

  it('lets a card post have no text', () => {
    expect(cleanBody('', 500, true)).toBe('');
  });
});
