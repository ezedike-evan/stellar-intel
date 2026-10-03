/**
 * Listed operators: issuer-only and crypto-only operators that are tracked and
 * shown in the anchor directory. They are NEVER read by the rate engine, router,
 * intent or MCP code.
 *
 * There is one `<id>.json` per operator in this directory, and the id equals the
 * file name. Import them below in alphabetical order.
 */
import type { ListedAnchor } from '@/types';
import { parseListedAnchors } from '@/lib/stellar/listed-anchor-schema';

import meshMzar from './mesh-mzar.json';
import moneygramMgusd from './moneygram-mgusd.json';
import nafuloo from './nafuloo.json';

const RAW: unknown[] = [meshMzar, moneygramMgusd, nafuloo];

export const LISTED_ANCHORS: readonly ListedAnchor[] = parseListedAnchors(RAW);
