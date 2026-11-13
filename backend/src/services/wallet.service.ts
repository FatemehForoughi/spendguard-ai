import { randomBytes } from 'node:crypto'
import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'
import { UserModel, WalletModel } from '../models/index.js'
import { WalletChallengeModel } from '../models/wallet-challenge.model.js'
import { SessionModel } from '../models/session.model.js'
import { verifyFullAccessKey, verifyNep413Signature } from './near-wallet-verifier.js'
import { hashToken, newToken, type AuthContext } from './session.service.js'

export const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000

export async function issueWalletChallenge(accountId: string, context: AuthContext | null) {
  const browserToken = newToken()
  const expiresAt = new Date(Date.now() + CHALLENGE_LIFETIME_MS)
  const recipient = new URL(env.CLIENT_URL).host
  const message = [
    'SpendGuard wallet ownership verification',
    context ? 'Link this wallet to your current SpendGuard account.' : 'Sign in to SpendGuard with this wallet.',
    `Account: ${accountId}`, `Network: NEAR ${env.NEAR_NETWORK_ID}`,
    `Website: ${new URL(env.CLIENT_URL).origin}`, `Expires: ${expiresAt.toISOString()}`,
    'This message proves wallet ownership. It does not authorize transactions or spending.',
  ].join('\n')
  const challenge = await WalletChallengeModel.create({
    accountId, networkId: env.NEAR_NETWORK_ID, message, recipient,
    nonce: randomBytes(32).toString('base64'), browserBindingHash: hashToken(browserToken), expiresAt,
    ...(context ? { ownerUserId: context.user._id, boundSessionId: context.session._id } : {}),
  })
  return { browserToken, challenge: {
    challengeId: challenge.challengeId, accountId, networkId: challenge.networkId,
    message, recipient, nonce: challenge.nonce, expiresAt,
  } }
}

export interface WalletProof {
  challengeId: string
  accountId: string
  publicKey: string
  signature: string
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
}

async function resolveUser(accountId: string, context: AuthContext | null,
  claimedWallet: Awaited<ReturnType<typeof WalletModel.findOne>>) {
  if (context) {
    if (claimedWallet && !claimedWallet.ownerUserId.equals(context.user._id)) {
      throw new AppError(409, 'WALLET_ALREADY_LINKED', 'This wallet is already linked to another SpendGuard account.')
    }
    return context.user
  }
  if (claimedWallet) {
    const user = await UserModel.findById(claimedWallet.ownerUserId)
    if (!user || user.status !== 'ACTIVE') throw new AppError(403, 'ACCOUNT_DISABLED', 'This SpendGuard account is unavailable.')
    return user
  }
  const identity = { authIssuer: `near:${env.NEAR_NETWORK_ID}`, authSubject: accountId }
  let user = await UserModel.findOne(identity)
  if (!user) {
    try {
      user = await UserModel.create(identity)
    } catch (error) {
      if (!isDuplicateKey(error)) throw error
      user = await UserModel.findOne(identity)
    }
  }
  if (!user || user.status !== 'ACTIVE') throw new AppError(403, 'ACCOUNT_DISABLED', 'This SpendGuard account is unavailable.')
  return user
}

export async function verifyWalletOwnership(proof: WalletProof, browserToken: string | undefined, context: AuthContext | null) {
  const invalidChallenge = () => new AppError(401, 'INVALID_WALLET_CHALLENGE', 'This wallet verification has expired or is invalid. Please start again.')
  const challenge = await WalletChallengeModel.findOne({ challengeId: proof.challengeId }).select('+browserBindingHash')
  if (!challenge || !browserToken || challenge.browserBindingHash !== hashToken(browserToken) ||
    challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now() ||
    challenge.accountId !== proof.accountId || challenge.networkId !== env.NEAR_NETWORK_ID) throw invalidChallenge()

  if (challenge.ownerUserId) {
    if (!context || !challenge.ownerUserId.equals(context.user._id) ||
      !challenge.boundSessionId?.equals(context.session._id)) throw invalidChallenge()
  } else if (context) {
    // Login challenges cannot switch or attach wallets after the browser's user changes.
    throw invalidChallenge()
  }
  if (!verifyNep413Signature(challenge, proof.publicKey, proof.signature)) {
    throw new AppError(401, 'INVALID_WALLET_SIGNATURE', 'The wallet signature could not be verified. Please start again.')
  }
  await verifyFullAccessKey(proof.accountId, proof.publicKey)

  if (context && (!await SessionModel.exists({ _id: context.session._id, ownerUserId: context.user._id,
    expiresAt: { $gt: new Date() }, revokedAt: { $exists: false } }) ||
    !await WalletModel.exists({ _id: context.wallet._id, ownerUserId: context.user._id,
      verificationStatus: 'VERIFIED', revokedAt: { $exists: false } }))) throw invalidChallenge()

  // Atomically claim a valid proof. Two concurrent requests cannot both use it,
  // and a challenge that expires during the RPC lookup cannot create a session.
  const consumed = await WalletChallengeModel.findOneAndUpdate({
    _id: challenge._id, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() },
  }, { $set: { consumedAt: new Date() } }, { new: true })
  if (!consumed) throw invalidChallenge()

  const network = `near:${env.NEAR_NETWORK_ID}`
  const claimedWallet = await WalletModel.findOne({ network, address: proof.accountId, verifiedAt: { $type: 'date' } })
  if (claimedWallet?.verificationStatus === 'REVOKED') {
    throw new AppError(403, 'WALLET_REVOKED', 'This wallet has been revoked in SpendGuard.')
  }
  const user = await resolveUser(proof.accountId, context, claimedWallet)
  let wallet = claimedWallet ?? await WalletModel.findOne({ ownerUserId: user._id, network, address: proof.accountId })
  if (wallet?.verificationStatus === 'REVOKED') throw new AppError(403, 'WALLET_REVOKED', 'This wallet has been revoked in SpendGuard.')
  const verification = { verificationStatus: 'VERIFIED' as const, verifiedAt: new Date(),
    verificationMethod: 'NEP413', verificationReference: challenge.challengeId, verifiedPublicKey: proof.publicKey }
  try {
    if (wallet) {
      Object.assign(wallet, verification)
      await wallet.save()
    } else {
      wallet = await WalletModel.create({ ownerUserId: user._id, network, address: proof.accountId, ...verification })
    }
  } catch (error) {
    if (isDuplicateKey(error) || (error instanceof Error && error.name === 'VersionError')) {
      throw new AppError(409, 'WALLET_OWNERSHIP_CONFLICT', 'Wallet ownership changed during verification. Please start again.')
    }
    throw error
  }
  // Disabled accounts never receive new authenticated sessions.
  if (!await UserModel.exists({ _id: user._id, status: 'ACTIVE' })) {
    throw new AppError(403, 'ACCOUNT_DISABLED', 'This SpendGuard account is unavailable.')
  }
  return { user, wallet }
}
