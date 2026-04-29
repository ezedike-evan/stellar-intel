/**
 * Base class for all Stellar-related wallet errors.
 */
export class WalletError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WalletError'
  }
}

/**
 * Thrown when the user explicitly rejects a transaction or connection request.
 */
export class UserRejectedError extends WalletError {
  constructor() {
    super('User rejected the request')
    this.name = 'UserRejectedError'
  }
}

/**
 * Thrown when there is a network mismatch (e.g. Testnet vs Mainnet)
 * or the horizon server is unreachable.
 */
export class NetworkError extends WalletError {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

/**
 * Thrown when the wallet extension is missing, locked, or failing to respond.
 */
export class ConnectionError extends WalletError {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectionError'
  }
}

/**
 * Fallback for unclassified errors.
 */
export class UnknownWalletError extends WalletError {
  constructor(message: string) {
    super(message)
    this.name = 'UnknownWalletError'
  }
}
