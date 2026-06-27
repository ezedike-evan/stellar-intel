export type FlagName = 'intentFlow' | 'reputationWrites' | 'mcpAdvertisement';

export const flags: Record<FlagName, boolean> = {
  // Default to enabled unless explicitly set to 'off'
  intentFlow: (process.env.NEXT_PUBLIC_INTENT_FLOW || 'on') !== 'off',
  reputationWrites: (process.env.NEXT_PUBLIC_REPUTATION_WRITES || 'on') !== 'off',
  mcpAdvertisement: (process.env.NEXT_PUBLIC_MCP_ADVERTISE || 'on') !== 'off',
};

export function isFlag(name: FlagName) {
  return flags[name];
}

export default { flags, isFlag };
export const FLAGS = {
  INTENT_FLOW: process.env.NEXT_PUBLIC_INTENT_FLOW === 'true',
};
