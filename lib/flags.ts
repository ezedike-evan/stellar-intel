export type FlagName = 'intentFlow' | 'reputationWrites' | 'mcpAdvertisement' | 'v11Corridors';

export const flags: Record<FlagName, boolean> = {
  // Default to enabled unless explicitly set to 'off'
  intentFlow: (process.env.NEXT_PUBLIC_INTENT_FLOW || 'on') !== 'off',
  reputationWrites: (process.env.NEXT_PUBLIC_REPUTATION_WRITES || 'on') !== 'off',
  mcpAdvertisement: (process.env.NEXT_PUBLIC_MCP_ADVERTISE || 'on') !== 'off',
  // v1.1 target corridors (ZAR, XOF). Default OFF until anchors are onboarded —
  // opt in with NEXT_PUBLIC_V11_CORRIDORS=on. Even when on, a corridor stays
  // hidden until at least one anchor serves it (see VISIBLE_CORRIDORS).
  v11Corridors: (process.env.NEXT_PUBLIC_V11_CORRIDORS || 'off') === 'on',
};

export function isFlag(name: FlagName) {
  return flags[name];
}

export default { flags, isFlag };
export const FLAGS = {
  INTENT_FLOW: process.env.NEXT_PUBLIC_INTENT_FLOW === 'true',
};
