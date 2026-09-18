import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { Prisma, prisma } from '@kamby/db';
import { ProfileService } from './profile.service';
import type { R2StorageService, UploadableFile } from '../media/r2-storage.service';

jest.mock('@kamby/db', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    Prisma: actual.Prisma,
    prisma: {
      user: { update: jest.fn(), findUnique: jest.fn() },
    },
  };
});

const mockedPrisma = jest.mocked(prisma, { shallow: true });

function fakeR2(): jest.Mocked<Pick<R2StorageService, 'uploadAvatar'>> {
  return { uploadAvatar: jest.fn() };
}

describe('ProfileService', () => {
  let r2: ReturnType<typeof fakeR2>;
  let service: ProfileService;

  beforeEach(() => {
    jest.clearAllMocks();
    r2 = fakeR2();
    service = new ProfileService(r2 as never);
  });

  describe('getProfile', () => {
    it("returns the session user's own username/avatarUrl", async () => {
      (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({ username: 'alice', avatarUrl: 'a.png' });

      const result = await service.getProfile('user-1');

      expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { username: true, avatarUrl: true },
      });
      expect(result).toEqual({ username: 'alice', avatarUrl: 'a.png' });
    });

    it('throws rather than silently returning nulls if the session user row is somehow gone', async () => {
      (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getProfile('user-1')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('updateProfile', () => {
    it('normalizes a mixed-case username to lowercase before storing it', async () => {
      (mockedPrisma.user.update as jest.Mock).mockResolvedValue({ username: 'alice', avatarUrl: null });

      const result = await service.updateProfile('user-1', 'Alice');

      expect(mockedPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { username: 'alice' },
        select: { username: true, avatarUrl: true },
      });
      expect(result).toEqual({ username: 'alice', avatarUrl: null });
    });

    it('rejects a username that is too short, without touching the database', async () => {
      await expect(service.updateProfile('user-1', 'ab')).rejects.toThrow(BadRequestException);
      expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a username with disallowed characters', async () => {
      await expect(service.updateProfile('user-1', 'trader-99')).rejects.toThrow(BadRequestException);
      expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a reserved/impersonation-prone name, case-insensitively', async () => {
      await expect(service.updateProfile('user-1', 'Admin')).rejects.toThrow(BadRequestException);
      expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    });

    it('surfaces a username collision as a 409 Conflict, not a raw Prisma error', async () => {
      const collision = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
      });
      (mockedPrisma.user.update as jest.Mock).mockRejectedValue(collision);

      await expect(service.updateProfile('user-1', 'taken')).rejects.toThrow(ConflictException);
    });

    it('propagates a database failure that is not a uniqueness collision', async () => {
      (mockedPrisma.user.update as jest.Mock).mockRejectedValue(new Error('DB is down'));

      await expect(service.updateProfile('user-1', 'alice')).rejects.toThrow('DB is down');
    });
  });

  describe('uploadAvatar', () => {
    it('uploads to R2 and persists the resulting URL directly — never a client-supplied URL', async () => {
      const file: UploadableFile = { buffer: Buffer.from('fake'), mimetype: 'image/png', size: 4 };
      r2.uploadAvatar.mockResolvedValue('https://cdn.kambesh.com/avatars/user-1/abc.png');
      (mockedPrisma.user.update as jest.Mock).mockResolvedValue({
        username: 'alice',
        avatarUrl: 'https://cdn.kambesh.com/avatars/user-1/abc.png',
      });

      const result = await service.uploadAvatar('user-1', file);

      expect(r2.uploadAvatar).toHaveBeenCalledWith('user-1', file);
      expect(mockedPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { avatarUrl: 'https://cdn.kambesh.com/avatars/user-1/abc.png' },
        select: { username: true, avatarUrl: true },
      });
      expect(result.avatarUrl).toBe('https://cdn.kambesh.com/avatars/user-1/abc.png');
    });

    it('never writes to the database when the R2 upload itself fails', async () => {
      const file: UploadableFile = { buffer: Buffer.from('fake'), mimetype: 'image/png', size: 4 };
      r2.uploadAvatar.mockRejectedValue(new BadRequestException('Unsupported image type'));

      await expect(service.uploadAvatar('user-1', file)).rejects.toThrow(BadRequestException);
      expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
