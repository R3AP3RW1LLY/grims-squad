import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database.module.js';
import { TelemetryModule } from '../telemetry/telemetry.module.js';
import { SupportController } from './support.controller.js';
import { SupportConsoleController } from './support-console.controller.js';
import { SupportDeviceController } from './support-device.controller.js';
import { SupportService } from './support.service.js';

/**
 * Help & Support: the live chat, three doors onto one service.
 *
 *   SupportController         the asking side — members by session, guests by one-time token.
 *   SupportConsoleController  the answering side, behind SUPPORT_AGENT.
 *   SupportDeviceController   the same console for the companion app, by paired device token —
 *                             which is what TelemetryModule is imported for (PAIRING_SERVICE).
 *
 * The AI's first-responder turn (Wave 3) rides the seam Wave 1 left: SupportAnswerService —
 * exported by the @Global AiModule, so it needs no import here — is injected OPTIONALLY into
 * SupportService, which appends its answers as `ai` turns. AI ANSWERS FIRST, HUMAN ON DEMAND:
 * every conversation starts AI-handled, and "Talk to an officer" (or any officer's reply, or
 * the model being unreachable) hands it to a person for good.
 */
@Module({
  imports: [DatabaseModule, TelemetryModule],
  controllers: [SupportController, SupportConsoleController, SupportDeviceController],
  providers: [SupportService],
})
export class SupportModule {}
