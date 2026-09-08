import { Module } from '@nestjs/common';
import { PruneService } from './prune.service';

@Module({ providers: [PruneService], exports: [PruneService] })
export class MaintenanceModule {}
