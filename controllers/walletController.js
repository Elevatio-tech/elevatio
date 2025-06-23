const WalletService = require('../services/walletService');

class WalletController {
  constructor() {
    this.walletService = new WalletService();
  }

  // Get wallet balance
  async getWalletBalance(req, res) {
    try {
      const balance = await this.walletService.getWalletBalance(req.user.id);
      
      res.json({
        success: true,
        data: {
          balance: balance,
          formattedBalance: `₦${balance.toLocaleString()}`,
          currency: 'NGN'
        }
      });
    } catch (error) {
      console.error('Get wallet balance error:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        code: 'WALLET_BALANCE_ERROR'
      });
    }
  }

  // Get wallet summary (balance + recent transactions + pending withdrawals)
  async getWalletSummary(req, res) {
    try {
      const summary = await this.walletService.getWalletSummary(req.user.id);
      
      res.json({
        success: true,
        data: summary
      });
    } catch (error) {
      console.error('Get wallet summary error:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        code: 'WALLET_SUMMARY_ERROR'
      });
    }
  }

  // Fund wallet
  async fundWallet(req, res) {
    try {
      const { amount, paymentMethod } = req.body;

      // Validate input
      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Valid amount is required (must be greater than 0)',
          code: 'INVALID_AMOUNT'
        });
      }

      // Set minimum funding amount
      const minAmount = 100; // ₦100 minimum
      if (parseFloat(amount) < minAmount) {
        return res.status(400).json({
          success: false,
          error: `Minimum funding amount is ₦${minAmount}`,
          code: 'AMOUNT_TOO_LOW'
        });
      }

      if (!paymentMethod || !paymentMethod.type) {
        return res.status(400).json({
          success: false,
          error: 'Payment method and type are required',
          code: 'MISSING_PAYMENT_METHOD'
        });
      }

      // Validate payment method for wallet funding (cash not allowed for wallet funding)
      const validWalletMethods = ['card', 'bank_transfer', 'ussd', 'mobile_money'];
      if (!validWalletMethods.includes(paymentMethod.type)) {
        return res.status(400).json({
          success: false,
          error: `Invalid payment method for wallet funding. Supported methods: ${validWalletMethods.join(', ')}`,
          code: 'INVALID_WALLET_PAYMENT_METHOD'
        });
      }

      const result = await this.walletService.fundWallet(req.user.id, amount, paymentMethod);

      res.json({
        success: true,
        message: 'Wallet funding initiated successfully',
        data: {
          transaction: result.transaction,
          paymentLink: result.paymentResult.paymentLink,
          amount: result.paymentResult.amount,
          transactionId: result.paymentResult.transactionId,
          nextAction: {
            type: 'redirect',
            url: result.paymentResult.paymentLink,
            message: 'Please complete payment to fund your wallet'
          }
        }
      });
    } catch (error) {
      console.error('Wallet funding error:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        code: 'WALLET_FUNDING_ERROR'
      });
    }
  }

  // Complete wallet funding (callback after payment verification)
  async completeFunding(req, res) {
    try {
      const { transactionId } = req.body;

      if (!transactionId) {
        return res.status(400).json({
          success: false,
          error: 'Transaction ID is required',
          code: 'MISSING_TRANSACTION_ID'
        });
      }

      const result = await this.walletService.completeFunding(transactionId, req.body);

      res.json({
        success: true,
        message: result.message,
        data: {
          amount: result.amount,
          newBalance: result.newBalance,
          transactionId: result.transactionId,
          formattedBalance: `₦${result.newBalance.toLocaleString()}`
        }
      });
    } catch (error) {
      console.error('Complete funding error:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        code: 'FUNDING_COMPLETION_ERROR'
      });
    }
  }

  // Get wallet transactions
  async getWalletTransactions(req, res) {
    try {
      const { page = 1, limit = 20, type, status, startDate, endDate } = req.query;

      const filters = {};
      if (type) filters.type = type;
      if (status) filters.status = status;
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;

      const result = await this.walletService.getWalletTransactions(
        req.user.id,
        parseInt(page),
        parseInt(limit),
        filters
      );

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Get wallet transactions error:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        code: 'WALLET_TRANSACTIONS_ERROR'
      });
    }
  }

  // Request withdrawal
  async requestWithdrawal(req, res) {
    try {
      const { amount, bankDetails } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Valid amount is required',
          code: 'INVALID_AMOUNT'
        });
      }

      // Set minimum withdrawal amount
      const minAmount = 500; // ₦500 minimum
      if (parseFloat(amount) < minAmount) {
        return res.status(400).json({
          success: false,
          error: `Minimum withdrawal amount is ₦${minAmount}`,
          code: 'AMOUNT_TOO_LOW'
        });
      }

      if (!bankDetails || !bankDetails.accountNumber || !bankDetails.bankCode || !bankDetails.accountName) {
        return res.status(400).json({
          success: false,
          error: 'Complete bank details are required (accountNumber, bankCode, accountName)',
          code: 'MISSING_BANK_DETAILS'
        });
      }

      const result = await this.walletService.requestWithdrawal(req.user.id, amount, bankDetails);

      res.json({
        success: true,
        message: result.message,
        data: {
          withdrawalId: result.withdrawalId,
          amount: result.amount,
          status: result.status,
          formattedAmount: `₦${result.amount.toLocaleString()}`
        }
      });
    } catch (error) {
      console.error('Request withdrawal error:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        code: 'WALLET_WITHDRAWAL_ERROR'
      });
    }
  }

  // Get withdrawal history
  async getWithdrawalHistory(req, res) {
    try {
      const { page = 1, limit = 20, status } = req.query;

      const result = await this.walletService.getWithdrawalHistory(
        req.user.id,
        parseInt(page),
        parseInt(limit),
        status
      );

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Get withdrawal history error:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        code: 'WITHDRAWAL_HISTORY_ERROR'
      });
    }
  }

  // Credit wallet (mainly for refunds - internal use)
  async creditWallet(req, res) {
    try {
      const { userId, amount, description, reference } = req.body;

      // This endpoint might be restricted to admin users or internal services
      if (req.user.role !== "admin" && req.user.id !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Unauthorized access',
          code: 'UNAUTHORIZED'
        });
      }

      if (!userId || !amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Valid user ID and amount are required',
          code: 'INVALID_INPUT'
        });
      }

      const result = await this.walletService.creditWallet(
        userId,
        amount,
        description || 'Wallet credit',
        reference
      );

      res.json({
        success: true,
        message: result.message,
        data: {
          amount: result.amount,
          newBalance: result.newBalance,
          transactionId: result.transactionId,
          formattedAmount: `₦${result.amount.toLocaleString()}`,
          formattedBalance: `₦${result.newBalance.toLocaleString()}`
        }
      });
    } catch (error) {
      console.error('Credit wallet error:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        code: 'WALLET_CREDIT_ERROR'
      });
    }
  }

  // Verify wallet transaction
  async verifyTransaction(req, res) {
    try {
      const { transactionId } = req.params;

      if (!transactionId) {
        return res.status(400).json({
          success: false,
          error: 'Transaction ID is required',
          code: 'MISSING_TRANSACTION_ID'
        });
      }

      const result = await this.walletService.verifyWalletTransaction(transactionId);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Verify transaction error:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        code: 'TRANSACTION_VERIFICATION_ERROR'
      });
    }
  }

  // Process wallet payment (for booking payments)
  async processWalletPayment(req, res) {
    try {
      const { amount, description } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Valid amount is required',
          code: 'INVALID_AMOUNT'
        });
      }

      const result = await this.walletService.processWalletPayment(
        req.user.id,
        amount,
        description || 'Payment'
      );

      res.json({
        success: true,
        message: 'Wallet payment processed successfully',
        data: {
          transactionId: result.transactionId,
          status: result.status,
          previousBalance: result.gatewayResponse.previousBalance,
          newBalance: result.gatewayResponse.newBalance,
          formattedPreviousBalance: `₦${result.gatewayResponse.previousBalance.toLocaleString()}`,
          formattedNewBalance: `₦${result.gatewayResponse.newBalance.toLocaleString()}`
        }
      });
    } catch (error) {
      console.error('Process wallet payment error:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        code: 'WALLET_PAYMENT_ERROR'
      });
    }
  }
}

module.exports = WalletController;