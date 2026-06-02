import { z } from 'zod';

const DeliveryMethodSchema = z.object({
  name: z.string(),
  description: z.string(),
});

const FeeDetailSchema = z.object({
  name: z.string(),
  amount: z.string(),
  description: z.string().optional(),
});

const FeeSchema = z.object({
  total: z.string(),
  asset: z.string(),
  details: z.array(FeeDetailSchema).optional(),
});

// GET /info
export const Sep38InfoSchema = z.object({
  assets: z.array(z.object({
    asset: z.string(),
    sell_delivery_methods: z.array(DeliveryMethodSchema).optional(),
    buy_delivery_methods: z.array(DeliveryMethodSchema).optional(),
    country_codes: z.array(z.string()).optional(),
  })),
});

// GET /prices
export const Sep38PricesSchema = z.object({
  buy_assets: z.array(z.object({
    asset: z.string(),
    price: z.string(),
    decimals: z.number().int(),
  })),
});

// GET /price
export const Sep38PriceSchema = z.object({
  price: z.string(),
  sell_amount: z.string(),
  buy_amount: z.string(),
  total_price: z.string().optional(),
  fee: FeeSchema.optional(),
});

// POST /quote
export const Sep38QuoteSchema = z.object({
  id: z.string(),
  price: z.string(),
  sell_asset: z.string(),
  buy_asset: z.string(),
  sell_amount: z.string(),
  buy_amount: z.string(),
  expires_at: z.string(),
  total_price: z.string().optional(),
  fee: FeeSchema.optional(),
});

export type Sep38Info   = z.infer<typeof Sep38InfoSchema>;
export type Sep38Prices = z.infer<typeof Sep38PricesSchema>;
export type Sep38Price  = z.infer<typeof Sep38PriceSchema>;
export type Sep38Quote  = z.infer<typeof Sep38QuoteSchema>;
