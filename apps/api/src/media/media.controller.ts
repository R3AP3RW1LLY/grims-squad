import { Controller, Get, Param, Req, Res, Inject } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { Public } from '../auth/auth.guard.js';
import { AVATAR_SERVICE } from './media.tokens.js';
import type { AvatarService } from './avatar.service.js';

/**
 * Serving stored images.
 *
 * ★ THROUGH US, NOT FROM THE BUCKET ★
 *
 * The bucket is never world-readable, so these bytes cannot be reached any
 * other way. That is the point: a public bucket URL leaks its own structure,
 * and anybody holding one avatar URL could work out the shape of the rest.
 * It also keeps the storage vendor out of every cached page.
 */
@Controller('v1/media')
export class MediaController {
  constructor(@Inject(AVATAR_SERVICE) private readonly avatars: AvatarService) {}

  /**
   * A member's avatar.
   *
   * ★ @Public, AND CORRECTLY SO ★
   *
   * Avatars appear on the public roster and on profile pages that signed-out
   * visitors can see. Requiring a session would break every one of those, and
   * the picture is one the member has already published to a Discord server of
   * a hundred people — it is not a secret we are choosing to reveal.
   *
   * A member id is a uuid, so this is not enumerable by guessing, and a missing
   * or unknown one answers identically to a member with no avatar. Whether that
   * id exists is not something this endpoint will confirm.
   */
  @Public()
  @Get('avatars/:userId')
  async avatar(
    @Param('userId') userId: string,
    @Req() _req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const stored = await this.avatars.read(userId).catch(() => null);

    if (stored === null) {
      /*
       * 404 rather than a placeholder image. The UI draws initials for a member
       * with no picture, and it can only do that if it is TOLD there is none —
       * serving a generic silhouette would make "no avatar" and "storage is
       * down" look identical, and both would render as a stranger's face.
       */
      void reply.status(404).send({ error: { code: 'RESOURCE_NOT_VISIBLE', message: 'No avatar.' } });
      return;
    }

    void reply
      .header('content-type', stored.contentType)
      /*
       * Cached hard, and safely: the URL carries the member id but the CONTENT
       * is whatever hash we currently hold, so a member changing their picture
       * would otherwise show the old one for a week.
       *
       * `must-revalidate` with a short max-age is the compromise — a browser
       * reuses it for the session without asking, and picks up a change within
       * the hour rather than within the week.
       */
      .header('cache-control', 'public, max-age=3600, must-revalidate')
      // Belt and braces against a stored file that is not what its type claims.
      // Costs nothing and forecloses a content-sniffing surprise.
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(stored.body));
  }
}
