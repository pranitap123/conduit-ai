import { Decimal } from 'decimal.js';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import type { TokenUsage } from '../providers/types.js';

/**
 * Cost engine. See ADR-002 for why money is NUMERIC and never a float.
 *
 * Decimal.js is used for the arithmetic because the intermediate values are
 * genuinely tiny — a 500-token request on a cheap model costs about $0.000015 —
 * and IEEE-754 doubles accumulate error at that magnitude. Summing a million
 * such rows with floats produces a total that quietly disagrees with the
 * provider invoice, which is the one bug this whole product exists to prevent.
 */

const TOKENS_PER_PRICE_UNIT = new Decimal(1_000_000);

export interface Pricing {
  inputPricePerMTok: Decimal;
  outputPricePerMTok: Decimal;
}

export type CostResult =
  | { known: true; costUsd: string }
  | { known: false; costUsd: null; reason: 'NO_PRICING' | 'NO_USAGE' };

/**
 * Look up the price row in force at `at` for this provider/model.
 * Versioned by effective_from so a request from last month is costed with last
 * month's price, not today's.
 */
export async function lookupPricing(
  db: Kysely<DB>,
  provider: string,
  model: string,
  at: Date = new Date(),
): Promise<Pricing | null> {
  const row = await db
    .selectFrom('model_pricing')
    .select(['input_price_per_mtok', 'output_price_per_mtok'])
    .where('provider', '=', provider)
    .where('model', '=', model)
    .where('effective_from', '<=', at)
    .orderBy('effective_from', 'desc')
    .limit(1)
    .executeTakeFirst();

  if (row === undefined) return null;
  return {
    inputPricePerMTok: new Decimal(row.input_price_per_mtok),
    outputPricePerMTok: new Decimal(row.output_price_per_mtok),
  };
}

/**
 * `usage: null` and `pricing: null` are distinct outcomes and stay distinct all
 * the way to the dashboard. Collapsing either into 0.00 would let a request
 * whose cost we do not know look identical to a request that was free.
 */
export function computeCost(usage: TokenUsage | null, pricing: Pricing | null): CostResult {
  if (usage === null) return { known: false, costUsd: null, reason: 'NO_USAGE' };
  if (pricing === null) return { known: false, costUsd: null, reason: 'NO_PRICING' };

  const input = new Decimal(usage.promptTokens)
    .times(pricing.inputPricePerMTok)
    .dividedBy(TOKENS_PER_PRICE_UNIT);
  const output = new Decimal(usage.completionTokens)
    .times(pricing.outputPricePerMTok)
    .dividedBy(TOKENS_PER_PRICE_UNIT);

  // 10 decimal places matches NUMERIC(20,10). Round half-up, the convention
  // billing systems use, and round exactly once at the end.
  return {
    known: true,
    costUsd: input.plus(output).toDecimalPlaces(10, Decimal.ROUND_HALF_UP).toFixed(10),
  };
}
