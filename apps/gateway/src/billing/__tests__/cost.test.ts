import { Decimal } from 'decimal.js';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../db/client.js';
import { computeCost, lookupPricing, type Pricing } from '../cost.js';
import { seedPricing } from '../../test/helpers.js';

afterAll(async () => { await closeDb(); });

// Deliberately synthetic numbers. Real provider prices are operator-configured
// data, not values this repo invents.
const pricing: Pricing = {
  inputPricePerMTok: new Decimal('3.00'),
  outputPricePerMTok: new Decimal('15.00'),
};

describe('computeCost', () => {
  it('computes exactly at magnitudes where floats lose precision', () => {
    const r = computeCost({ promptTokens: 1000, completionTokens: 500 }, pricing);
    // 1000/1e6*3 = 0.003 ; 500/1e6*15 = 0.0075 ; total 0.0105
    expect(r).toEqual({ known: true, costUsd: '0.0105000000' });
  });

  it('stays exact when summed many times, unlike floating point', () => {
    const single = computeCost({ promptTokens: 7, completionTokens: 3 }, pricing);
    if (!single.known) throw new Error('expected known');
    const total = new Decimal(single.costUsd).times(100_000);
    // 7/1e6*3 + 3/1e6*15 = 0.000021 + 0.000045 = 0.000066  -> x100000 = 6.6
    expect(total.toFixed(4)).toBe('6.6000');

    let floatSum = 0;
    for (let i = 0; i < 100_000; i += 1) floatSum += 0.000066;
    expect(floatSum).not.toBe(6.6); // the bug this design avoids
  });

  it('reports NO_USAGE distinctly from a zero cost', () => {
    expect(computeCost(null, pricing)).toEqual({
      known: false, costUsd: null, reason: 'NO_USAGE',
    });
  });

  it('reports NO_PRICING rather than silently charging nothing', () => {
    expect(computeCost({ promptTokens: 10, completionTokens: 10 }, null)).toEqual({
      known: false, costUsd: null, reason: 'NO_PRICING',
    });
  });

  it('treats a genuinely zero-token request as known and free', () => {
    expect(computeCost({ promptTokens: 0, completionTokens: 0 }, pricing)).toEqual({
      known: true, costUsd: '0.0000000000',
    });
  });
});

describe('lookupPricing', () => {
  it('returns null for an unpriced model instead of a default', async () => {
    expect(await lookupPricing(db, 'mock', 'never-configured')).toBeNull();
  });

  it('selects the price in force at the given time, not the newest', async () => {
    await seedPricing('mock', 'versioned', '1.00', '2.00');
    await db.insertInto('model_pricing').values({
      provider: 'mock', model: 'versioned',
      input_price_per_mtok: '9.00', output_price_per_mtok: '9.00',
      effective_from: new Date(Date.now() + 3_600_000), // future price
    }).execute();

    const now = await lookupPricing(db, 'mock', 'versioned');
    expect(now?.inputPricePerMTok.toFixed(2)).toBe('1.00');

    const later = await lookupPricing(db, 'mock', 'versioned', new Date(Date.now() + 7_200_000));
    expect(later?.inputPricePerMTok.toFixed(2)).toBe('9.00');
  });
});
