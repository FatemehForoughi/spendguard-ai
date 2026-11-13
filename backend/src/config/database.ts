import mongoose from 'mongoose'
import { env } from './env.js'
import { UserModel, WalletModel, AgentModel, PolicyModel, GrantModel, TransactionModel } from '../models/index.js'

export const connectDatabase = async () => {
  try {
    if (!env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not configured')
    }

    await mongoose.connect(env.MONGODB_URI)
    // Do not accept requests before the unique identity/version/idempotency indexes are ready.
    await Promise.all([
      UserModel.init(), WalletModel.init(), AgentModel.init(),
      PolicyModel.init(), GrantModel.init(), TransactionModel.init(),
    ])

    console.log('MongoDB connected successfully')
  } catch (error) {
    console.error('MongoDB connection failed:', error)
    throw error
  }
}
