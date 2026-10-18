import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Env } from '../config/env';
import { MAX_FILE_SIZE_BYTES, R2StorageService, type UploadableFile } from './r2-storage.service';

jest.mock('@aws-sdk/client-s3');

const mockedS3Client = jest.mocked(S3Client);

const FULL_R2_CONFIG: Partial<Env> = {
  R2_ENDPOINT: 'https://r2.example.test',
  R2_ACCESS_KEY_ID: 'key-id',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'avatars-bucket',
  R2_PUBLIC_BASE_URL: 'https://cdn.example.test/',
};

function fakeConfigService(overrides: Partial<Env> = {}): ConfigService<Env, true> {
  const values: Partial<Env> = { ...FULL_R2_CONFIG, ...overrides };
  return { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
}

function fakeFile(overrides: Partial<UploadableFile> = {}): UploadableFile {
  return { buffer: Buffer.from('fake-image-bytes'), mimetype: 'image/png', size: 1024, ...overrides };
}

describe('R2StorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedS3Client.prototype.send = jest.fn().mockResolvedValue(undefined);
  });

  describe('uploadAvatar validation', () => {
    it('rejects an unsupported mime type before ever touching R2', async () => {
      const service = new R2StorageService(fakeConfigService());

      await expect(service.uploadAvatar('user-1', fakeFile({ mimetype: 'image/svg+xml' }))).rejects.toThrow(
        BadRequestException,
      );
      expect(mockedS3Client.prototype.send).not.toHaveBeenCalled();
    });

    it('rejects a file over the real size cap, using the same exported constant the controller uses', async () => {
      const service = new R2StorageService(fakeConfigService());

      await expect(
        service.uploadAvatar('user-1', fakeFile({ size: MAX_FILE_SIZE_BYTES + 1 })),
      ).rejects.toThrow(BadRequestException);
      expect(mockedS3Client.prototype.send).not.toHaveBeenCalled();
    });

    it('accepts a file exactly at the size cap — the check is over-the-limit, not at-or-over', async () => {
      const service = new R2StorageService(fakeConfigService());

      await expect(service.uploadAvatar('user-1', fakeFile({ size: MAX_FILE_SIZE_BYTES }))).resolves.toBeDefined();
    });

    it.each(['image/png', 'image/jpeg', 'image/webp'])('accepts %s', async (mimetype) => {
      const service = new R2StorageService(fakeConfigService());
      await expect(service.uploadAvatar('user-1', fakeFile({ mimetype }))).resolves.toBeDefined();
    });
  });

  describe('configuration gaps', () => {
    it('throws a real, actionable InternalServerErrorException when the client credentials are missing', async () => {
      const service = new R2StorageService(fakeConfigService({ R2_ENDPOINT: undefined }));

      await expect(service.uploadAvatar('user-1', fakeFile())).rejects.toThrow(InternalServerErrorException);
    });

    it('throws the same real error when the bucket/public URL are missing', async () => {
      const service = new R2StorageService(fakeConfigService({ R2_BUCKET_NAME: undefined }));

      await expect(service.uploadAvatar('user-1', fakeFile())).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('a real successful upload', () => {
    it('uploads to a randomly-named key scoped under the user, never the client-supplied filename', async () => {
      const service = new R2StorageService(fakeConfigService());

      await service.uploadAvatar('user-42', fakeFile({ mimetype: 'image/jpeg' }));

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'avatars-bucket',
          Key: expect.stringMatching(/^avatars\/user-42\/[0-9a-f-]{36}\.jpg$/),
          ContentType: 'image/jpeg',
        }),
      );
    });

    it('returns a public URL built from the real R2_PUBLIC_BASE_URL, not the internal R2 endpoint', async () => {
      const service = new R2StorageService(fakeConfigService());

      const url = await service.uploadAvatar('user-1', fakeFile());

      expect(url.startsWith('https://cdn.example.test/avatars/user-1/')).toBe(true);
      expect(url).not.toContain('r2.example.test');
    });

    it('reuses one S3Client across multiple uploads rather than reconnecting every time', async () => {
      const service = new R2StorageService(fakeConfigService());

      await service.uploadAvatar('user-1', fakeFile());
      await service.uploadAvatar('user-1', fakeFile());

      expect(mockedS3Client).toHaveBeenCalledTimes(1);
    });
  });
});

describe('R2StorageService avatar fallback (2026-10-18)', () => {
  it('only ever reads avatars/<uuid>/<uuid>.<png|jpg|webp> — never another key in the bucket', async () => {
    const config = { get: (k: string) => ({ R2_ENDPOINT: 'https://r2.example', R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret', R2_VOICE_BUCKET_NAME: 'kamby-voice' } as Record<string, string>)[k] } as never;
    const service = new R2StorageService(config);
    const user = '11111111-1111-1111-1111-111111111111';
    for (const bad of ['../voice/x.webm', '22222222-2222-2222-2222-222222222222.webm', 'x.png', '22222222-2222-2222-2222-222222222222.png.webm']) {
      await expect(service.getAvatar(user, bad)).rejects.toThrow('No such picture.');
    }
    await expect(service.getAvatar('../voice', '22222222-2222-2222-2222-222222222222.png')).rejects.toThrow('No such picture.');
  });
});
