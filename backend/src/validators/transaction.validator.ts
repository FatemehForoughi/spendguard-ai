
import { z } from 'zod'

export const transactionRequestSchema = z.object({
  request: z
    .string()
    .trim()
    .min(1, 'Transaction request is required')
    .max(1000, 'Request is too long'),
})

export type TransactionRequestInput = z.infer<
  typeof transactionRequestSchema
>
