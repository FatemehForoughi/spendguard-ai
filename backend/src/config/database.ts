import mongoose from 'mongoose'
import { env } from './env.js'

export const connectDatabase = async () => {
  try {
    if (!env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not configured')
    }

    await mongoose.connect(env.MONGODB_URI)

    console.log('MongoDB connected successfully')
  } catch (error) {
    console.error('MongoDB connection failed:', error)
    throw error
  }
}