import {
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Body,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { MoviesService } from './movies.service';
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';

@Controller('movies')
export class MoviesController {
  constructor(private readonly moviesService: MoviesService) {}

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() createMovieDto: CreateMovieDto) {
    return this.moviesService.create(createMovieDto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(@Param('id') id: string, @Body() updateMovieDto: UpdateMovieDto) {
    return this.moviesService.update(id, updateMovieDto);
  }

  @Public()
  @Get()
  findAll(@Query('q') q?: string) {
    return this.moviesService.findAll(q);
  }

  @Public()
  @Get(':id/similar')
  findSimilar(@Param('id') id: string) {
    return this.moviesService.findSimilar(id);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.moviesService.findOne(id);
  }
}
