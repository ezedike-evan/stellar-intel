import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAnchorHealthLedger } from '@/lib/stellar/anchors';
import { ledgerVersion } from '@/lib/stellar/health-ledger';

/**
 * The nightly anchor health ledger, exposed as an MCP *resource* (#1047).
 *
 * `constants/anchor-health.json` is a document, not an action: a client reads it
 * to know which anchors the nightly validator has flagged, and reads it whole.
 * Modelling that as a tool would make an agent call a function to obtain a file.
 * Resources exist for exactly this, and the server offered none.
 *
 * The read is served from the committed ledger — the same in-process value
 * `/api/v1/anchor-health/ledger` publishes — rather than probing anchors or
 * fetching over HTTP. Probing on read would make an agent's `resources/read`
 * hit seven third-party TOML endpoints, turn a document fetch into a source of
 * network failures, and report something the committed file does not say. The
 * committed file is the source of truth by definition; this serves it verbatim.
 */
export const ANCHOR_HEALTH_RESOURCE_URI = 'stellarintel://anchor-health/ledger';

export const ANCHOR_HEALTH_RESOURCE_NAME = 'anchor-health-ledger';

export const ANCHOR_HEALTH_RESOURCE_MIME_TYPE = 'application/json';

export function registerAnchorHealthResource(server: McpServer): void {
  server.registerResource(
    ANCHOR_HEALTH_RESOURCE_NAME,
    ANCHOR_HEALTH_RESOURCE_URI,
    {
      title: 'Anchor health ledger',
      description:
        'The nightly anchor health ledger, verbatim from constants/anchor-health.json: the ' +
        'consecutive-failure threshold it was evaluated against, when it was written, and one ' +
        'record per tracked anchor (consecutive failures, degraded flag, last check, last ' +
        'status and last error). Served from the committed file, not probed on read.',
      mimeType: ANCHOR_HEALTH_RESOURCE_MIME_TYPE,
    },
    (uri) => {
      const ledger = getAnchorHealthLedger();

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: ANCHOR_HEALTH_RESOURCE_MIME_TYPE,
            // Two reads that return the same `version` returned the same
            // ledger — the same identity `/api/v1/anchor-health/ledger` uses.
            text: JSON.stringify({ version: ledgerVersion(ledger), ledger }, null, 2),
          },
        ],
      };
    }
  );
}
