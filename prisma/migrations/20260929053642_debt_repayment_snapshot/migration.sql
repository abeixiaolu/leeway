-- AlterTable
ALTER TABLE "FixedExpense" ADD COLUMN     "isDebtRepayment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "isDebtRepayment" BOOLEAN NOT NULL DEFAULT false;
