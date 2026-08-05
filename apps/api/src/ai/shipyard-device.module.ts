import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module.js';
import { TelemetryModule } from '../telemetry/telemetry.module.js';
import { ShipyardDeviceController } from './shipyard-device.controller.js';

/**
 * The companion's shipyard door, as its own module.
 *
 * Not folded into AiModule: that module is @Global and deliberately import-free, and the pairing
 * service this door authenticates with lives in TelemetryModule. A tiny module that imports what
 * it needs beats threading a telemetry dependency into the one module everything else can see.
 * ShipyardService and ShipBuildService arrive through AiModule's global exports.
 */
@Module({
  imports: [AuthzModule, TelemetryModule],
  controllers: [ShipyardDeviceController],
})
export class ShipyardDeviceModule {}
