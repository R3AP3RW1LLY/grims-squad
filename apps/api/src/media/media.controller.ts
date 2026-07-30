import { Controller, Get, Post, Body, Param, Req, Res, Inject } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError, ErrorCode } from '@grims/shared';
import { Public } from '../auth/auth.guard.js';
import { User, type CurrentUser } from '../auth/current-user.js';
import { verifyCsrf, readCsrfCookie } from '../common/csrf.js';
import { PermissionService } from '../authz/permission.service.js';
import { UploadService } from './upload.service.js';
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
  constructor(
    @Inject(AVATAR_SERVICE) private readonly avatars: AvatarService,
    @Inject(UploadService) private readonly uploads: UploadService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

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

  /**
   * Uploads an image.
   *
   * NOT @Public. `uploader_id` is NOT NULL and comes from the session; storage costs
   * money; and an unauthenticated upload endpoint is a free file host on our domain.
   *
   * The body is the raw file, parsed to a Buffer by the content-type parser registered in
   * main.ts. There is no filename anywhere in this path, deliberately.
   */
  @Post('uploads')
  async upload(
    @User() caller: CurrentUser | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ id: string; path: string; width: number; height: number; bytes: number }> {
    if (caller === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to upload an image.');
    }
    csrf(req);

    /*
     * A Buffer is what the parser produces. Anything else means the request arrived with a
     * content type the parser does not handle — JSON, a form, nothing at all — and saying
     * so plainly is better than letting `hardenImage` report "that file was empty".
     */
    if (!Buffer.isBuffer(body)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Send the image itself as the request body, with its image content type.',
      );
    }

    const mask = await this.permissions.effectiveMask(caller.userId);
    return this.uploads.upload(caller.userId, mask, new Uint8Array(body));
  }

  /**
   * Serves an uploaded image.
   *
   * ★ @Public, AND THE REASONING IS IN upload.service.ts ★
   *
   * An image is readable by anyone holding its id. The id is an unguessable UUID published
   * only inside a post, so in practice an image is as private as the thread referencing it.
   * The alternative — resolving "may this caller read some post that references this
   * image" per request — is a join on the hottest path, depends on pattern-matching stored
   * HTML, and has no correct answer when the same image appears in both a public guide and
   * an officers' thread. That trade is documented at length on `UploadService.serve`.
   *
   * It MUST be public in any case: a public guide's screenshots are read by visitors with
   * no session at all.
   */
  @Public()
  @Get('uploads/:id')
  async servedUpload(
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const stored = await this.uploads.serve(id).catch(() => null);

    if (stored === null) {
      // Identical answer for absent, malformed and storage-unavailable. Whether an id
      // exists is not something this endpoint will confirm.
      void reply.status(404).send({ error: { code: 'RESOURCE_NOT_VISIBLE', message: 'No such image.' } });
      return;
    }

    void reply
      .header('content-type', stored.contentType)
      /*
       * IMMUTABLE, unlike the avatar route above — and the difference is real. An avatar
       * URL is keyed on the MEMBER, so its content changes when they change their picture.
       * An upload id names one specific set of bytes that can never change: there is no
       * edit path, and a replacement is a new upload with a new id.
       *
       * So this can be cached for a year, which matters for a guide carrying a dozen
       * screenshots that members re-read while following it.
       */
      .header('cache-control', 'public, max-age=31536000, immutable')
      /*
       * ★ THE THREE HEADERS THAT MATTER MORE THAN THE CACHE ONE ★
       *
       * nosniff       the content type is one WE encoded, and this stops a browser
       *               second-guessing it. Together with the re-encode, a stored file
       *               cannot be interpreted as anything but an image.
       * CSP sandbox   an empty sandbox: no scripts, no plugins, no same-origin
       *               privileges, even if this response were somehow interpreted as a
       *               document. Cheap insurance on a route that serves member content.
       * CD inline     with no filename, so nothing downstream reads one back out.
       */
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox; frame-ancestors 'none'")
      .header('content-disposition', 'inline')
      .send(Buffer.from(stored.body));
  }
}

function csrf(req: FastifyRequest): void {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  verifyCsrf(req.method, readCsrfCookie(cookies), req.headers['x-csrf-token'] as string | undefined);
}
