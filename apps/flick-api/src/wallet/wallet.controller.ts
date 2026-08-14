import { Body, Controller, Get, Post } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { SpendCoinsDto } from './dto/spend-coins.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';

@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  getWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getWallet(user.id);
  }

  @Post('spend')
  spend(@CurrentUser() user: AuthenticatedUser, @Body() dto: SpendCoinsDto) {
    return this.walletService.unlockEpisode(user.id, dto.episodeId);
  }
}
