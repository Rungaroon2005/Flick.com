import { Test, TestingModule } from '@nestjs/testing';
import { MoviesController } from './movies.controller';
import { MoviesService } from './movies.service';

describe('MoviesController', () => {
  let controller: MoviesController;
  let moviesService: { create: jest.Mock; findAll: jest.Mock; findOne: jest.Mock };

  beforeEach(async () => {
    moviesService = { create: jest.fn(), findAll: jest.fn(), findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MoviesController],
      providers: [
        { provide: MoviesService, useValue: moviesService },
      ],
    }).compile();

    controller = module.get<MoviesController>(MoviesController);
  });

  it('findOne calls the service with the id and returns the result', async () => {
    const mockMovie = { id: 'm1', title: 'Test Movie' };
    moviesService.findOne.mockResolvedValue(mockMovie);
    const result = await controller.findOne('m1');
    expect(moviesService.findOne).toHaveBeenCalledWith('m1');
    expect(result).toEqual(mockMovie);
  });
});
