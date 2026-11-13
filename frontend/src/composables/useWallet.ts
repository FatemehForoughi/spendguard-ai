import { inject, type InjectionKey } from 'vue'
import type { WalletFlow } from '../services/wallet-flow'

export const walletKey: InjectionKey<WalletFlow> = Symbol('wallet')
export function useWallet(): WalletFlow {
  const wallet = inject(walletKey)
  if (!wallet) throw new Error('Wallet connection is not initialized.')
  return wallet
}
