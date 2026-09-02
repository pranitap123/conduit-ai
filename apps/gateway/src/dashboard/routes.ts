import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import { generateApiKey } from '../auth/apiKeys.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import type { DB } from '../db/types.js';
import { apiError } from '../gateway/errors.js';
import { signSession, verifySession } from './sessions.js';
import { byModel, getRequest, listRequests, overview, timeseries } from './queries.js';

export interface DashboardDeps {
  db: Kysely<DB>;
  authSecret: string;
  secureCookies: boolean;
}

interface SessionUser { userId: string; orgId: string; role: string }

declare module 'fastify' {
  interface FastifyRequest { session?: SessionUser }
}

const COOKIE = 'tg_session';

export async function dashboardRoutes(app: FastifyInstance, deps: DashboardDeps): Promise<void> {
  /**
   * Resolves the session cookie to a user AND their org membership on every
   * request. The org is never taken from the URL or the request body — if it
   * were, changing an id in a query string would be a tenant escape.
   */
  const requireSession = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const raw = parseCookie(req.headers.cookie ?? '', COOKIE);
    const session = raw === null ? null : verifySession(raw, deps.authSecret);
    if (session === null) {
      await reply.code(401).send(apiError('authentication_error', 'Not signed in', req.id));
      return false;
    }
    const membership = await deps.db
      .selectFrom('memberships')
      .select(['org_id', 'role'])
      .where('user_id', '=', session.userId)
      .executeTakeFirst();

    if (membership === undefined) {
      await reply.code(403).send(apiError('permission_error', 'No organization', req.id));
      return false;
    }
    req.session = { userId: session.userId, orgId: membership.org_id, role: membership.role };
    return true;
  };

  // ------------------------------------------------------------------ auth

  app.post('/api/auth/signup', async (req, reply) => {
    const parsed = z.object({
      email: z.string().email(),
      password: z.string().min(10).max(200),
      orgName: z.string().min(1).max(100),
    }).safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(apiError('invalid_request_error', 'Invalid signup', req.id));
    }
    const { email, password, orgName } = parsed.data;

    const existing = await deps.db.selectFrom('users').select('id')
      .where('email', '=', email).executeTakeFirst();
    if (existing !== undefined) {
      // Same message as success would be better for enumeration resistance, but
      // signup genuinely cannot proceed. Accepted, and noted in docs/security.md.
      return reply.code(409).send(apiError('invalid_request_error', 'Email already registered', req.id));
    }

    const slug = `${orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Date.now().toString(36)}`;

    // One transaction: a user without an org, or an org with no owner, is a
    // broken state that no later request can repair.
    const userId = await deps.db.transaction().execute(async (trx) => {
      const user = await trx.insertInto('users')
        .values({ email, password_hash: await hashPassword(password) })
        .returning('id').executeTakeFirstOrThrow();
      const org = await trx.insertInto('organizations')
        .values({ name: orgName, slug }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('memberships')
        .values({ user_id: user.id, org_id: org.id, role: 'OWNER' }).execute();
      await trx.insertInto('projects')
        .values({ org_id: org.id, name: 'Default', slug: 'default' }).execute();
      return user.id;
    });

    setSessionCookie(reply, signSession(userId, deps.authSecret), deps.secureCookies);
    return reply.code(201).send({ ok: true });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = z.object({ email: z.string().email(), password: z.string() })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(apiError('invalid_request_error', 'Invalid login', req.id));
    }
    const user = await deps.db.selectFrom('users').select(['id', 'password_hash'])
      .where('email', '=', parsed.data.email).executeTakeFirst();

    // Hash even when the user does not exist, so response time does not reveal
    // whether an email is registered.
    const stored = user?.password_hash ?? 'scrypt$00$00';
    const ok = await verifyPassword(parsed.data.password, stored);
    if (user === undefined || !ok) {
      return reply.code(401).send(apiError('authentication_error', 'Invalid credentials', req.id));
    }
    setSessionCookie(reply, signSession(user.id, deps.authSecret), deps.secureCookies);
    return reply.send({ ok: true });
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.header('set-cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
    return reply.send({ ok: true });
  });

  app.get('/api/me', async (req, reply) => {
    if (!await requireSession(req, reply)) return reply;
    const s = req.session!;
    const org = await deps.db.selectFrom('organizations').select(['id', 'name'])
      .where('id', '=', s.orgId).executeTakeFirstOrThrow();
    const user = await deps.db.selectFrom('users').select('email')
      .where('id', '=', s.userId).executeTakeFirstOrThrow();
    return reply.send({ email: user.email, org, role: s.role });
  });

  // ------------------------------------------------------------- analytics

  const hoursOf = (req: FastifyRequest): number => {
    const raw = Number((req.query as { hours?: string }).hours ?? '24');
    return Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 720) : 24;
  };

  app.get('/api/overview', async (req, reply) => {
    if (!await requireSession(req, reply)) return reply;
    return reply.send(await overview(deps.db, req.session!.orgId, hoursOf(req)));
  });

  app.get('/api/timeseries', async (req, reply) => {
    if (!await requireSession(req, reply)) return reply;
    return reply.send(await timeseries(deps.db, req.session!.orgId, hoursOf(req)));
  });

  app.get('/api/models', async (req, reply) => {
    if (!await requireSession(req, reply)) return reply;
    return reply.send(await byModel(deps.db, req.session!.orgId, hoursOf(req)));
  });

  app.get('/api/requests', async (req, reply) => {
    if (!await requireSession(req, reply)) return reply;
    const q = req.query as Record<string, string | undefined>;
    const rows = await listRequests(deps.db, req.session!.orgId, {
      limit: Math.min(Number(q.limit ?? '50') || 50, 200),
      ...(q.status === undefined ? {} : { status: q.status }),
      ...(q.model === undefined ? {} : { model: q.model }),
      ...(q.provider === undefined ? {} : { provider: q.provider }),
      ...(q.before === undefined ? {} : { before: q.before }),
      ...(q.cacheHit === undefined ? {} : { cacheHit: q.cacheHit === 'true' }),
      ...(q.projectId === undefined ? {} : { projectId: q.projectId }),
    });
    const last = rows.at(-1);
    return reply.send({
      data: rows,
      nextCursor: last === undefined ? null : new Date(last.created_at).toISOString(),
    });
  });

  app.get('/api/requests/:id', async (req, reply) => {
    if (!await requireSession(req, reply)) return reply;
    const { id } = req.params as { id: string };
    const row = await getRequest(deps.db, req.session!.orgId, id);
    // 404, not 403: confirming that an id exists in someone else's org is
    // itself an information leak.
    if (row === undefined) {
      return reply.code(404).send(apiError('not_found', 'Request not found', req.id));
    }
    return reply.send(row);
  });

  // ------------------------------------------------------------- api keys

  app.get('/api/keys', async (req, reply) => {
    if (!await requireSession(req, reply)) return reply;
    const rows = await deps.db.selectFrom('api_keys')
      .innerJoin('projects', 'projects.id', 'api_keys.project_id')
      .where('projects.org_id', '=', req.session!.orgId)  // tenant predicate
      .select([
        'api_keys.id', 'api_keys.name', 'api_keys.prefix', 'api_keys.last4',
        'api_keys.created_at', 'api_keys.revoked_at', 'api_keys.expires_at',
        'api_keys.last_used_at', 'projects.name as project_name',
      ])
      .orderBy('api_keys.created_at', 'desc')
      .execute();
    // key_hash is never selected. There is no code path that returns it.
    return reply.send(rows);
  });

  app.post('/api/keys', async (req, reply) => {
    if (!await requireSession(req, reply)) return reply;
    if (req.session!.role === 'MEMBER') {
      return reply.code(403).send(apiError('permission_error', 'Requires ADMIN or OWNER', req.id));
    }
    const parsed = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(apiError('invalid_request_error', 'Invalid key name', req.id));
    }
    const project = await deps.db.selectFrom('projects').select('id')
      .where('org_id', '=', req.session!.orgId).orderBy('created_at').executeTakeFirstOrThrow();

    const key = generateApiKey();
    const row = await deps.db.insertInto('api_keys').values({
      project_id: project.id, name: parsed.data.name,
      prefix: key.prefix, key_hash: key.keyHash, last4: key.last4,
    }).returning(['id', 'name', 'prefix', 'last4', 'created_at']).executeTakeFirstOrThrow();

    // The ONLY moment the plaintext exists outside the caller's memory.
    return reply.code(201).send({ ...row, plaintext: key.plaintext });
  });

  app.post('/api/keys/:id/revoke', async (req, reply) => {
    if (!await requireSession(req, reply)) return reply;
    if (req.session!.role === 'MEMBER') {
      return reply.code(403).send(apiError('permission_error', 'Requires ADMIN or OWNER', req.id));
    }
    const { id } = req.params as { id: string };
    // The tenant check is in the UPDATE's WHERE clause, not a prior SELECT.
    // A read-then-write would leave a window where the key moves orgs between
    // the two statements; here the database enforces it atomically.
    const result = await deps.db.updateTable('api_keys')
      .set({ revoked_at: new Date() })
      .where('id', '=', id)
      .where('project_id', 'in',
        deps.db.selectFrom('projects').select('id').where('org_id', '=', req.session!.orgId))
      .executeTakeFirst();

    if (Number(result.numUpdatedRows) === 0) {
      return reply.code(404).send(apiError('not_found', 'Key not found', req.id));
    }
    return reply.send({ ok: true });
  });

  app.get('/api/projects', async (req, reply) => {
    if (!await requireSession(req, reply)) return reply;
    return reply.send(await deps.db.selectFrom('projects')
      .select(['id', 'name', 'slug', 'created_at'])
      .where('org_id', '=', req.session!.orgId).orderBy('created_at').execute());
  });
}

function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  // HttpOnly: JavaScript cannot read it, so an XSS bug cannot steal the session.
  // SameSite=Lax: the browser will not attach it to cross-site POSTs, which is
  // the CSRF defence for the state-changing routes above.
  reply.header('set-cookie',
    `tg_session=${token}; HttpOnly; Path=/; Max-Age=43200; SameSite=Lax${secure ? '; Secure' : ''}`);
}
