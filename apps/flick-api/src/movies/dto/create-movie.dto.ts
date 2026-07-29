import { IsString, IsInt, IsOptional, IsUrl, Min, Max, MinLength } from 'class-validator';

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

  @IsString()
  genre: string;
}
