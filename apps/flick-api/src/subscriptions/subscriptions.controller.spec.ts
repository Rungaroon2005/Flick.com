import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsController', () => {
  let controller: SubscriptionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionsController],
      providers: [{ provide: SubscriptionsService, useValue: {} }],
    }).compile();

    controller = module.get(SubscriptionsController);
  });

  it('never activates a paid subscription before a payment gateway exists', () => {
    expect(() => controller.create()).toThrow(ServiceUnavailableException);
  });
});
