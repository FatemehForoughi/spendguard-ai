export interface WalletConfig {
  networkId: 'mainnet' | 'testnet'
  walletProvider: 'meteor-wallet'
  challengeLifetimeSeconds: number
}

export interface WalletRecord {
  id: string
  address: string
  network: 'near:mainnet' | 'near:testnet'
  verificationStatus: 'UNVERIFIED' | 'VERIFIED' | 'REVOKED'
  verifiedAt?: string
  revokedAt?: string
}

export interface WalletSession {
  user: { id: string }
  wallet: WalletRecord
  expiresAt: string
}

export interface WalletChallenge {
  challengeId: string
  accountId: string
  networkId: 'mainnet' | 'testnet'
  message: string
  recipient: string
  nonce: string
  expiresAt: string
}

export interface SignedWalletMessage {
  accountId: string
  publicKey: string
  signature: string
  state?: string
}
