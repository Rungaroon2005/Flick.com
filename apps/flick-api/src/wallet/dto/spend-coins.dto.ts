import { IsString, IsNotEmpty } from 'class-validator';

/**
 * The client supplies ONLY the episode id — never a coin amount. The price
 * is always looked up server-side from `episode.coinCost` in
 * `WalletService.unlockEpisode`. A DTO with a client-controlled `amount`
 * field would let anyone unlock episodes for whatever price they choose.
 */
export class SpendCoinsDto {
  @IsString()
  @IsNotEmpty()
  episodeId: string;
}
