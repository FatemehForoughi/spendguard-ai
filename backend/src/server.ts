import { env } from './config/env.js'
import app from './app.js'
import { connectDatabase } from './config/database.js'

const startServer = async () => {
  try {
    await connectDatabase()

    app.listen(env.PORT, () => {
      console.log(`SpendGuard API running at http://localhost:${env.PORT}`)
    })
  } catch (error) {
    console.error('Failed to start SpendGuard API. Check MongoDB access and database indexes.')
    if (error && typeof error === 'object' && 'code' in error && (error.code === 85 || error.code === 86)) {
      console.error('An existing index conflicts with the current models. Run npm run migrate:wallet-index from backend to inspect the wallet index migration.')
    }
    process.exit(1)
  }
}

startServer()
