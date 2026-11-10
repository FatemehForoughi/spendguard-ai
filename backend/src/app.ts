
import express from 'express'
import cors from 'cors'
import { env } from './config/env.js'
import transactionRoutes from './routes/transaction.routes.js'
import { AppError } from './errors/app-error.js'
import { errorHandler } from './middleware/error-handler.js'

const app = express()

app.use(cors({
  origin: env.CLIENT_URL
}))

app.use(express.json({ limit: '10kb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    message: 'SpendGuard API is running',
    environment: env.NODE_ENV
  })
})

app.use('/api/transactions', transactionRoutes)

app.use((_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'The requested information could not be found.'))
})

app.use(errorHandler)

export default app
