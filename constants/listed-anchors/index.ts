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

import apsTokens from './aps-tokens.json';
import audd from './audd.json';
import fxdao from './fxdao.json';
import gmoTrust from './gmo-trust.json';
import gratz from './gratz.json';
import ixinium from './ixinium.json';
import luxPayband from './lux-payband.json';
import mauAccounts from './mau-accounts.json';
import meshMzar from './mesh-mzar.json';
import mirrasets from './mirrasets.json';
import mobius from './mobius.json';
import moneygramMgusd from './moneygram-mgusd.json';
import nafuloo from './nafuloo.json';
import naobtc from './naobtc.json';
import phoenix from './phoenix.json';
import reyts from './reyts.json';
import stronghold from './stronghold.json';
import ultraCapital from './ultra-capital.json';
import valtorum from './valtorum.json';

const RAW: unknown[] = [
  apsTokens,
  audd,
  fxdao,
  gmoTrust,
  gratz,
  ixinium,
  luxPayband,
  mauAccounts,
  meshMzar,
  mirrasets,
  mobius,
  moneygramMgusd,
  nafuloo,
  naobtc,
  phoenix,
  reyts,
  stronghold,
  ultraCapital,
  valtorum,
];

export const LISTED_ANCHORS: readonly ListedAnchor[] = parseListedAnchors(RAW);
