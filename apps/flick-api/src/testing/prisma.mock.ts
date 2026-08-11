export interface PrismaMock {
  movie: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  userCoin: { create: jest.Mock; findMany: jest.Mock };
  subscription: { findFirst: jest.Mock; create: jest.Mock };
  episode: { findUnique: jest.Mock };
  bookmark: { findMany: jest.Mock; create: jest.Mock; delete: jest.Mock; findUnique: jest.Mock };
  watchHistory: { upsert: jest.Mock; findMany: jest.Mock };
  $transaction: jest.Mock;
}

export const createPrismaMock = (): PrismaMock => ({
  movie:    { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  user:     { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  userCoin: { create: jest.fn(), findMany: jest.fn() },
  subscription: { findFirst: jest.fn(), create: jest.fn() },
  episode:  { findUnique: jest.fn() },
  bookmark: { findMany: jest.fn(), create: jest.fn(), delete: jest.fn(), findUnique: jest.fn() },
  watchHistory: { upsert: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn(async (fn: (tx: PrismaMock) => unknown) => fn(createPrismaMock())),
});
