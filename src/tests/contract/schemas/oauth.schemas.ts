import { z } from 'zod';

/**
 * Zod contract for Google's `POST /token` success envelope — the fields
 * `exchangeGoogleOAuthCode` actually consumes plus the documented OAuth 2.0
 * companions, so an upstream rename of `access_token` fails loudly here.
 */
export const GoogleTokenSuccessResponseContractSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    token_type: z.literal('Bearer'),
    scope: z.string().min(1),
  })
  .loose();

/**
 * Zod contract for Google's OIDC `GET /oauth2/v3/userinfo` envelope — `sub`,
 * `email`, and the strictly-boolean `email_verified` are the account-linking
 * inputs; the schema pins their types so a provider drift (e.g. stringly
 * `"true"`) cannot silently pass the takeover guard.
 */
export const GoogleUserinfoSuccessResponseContractSchema = z
  .object({
    sub: z.string().min(1),
    email: z.string().min(3),
    email_verified: z.boolean(),
    name: z.string().optional(),
    picture: z.string().optional(),
  })
  .loose();

/** Zod contract for GitHub's `POST /login/oauth/access_token` JSON success envelope. */
export const GitHubTokenSuccessResponseContractSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().min(1),
    scope: z.string(),
  })
  .loose();

/** Zod contract for GitHub's `GET /user` envelope — `id` is numeric upstream and stringified by our mapper. */
export const GitHubUserSuccessResponseContractSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().nullable().optional(),
    avatar_url: z.string().optional(),
  })
  .loose();

/** Zod contract for GitHub's `GET /user/emails` list — the primary+verified pair drives account linking. */
export const GitHubEmailsSuccessResponseContractSchema = z.array(
  z
    .object({
      email: z.string().min(3),
      primary: z.boolean(),
      verified: z.boolean(),
    })
    .loose(),
);

/** Zod contract for the JSON body OUR GitHub token exchange sends upstream. */
export const GitHubTokenOutgoingJsonContractSchema = z
  .object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
    code: z.string().min(1),
    code_verifier: z.string().min(1),
  })
  .strict();
