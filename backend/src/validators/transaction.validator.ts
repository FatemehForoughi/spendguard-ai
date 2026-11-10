
import { z } from 'zod'

export const transactionRequestSchema = z.object({
  request: z
    .string()
    .trim()
    .min(1, 'Please describe the transaction you want to analyze.')
    .max(1000, 'Keep your transaction description under 1,000 characters.'),
})

export type TransactionRequestInput = z.infer<
  typeof transactionRequestSchema
>
