import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { generateApiKey } from '../auth/apiKeys.js';

export interface Tenant {
  orgId: string;
  projectId: string;
  apiKeyId: string;
  apiKey: string;
}

/** Creates a fully isolated org/project/key so tests never share tenant state. */
export async function createTenant(label = 'test'): Promise<Tenant> {
  const suffix = randomUUID().slice(0, 8);
  const org = await db.insertInto('organizations')
    .values({ name: `${label}-${suffix}`, slug: `${label}-${suffix}` })
    .returning('id').executeTakeFirstOrThrow();

  const project = await db.insertInto('projects')
    .values({ org_id: org.id, name: 'default', slug: `default-${suffix}` })
    .returning('id').executeTakeFirstOrThrow();

  const key = generateApiKey();
  const inserted = await db.insertInto('api_keys')
    .values({
      project_id: project.id, name: 'test key',
      prefix: key.prefix, key_hash: key.keyHash, last4: key.last4,
    })
    .returning('id').executeTakeFirstOrThrow();

  return { orgId: org.id, projectId: project.id, apiKeyId: inserted.id, apiKey: key.plaintext };
}

export async function seedPricing(
  provider: string, model: string, inPrice: string, outPrice: string,
): Promise<void> {
  await db.insertInto('model_pricing')
    .values({
      provider, model,
      input_price_per_mtok: inPrice,
      output_price_per_mtok: outPrice,
      effective_from: new Date(Date.now() - 60_000),
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
}
