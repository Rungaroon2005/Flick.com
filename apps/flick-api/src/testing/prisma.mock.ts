export interface PrismaMock {
  movie: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  userCoin: { create: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
  subscription: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  episode: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  bookmark: {
    findMany: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
    findUnique: jest.Mock;
    upsert: jest.Mock;
    deleteMany: jest.Mock;
  };
  watchHistory: {
    upsert: jest.Mock;
    findMany: jest.Mock;
  };
  download: {
    findMany: jest.Mock;
    upsert: jest.Mock;
    deleteMany: jest.Mock;
  };
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
}

export const createPrismaMock = (): PrismaMock => {
  const mock: PrismaMock = {
    movie: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    userCoin: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    subscription: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    episode: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    bookmark: {
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    watchHistory: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    download: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    // Pass the SAME mock instance into the callback so that stubs set up
    // on `prisma.*` in a test (e.g. `prisma.user.findUnique.mockResolvedValue`)
    // are visible as `tx.*` inside code under test that runs through
    // `$transaction`. A previous version of this mock created a fresh,
    // un-stubbed mock here, which silently broke any test whose behavior
    // depended on transactional reads/writes.
    $transaction: jest.fn((fn: (tx: PrismaMock) => unknown) => fn(mock)),
    // Tagged-template call shape (`tx.$queryRaw\`...\``) doesn't matter to
    // a jest.fn() — tests just stub the resolved value directly.
    $queryRaw: jest.fn(),
  };
  return mock;
};
