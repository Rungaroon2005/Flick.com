import {
  IsArray,
  ArrayNotEmpty,
  IsString,
  IsInt,
  IsOptional,
  IsUrl,
  IsISO31661Alpha2,
  Min,
  Max,
  MinLength,
} from 'class-validator';

export class CreateMovieDto {
  @IsString()
  @MinLength(2)
  title: string;

  @IsString()
  @MinLength(10)
  description: string;

  @IsUrl()
  posterUrl: string;

  @IsUrl()
  @IsOptional()
  trailerUrl?: string;

  @IsInt()
  @Min(1900)
  @Max(new Date().getFullYear() + 5)
  year: number;

  @IsString()
  contentRating: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  genreSlugs!: string[];

  // ISO 3166-1 alpha-2, e.g. "KR" -- not a display string (NewPlan Part D,
  // phase 2 recommendation, §1.4). This decorator protects real bootstrap
  // (main.ts registers the global ValidationPipe); MoviesService also
  // checks it directly, since e2e tests build Nest's testing module
  // straight from AppModule and never run through main.ts's bootstrap().
  @IsOptional()
  @IsISO31661Alpha2()
  originCountry?: string;
}
