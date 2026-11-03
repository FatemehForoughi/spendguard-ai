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
    console.error('Failed to start SpendGuard API:', error)
    process.exit(1)
  }
}

startServer()