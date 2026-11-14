import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InstanceAuth } from '../common/decorators/instance-auth.decorator';
import { UpdateService, type VersionInfo } from './update.service';

@ApiTags('system')
@Controller('v1/system')
export class UpdateController {
  constructor(private readonly updateService: UpdateService) {}

  @InstanceAuth('system.update')
  @Get('update/check')
  check(): Promise<VersionInfo> {
    return this.updateService.checkForUpdate();
  }

  @InstanceAuth('system.update')
  @Get('update/progress')
  progress() {
    return this.updateService.getProgress();
  }

  @InstanceAuth('system.update')
  @Post('update/apply')
  apply() {
    return this.updateService.applyUpdate();
  }
}
