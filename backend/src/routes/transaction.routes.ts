import { Router } from 'express'

import {
  analyzeTransactionController,
  getTransactionsController,
  getTransactionByIdController,
} from '../controllers/transaction.controller.js'

const router = Router()

router.post('/analyze', analyzeTransactionController)

router.get('/', getTransactionsController)

router.get('/:id', getTransactionByIdController)

export default router