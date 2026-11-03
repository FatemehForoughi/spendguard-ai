import type { Request, Response } from 'express'
import { transactionRequestSchema } from '../validators/transaction.validator.js'
import { analyzeTransaction } from '../services/policy.service.js'
import { TransactionModel } from '../models/transaction.model.js'
import mongoose from 'mongoose'

export async function analyzeTransactionController(
  req: Request,
  res: Response,
) {
  const validation = transactionRequestSchema.safeParse(req.body)

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      message: 'Invalid transaction request',
      errors: validation.error.flatten(),
    })
  }

  try {
    const result = await analyzeTransaction(validation.data.request)

    return res.status(200).json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('Transaction analysis failed:', error)

    return res.status(502).json({
      success: false,
      message: 'Transaction analysis is temporarily unavailable.',
    })
  }
}

export async function getTransactionsController(
  req: Request,
  res: Response,
) {
  try {
    const page = Number(req.query.page ?? 1)
    const limit = Number(req.query.limit ?? 10)

    if (
      !Number.isInteger(page) ||
      !Number.isInteger(limit) ||
      page < 1 ||
      limit < 1 ||
      limit > 100
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pagination parameters.',
        errors: {
          page: 'Page must be a positive integer.',
          limit: 'Limit must be between 1 and 100.',
        },
      })
    }

    const skip = (page - 1) * limit

    const [transactions, total] = await Promise.all([
      TransactionModel.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      TransactionModel.countDocuments(),
    ])

    return res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    })
  } catch (error) {
    console.error('Fetching transactions failed:', error)

    return res.status(500).json({
      success: false,
      message: 'Could not fetch transaction history.',
    })
  }
}

export async function getTransactionByIdController(
  req: Request,
  res: Response,
) {
  try {
    const { id } = req.params

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction ID.',
      })
    }

    const transaction = await TransactionModel.findById(id).lean()

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction analysis not found.',
      })
    }

    return res.status(200).json({
      success: true,
      data: transaction,
    })
  } catch (error) {
    console.error('Fetching transaction failed:', error)

    return res.status(500).json({
      success: false,
      message: 'Could not fetch transaction details.',
    })
  }
}