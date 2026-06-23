import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Load fixtures
const loadFixture = (name: string) => {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sep38', name), 'utf-8'));
};

const infoFixture = loadFixture('info.json');
const pricesFixture = loadFixture('prices.json');
const priceFixture = loadFixture('price.json');
const quoteFixture = loadFixture('quote.json');
const quoteErrorFixture = loadFixture('quote-error.json');

describe('SEP-38 Fixtures Coverage', () => {
  it('validates info endpoint fixture', () => {
    expect(infoFixture).toHaveProperty('assets');
    expect(infoFixture.assets).toBeInstanceOf(Array);
    expect(infoFixture.assets[0]).toHaveProperty('asset');
    expect(infoFixture.assets[0]).toHaveProperty('sell_delivery_methods');
  });

  it('validates prices endpoint fixture', () => {
    expect(pricesFixture).toHaveProperty('buy_assets');
    expect(pricesFixture.buy_assets).toBeInstanceOf(Array);
    expect(pricesFixture.buy_assets[0]).toHaveProperty('price');
  });

  it('validates price endpoint fixture', () => {
    expect(priceFixture).toHaveProperty('total_price');
    expect(priceFixture).toHaveProperty('price');
    expect(priceFixture).toHaveProperty('sell_amount');
    expect(priceFixture).toHaveProperty('buy_amount');
    expect(priceFixture).toHaveProperty('fee');
  });

  it('validates quote endpoint fixture (happy path)', () => {
    expect(quoteFixture).toHaveProperty('id');
    expect(quoteFixture).toHaveProperty('expires_at');
    expect(quoteFixture).toHaveProperty('total_price');
    expect(quoteFixture).toHaveProperty('price');
    expect(quoteFixture).toHaveProperty('sell_asset');
    expect(quoteFixture).toHaveProperty('sell_amount');
    expect(quoteFixture).toHaveProperty('buy_asset');
    expect(quoteFixture).toHaveProperty('buy_amount');
    expect(quoteFixture).toHaveProperty('fee');

    // Firm quote must have expires_at
    const expiresAt = new Date(quoteFixture.expires_at);
    expect(expiresAt.getTime()).toBeGreaterThan(0);
  });

  it('validates quote endpoint fixture (error path)', () => {
    expect(quoteErrorFixture).toHaveProperty('error');
    expect(quoteErrorFixture.error).toBeTypeOf('string');
  });
});
