import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  it('allows a route marked @Public without a token', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    expect(
      guard.canActivate({
        getHandler: () => {},
        getClass: () => {},
      } as ExecutionContext),
    ).toBe(true);
  });

  it('delegates to passport for a route that is not @Public', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    const spy = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockReturnValue(true);
    guard.canActivate({
      getHandler: () => {},
      getClass: () => {},
    } as ExecutionContext);
    expect(spy).toHaveBeenCalled();
  });
});
