import { IsIn, IsString, MaxLength } from 'class-validator';
import type { CatalogItemType } from '../catalog';

/**
 * Note what is NOT here: no amount, no price, no currency, no duration. The
 * global ValidationPipe runs with forbidNonWhitelisted, so a request carrying
 * any of those is rejected outright rather than silently ignored.
 */
export class CreateCheckoutDto {
  @IsIn(['SUBSCRIPTION', 'COIN_PACK'])
  itemType: CatalogItemType;

  @IsString()
  @MaxLength(64)
  itemId: string;
}
