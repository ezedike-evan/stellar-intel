import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// ─── Prompt: choose an anchor on a corridor (#1048) ──────────────────────────
//
// Walks a client through comparing the available anchors on a corridor so it can
// pick the best one before quoting. Anchors are compared via intel.offramp.quote,
// which returns the live net-received amount per anchor.

export const CHOOSE_ANCHOR_PROMPT_NAME = 'intel.offramp.choose-anchor';

const chooseAnchorArgs = {
  from: z.string().min(1).describe('Source asset code, e.g. USDC'),
  to: z.string().min(1).describe('Destination fiat currency code, e.g. NGN'),
};

export function registerChooseAnchorPrompt(server: McpServer): void {
  server.registerPrompt(
    CHOOSE_ANCHOR_PROMPT_NAME,
    {
      title: 'Choose an anchor on a corridor',
      description:
        'Compare the anchors available on a corridor so the agent can pick the best one before quoting an off-ramp.',
      argsSchema: chooseAnchorArgs,
    },
    async ({ from, to }) => {
      const corridor = `${from}-${to}`.toLowerCase();
      const text = [
        `I want to off-ramp ${from} to ${to} on the "${corridor}" corridor and need to choose the best anchor.`,
        '',
        'Steps to follow:',
        `1. For the corridor "${corridor}", call the tool "intel.offramp.quote" once per candidate anchor with the same (from, to, amount) so quotes are comparable.`,
        '   The tool returns an "anchor" (the anchor id), a "quoteId", the "netReceived" amount in the destination currency, and an "expiresAt" timestamp.',
        '2. Compare the "netReceived" values across anchors — higher means more fiat lands with the recipient for the same source amount.',
        '3. Pick the anchor with the best net-received amount (and a validity window that fits the flow).',
        '4. Remember the chosen anchor id and its quoteId — they are needed when you move on to quoting and preparing the off-ramp.',
        '',
        'If "intel.offramp.quote" returns a NO_ROUTE error for the corridor, report that no anchor is available and stop.',
      ].join('\n');
      return {
        messages: [
          {
            role: 'user',
            content: { type: 'text', text },
          },
        ],
      };
    }
  );
}

// ─── Prompt: quote and prepare an off-ramp (#1048) ──────────────────────────
//
// Drives the full off-ramp sequence: quote the corridor, prepare the unsigned
// intent + transaction, and (once the agent signs) execute. References the three
// relevant tools by name so a client can follow the exact call order.

export const QUOTE_AND_PREPARE_PROMPT_NAME = 'intel.offramp.quote-and-prepare';

const quoteAndPrepareArgs = {
  from: z.string().min(1).describe('Source asset code, e.g. USDC'),
  to: z.string().min(1).describe('Destination fiat currency code, e.g. NGN'),
  amount: z.string().describe('Decimal amount of the source asset to off-ramp'),
  sender: z.string().describe('Stellar public key of the off-ramping account'),
  recipient: z.string().min(1).describe('Off-chain recipient identifier'),
};

export function registerQuoteAndPreparePrompt(server: McpServer): void {
  server.registerPrompt(
    QUOTE_AND_PREPARE_PROMPT_NAME,
    {
      title: 'Quote and prepare an off-ramp',
      description:
        'Quote a corridor, prepare the unsigned off-ramp intent + transaction, and execute once the agent has signed.',
      argsSchema: quoteAndPrepareArgs,
    },
    async ({ from, to, amount, sender, recipient }) => {
      const text = [
        `I want to off-ramp ${amount} ${from} to ${to} for recipient "${recipient}", sent from Stellar account ${sender}.`,
        '',
        'Steps to follow:',
        `1. Call the tool "intel.offramp.quote" with from="${from}", to="${to}", amount="${amount}".`,
        '   Capture the returned "anchor", "quoteId", "netReceived", and "expiresAt".',
        '   If the quote has expired by the time you act, re-call the tool to refresh it.',
        `2. Call the tool "intel.offramp.prepare" with type="offramp", sourceAsset="${from}", destinationAsset="${to}", amount="${amount}", sender="${sender}", recipient="${recipient}".`,
        '   This returns an "unsignedEnvelope" (intent + intentHash) and an "unsignedTx". The agent must sign both with its own wallet — Stellar Intel never signs.',
        '   - Sign "intentHash" (UTF-8 bytes) with the sender key to produce the intent attestation signature.',
        '   - Sign "unsignedTx" with the sender key to produce the signed transaction XDR.',
        '3. Call the tool "intel.execute" with the signed envelope: pass "unsignedEnvelope" from step 2, "signature" from the intent attestation, and "signedTx" from the signed transaction.',
        '   The tool verifies the signatures and submits to Horizon, returning status, hash, ledger, corridorId, and anchorId.',
        '',
        'Only proceed to "intel.execute" after the agent has produced both signatures; do not invent them.',
      ].join('\n');
      return {
        messages: [
          {
            role: 'user',
            content: { type: 'text', text },
          },
        ],
      };
    }
  );
}

export function registerPrompts(server: McpServer): void {
  registerChooseAnchorPrompt(server);
  registerQuoteAndPreparePrompt(server);
}
