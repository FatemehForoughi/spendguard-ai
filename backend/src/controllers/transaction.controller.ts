import type { NextFunction, Request, Response } from 'express'
import { transactionRequestSchema } from '../validators/transaction.validator.js'
import { analyzeTransaction } from '../services/policy.service.js'
import { TransactionModel } from '../models/transaction.model.js'
import mongoose from 'mongoose'
import { AppError } from '../errors/app-error.js'

// These legacy endpoints are anonymous. Owned records need authenticated routes in later phases.
function publicAnalysisFilter() {
  return {
    ownerUserId: { $exists: false },
    agentId: { $exists: false },
    operation: { $exists: false },
  }
}

export async function analyzeTransactionController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const validation = transactionRequestSchema.safeParse(req.body)

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_TRANSACTION_REQUEST',
      message: typeof req.body?.request === 'string'
        ? validation.error.issues[0]?.message
        : 'Please enter a transaction description of up to 1,000 characters.',
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
    return next(error)
  }
}

export async function getTransactionsController(
  req: Request,
  res: Response,
  next: NextFunction,
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
        code: 'INVALID_PAGINATION',
        message: 'Please choose a valid page and a page size between 1 and 100.',
        errors: {
          page: 'Page must be a positive integer.',
          limit: 'Limit must be between 1 and 100.',
        },
      })
    }

    const skip = (page - 1) * limit

    const [transactions, total] = await Promise.all([
      TransactionModel.find(publicAnalysisFilter())
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      TransactionModel.countDocuments(publicAnalysisFilter()),
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
    return next(new AppError(503, 'HISTORY_UNAVAILABLE', 'Transaction history is unavailable right now. Please try again.', { cause: error }))
  }
}

export async function getTransactionByIdController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { id } = req.params

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_TRANSACTION_ID',
        message: 'That transaction link is invalid. Please open a transaction from your history.',
      })
    }

    const transaction = await TransactionModel.findOne({ _id: id, ...publicAnalysisFilter() }).lean()

    if (!transaction) {
      return res.status(404).json({
        success: false,
        code: 'TRANSACTION_NOT_FOUND',
        message: 'That transaction could not be found. It may no longer be available.',
      })
    }

    return res.status(200).json({
      success: true,
      data: transaction,
    })
  } catch (error) {
    return next(new AppError(503, 'TRANSACTION_UNAVAILABLE', 'Transaction details are unavailable right now. Please try again.', { cause: error }))
  }
}
