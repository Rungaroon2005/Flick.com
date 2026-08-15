import { ContentStatus, Prisma } from '@prisma/client';

/**
 * Availability rules shared by every endpoint capable of granting access or
 * charging for an episode. A live episode cannot belong to hidden content.
 */
export const AVAILABLE_EPISODE_FILTER = {
  deletedAt: null,
  season: {
    movie: {
      status: ContentStatus.PUBLISHED,
      deletedAt: null,
    },
  },
} satisfies Prisma.EpisodeWhereInput;
