export type PrismaMock = ReturnType<typeof createPrismaMock>;

export const createPrismaMock = () => ({
  movie:    { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  user:     { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  userCoin: { create: jest.fn(), findMany: jest.fn() },
  subscription: { findFirst: jest.fn(), create: jest.fn() },
  episode:  { findUnique: jest.fn() },
  bookmark: { findMany: jest.fn(), create: jest.fn(), delete: jest.fn(), findUnique: jest.fn() },
  watchHistory: { upsert: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(createPrismaMock())),
});
