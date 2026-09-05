import { Transform } from 'class-transformer';
import { IsIn } from 'class-validator';

export const ALLOWED_MAX_MINUTES = [15, 30, 60, 90] as const;
export type AllowedMaxMinutes = (typeof ALLOWED_MAX_MINUTES)[number];

/**
 * A whitelist, not an open Int range: this feeds a filter sheet with four
 * fixed buttons (15/30/60/90), and an unbounded numeric query param from a
 * public-facing endpoint is a scan surface for no product benefit.
 *
 * @Transform is required because the global ValidationPipe
 * (main.ts) does not set transform: true -- a query string arrives as
 * text, and @IsIn would otherwise compare the string "30" against the
 * numeric whitelist and always fail. The controller opts this one route
 * into transform: true locally via @UsePipes so this actually runs.
 */
export class FitsQueryDto {
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsIn(ALLOWED_MAX_MINUTES)
  maxMinutes: AllowedMaxMinutes;
}
