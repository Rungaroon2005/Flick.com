import { IsISO31661Alpha2, IsOptional } from 'class-validator';

/**
 * Only `originCountry` is editable today (NewPlan Part D, phase 2) --
 * nothing else on Movie has an admin editor yet, so a full partial-update
 * DTO would be unused surface. Extend field-by-field as editors are built.
 */
export class UpdateMovieDto {
  @IsOptional()
  @IsISO31661Alpha2()
  originCountry?: string;
}
