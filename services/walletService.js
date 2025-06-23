const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../utils/emailService');
const axios = require('axios');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

class WalletService {
  constructor() {
    this.flutterwaveSecretKey = process.env.FLUTTERWAVE_SECRET_KEY;
    this.flutterwaveBaseUrl = process.env.FLUTTERWAVE_BASE_URL;
    this.currency = 'NGN';
    this.frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    this.minFundingAmount = 100; // ₦100 minimum
    this.minWithdrawalAmount = 500; // ₦500 minimum
  }

  // Get wallet balance from user_wallets table (primary source)
  async getWalletBalance(userId) {
    try {
      const { data: wallet, error } = await supabase
        .from('user_wallets')
        .select('balance')
        .eq('user_id', userId)
        .single();

      if (error) {
        console.error('Wallet balance fetch error:', error);
        // Fallback to users table if user_wallets doesn't exist
        const { data: user, error: userError } = await supabase
          .from('users')
          .select('wallet_balance')
          .eq('id', userId)
          .single();

        if (userError) {
          throw new Error('Failed to fetch wallet balance');
        }

        return parseFloat(user.wallet_balance) || 0;
      }

      return parseFloat(wallet.balance) || 0;
    } catch (error) {
      console.error('Get wallet balance error:', error);
      throw error;
    }
  }

  // Get or create user wallet (ensures wallet exists)
  async ensureUserWallet(userId) {
    try {
      // First try to get existing wallet
      const { data: existingWallet, error: fetchError } = await supabase
        .from('user_wallets')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (!fetchError && existingWallet) {
        return existingWallet;
      }

      // Create wallet if it doesn't exist
      const { data: newWallet, error: insertError } = await supabase
        .from('user_wallets')
        .insert({
          user_id: userId,
          balance: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertError) {
        console.error('Wallet creation error:', insertError);
        throw new Error('Failed to create user wallet');
      }

      return newWallet;
    } catch (error) {
      console.error('Ensure user wallet error:', error);
      throw error;
    }
  }

  // Create wallet transaction record (triggers will handle balance updates)
  async createWalletTransaction(transactionData) {
    try {
      // Ensure user wallet exists first
      await this.ensureUserWallet(transactionData.userId);

      const { data: transaction, error } = await supabase
        .from('wallet_transactions')
        .insert({
          user_id: transactionData.userId,
          type: transactionData.type, // 'credit' or 'debit'
          amount: parseFloat(transactionData.amount),
          description: transactionData.description,
          transaction_id: transactionData.transactionId,
          status: transactionData.status || 'completed',
          reference: transactionData.reference || null,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error('Wallet transaction creation error:', error);
        throw new Error('Failed to create wallet transaction');
      }

      return transaction;
    } catch (error) {
      console.error('Create wallet transaction error:', error);
      throw error;
    }
  }

  // Fund wallet via external payment
  async fundWallet(userId, amount, paymentMethod) {
    try {
      // Ensure user wallet exists
      await this.ensureUserWallet(userId);

      // Get user details
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('email, first_name, last_name, phone')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        throw new Error('User not found');
      }

      const fundingAmount = parseFloat(amount);

      // Validate minimum funding amount
      if (fundingAmount < this.minFundingAmount) {
        throw new Error(`Minimum funding amount is ₦${this.minFundingAmount}`);
      }

      const transactionRef = `wallet_fund_${userId}_${Date.now()}`;

      // Create Flutterwave payment payload
      const payload = {
        tx_ref: transactionRef,
        amount: fundingAmount,
        currency: this.currency,
        redirect_url: `${this.frontendUrl}/wallet/callback`,
        customer: {
          email: user.email,
          name: `${user.first_name} ${user.last_name}`,
          phonenumber: user.phone || paymentMethod.phoneNumber || ''
        },
        customizations: {
          title: 'Wallet Funding',
          description: `Add ₦${fundingAmount.toLocaleString()} to wallet`,
          logo: `${this.frontendUrl}/assets/logo.png`
        },
        meta: {
          user_id: userId,
          payment_type: 'wallet_funding'
        }
      };

      // Initialize payment with Flutterwave
      const response = await axios.post(
        `${this.flutterwaveBaseUrl}/payments`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.flutterwaveSecretKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (response.data.status !== 'success') {
        throw new Error(response.data.message || 'Failed to initialize wallet funding');
      }

      // Create pending wallet transaction record (triggers will handle wallet creation)
      const transaction = await this.createWalletTransaction({
        userId: userId,
        type: 'credit',
        amount: fundingAmount,
        description: 'Wallet funding via Flutterwave',
        transactionId: transactionRef,
        status: 'pending',
        reference: response.data.data.tx_ref
      });

      return {
        transaction,
        paymentResult: {
          status: 'pending',
          transactionId: transactionRef,
          paymentLink: response.data.data.link,
          gatewayResponse: response.data,
          amount: fundingAmount,
          currency: this.currency
        }
      };
    } catch (error) {
      console.error('Wallet funding error:', error);
      if (error.response) {
        console.error('Flutterwave funding response:', error.response.data);
      }
      throw error;
    }
  }

  // Complete wallet funding after payment verification
//   async completeFunding(transactionId, verificationData) {
//     try {
//       // Get the pending transaction
//       const { data: transaction, error: transactionError } = await supabase
//         .from('wallet_transactions')
//         .select('*')
//         .eq('transaction_id', transactionId)
//         .eq('status', 'pending')
//         .single();

//       if (transactionError || !transaction) {
//         throw new Error('Pending funding transaction not found');
//       }

//       // Update transaction status to completed (triggers will automatically update balances)
//       const { error: updateError } = await supabase
//         .from('wallet_transactions')
//         .update({
//           status: 'completed',
//           processed_at: new Date().toISOString(),
//           updated_at: new Date().toISOString()
//         })
//         .eq('transaction_id', transactionId);

//       if (updateError) {
//         console.error('Transaction update error:', updateError);
//         throw new Error('Failed to update transaction status');
//       }

//       // Get updated wallet balance
//       const newBalance = await this.getWalletBalance(transaction.user_id);

//       // Get user details for notification
//       const { data: user } = await supabase
//         .from('users')
//         .select('email, first_name, last_name')
//         .eq('id', transaction.user_id)
//         .single();

//       // Send success email
//       if (user) {
//         await sendEmail({
//           to: user.email,
//           subject: 'Wallet Funded Successfully - Elevatio',
//           template: 'wallet-funded',
//           data: {
//             userName: user.first_name,
//             amount: transaction.amount,
//             newBalance: newBalance,
//             transactionId: transactionId
//           }
//         });
//       }

//       return {
//         success: true,
//         message: 'Wallet funded successfully',
//         amount: transaction.amount,
//         newBalance: newBalance,
//         transactionId: transactionId
//       };
//     } catch (error) {
//       console.error('Complete funding error:', error);
//       throw error;
//     }
//   }
async completeFunding(transactionId, verificationData) {
  try {
    console.log('🎯 Starting wallet funding completion for:', transactionId);

    // Use database transaction to ensure atomicity
    const { data, error } = await supabase.rpc('complete_wallet_funding', {
      p_transaction_id: transactionId,
      p_verification_data: verificationData || {}
    });

    if (error) {
      console.error('Database transaction failed:', error);
      throw new Error('Failed to complete wallet funding: ' + error.message);
    }

    // If the stored procedure succeeded, send notification
    try {
      const { data: user } = await supabase
        .from('users')
        .select('email, first_name, last_name')
        .eq('id', data.user_id)
        .single();

      if (user) {
        await sendEmail({
          to: user.email,
          subject: 'Wallet Funded Successfully - Elevatio',
          template: 'wallet-funded',
          data: {
            userName: user.first_name,
            amount: data.amount,
            newBalance: data.new_balance,
            transactionId: transactionId
          }
        });
      }
    } catch (emailError) {
      console.warn('Email notification failed:', emailError);
      // Don't throw - wallet funding succeeded
    }

    return {
      success: true,
      message: 'Wallet funded successfully',
      amount: parseFloat(data.amount),
      newBalance: parseFloat(data.new_balance),
      transactionId: transactionId
    };

  } catch (error) {
    console.error('❌ Wallet funding completion failed:', error);
    throw error;
  }
}


  // Process wallet payment (for booking payments)
  async processWalletPayment(userId, amount, description = 'Payment') {
    try {
      // Ensure user wallet exists
      await this.ensureUserWallet(userId);

      // Check wallet balance
      const walletBalance = await this.getWalletBalance(userId);
      const paymentAmount = parseFloat(amount);

      if (walletBalance < paymentAmount) {
        throw new Error(`Insufficient wallet balance. Available: ₦${walletBalance.toLocaleString()}, Required: ₦${paymentAmount.toLocaleString()}`);
      }

      const transactionId = `wallet_payment_${Date.now()}`;

      // Create debit transaction record (triggers will automatically update balances)
      await this.createWalletTransaction({
        userId: userId,
        type: 'debit',
        amount: paymentAmount,
        description: description,
        transactionId: transactionId,
        status: 'completed'
      });

      // Get updated balance
      const newBalance = await this.getWalletBalance(userId);

      return {
        status: 'completed',
        transactionId: transactionId,
        gatewayResponse: {
          message: 'Wallet payment successful',
          previousBalance: walletBalance,
          newBalance: newBalance
        }
      };
    } catch (error) {
      console.error('Wallet payment error:', error);
      throw error;
    }
  }

  // Credit wallet (for refunds)
  async creditWallet(userId, amount, description = 'Refund', reference = null) {
    try {
      // Ensure user wallet exists
      await this.ensureUserWallet(userId);

      const creditAmount = parseFloat(amount);
      const transactionId = `wallet_credit_${Date.now()}`;

      // Create credit transaction record (triggers will automatically update balances)
      const transaction = await this.createWalletTransaction({
        userId: userId,
        type: 'credit',
        amount: creditAmount,
        description: description,
        transactionId: transactionId,
        status: 'completed',
        reference: reference
      });

      // Get updated balance
      const newBalance = await this.getWalletBalance(userId);

      // Get user details for notification
      const { data: user } = await supabase
        .from('users')
        .select('email, first_name, last_name')
        .eq('id', userId)
        .single();

      // Send notification email
      if (user) {
        await sendEmail({
          to: user.email,
          subject: 'Wallet Credited - Elevatio',
          template: 'wallet-credited',
          data: {
            userName: user.first_name,
            amount: creditAmount,
            newBalance: newBalance,
            description: description,
            transactionId: transactionId
          }
        });
      }

      return {
        success: true,
        message: 'Wallet credited successfully',
        amount: creditAmount,
        newBalance: newBalance,
        transactionId: transactionId,
        transaction: transaction
      };
    } catch (error) {
      console.error('Credit wallet error:', error);
      throw error;
    }
  }

  // Request wallet withdrawal
  async requestWithdrawal(userId, amount, bankDetails) {
    try {
      // Ensure user wallet exists
      await this.ensureUserWallet(userId);

      const withdrawalAmount = parseFloat(amount);

      // Validate minimum withdrawal amount
      if (withdrawalAmount < this.minWithdrawalAmount) {
        throw new Error(`Minimum withdrawal amount is ₦${this.minWithdrawalAmount}`);
      }

      // Check wallet balance
      const currentBalance = await this.getWalletBalance(userId);
      if (currentBalance < withdrawalAmount) {
        throw new Error(`Insufficient wallet balance. Available: ₦${currentBalance.toLocaleString()}, Requested: ₦${withdrawalAmount.toLocaleString()}`);
      }

      // Validate bank details
      if (!bankDetails.accountNumber || !bankDetails.bankCode || !bankDetails.accountName) {
        throw new Error('Complete bank details are required (accountNumber, bankCode, accountName)');
      }

      // Create withdrawal request
      const { data: withdrawal, error } = await supabase
        .from('wallet_withdrawals')
        .insert({
          user_id: userId,
          amount: withdrawalAmount,
          bank_account_number: bankDetails.accountNumber,
          bank_code: bankDetails.bankCode,
          bank_name: bankDetails.bankName || '',
          account_name: bankDetails.accountName,
          status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error('Withdrawal request error:', error);
        throw new Error('Failed to create withdrawal request');
      }

      // Get user details for notification
      const { data: user } = await supabase
        .from('users')
        .select('email, first_name, last_name')
        .eq('id', userId)
        .single();

      // Send confirmation email
      if (user) {
        await sendEmail({
          to: user.email,
          subject: 'Withdrawal Request Submitted - Elevatio',
          template: 'withdrawal-request',
          data: {
            userName: user.first_name,
            amount: withdrawalAmount,
            accountName: bankDetails.accountName,
            accountNumber: bankDetails.accountNumber,
            withdrawalId: withdrawal.id
          }
        });
      }

      return {
        success: true,
        message: 'Withdrawal request submitted successfully. It will be processed within 24 hours.',
        withdrawalId: withdrawal.id,
        amount: withdrawalAmount,
        status: 'pending'
      };
    } catch (error) {
      console.error('Request withdrawal error:', error);
      throw error;
    }
  }

  // Process withdrawal (admin function)
  async processWithdrawal(withdrawalId, status, adminNotes = null) {
    try {
      // Get withdrawal request
      const { data: withdrawal, error: fetchError } = await supabase
        .from('wallet_withdrawals')
        .select('*')
        .eq('id', withdrawalId)
        .single();

      if (fetchError || !withdrawal) {
        throw new Error('Withdrawal request not found');
      }

      if (withdrawal.status !== 'pending') {
        throw new Error('Withdrawal request has already been processed');
      }

      // Update withdrawal status
      const { error: updateError } = await supabase
        .from('wallet_withdrawals')
        .update({
          status: status,
          processed_at: new Date().toISOString(),
          admin_notes: adminNotes,
          updated_at: new Date().toISOString()
        })
        .eq('id', withdrawalId);

      if (updateError) {
        console.error('Withdrawal update error:', updateError);
        throw new Error('Failed to update withdrawal status');
      }

      // If withdrawal is approved, create debit transaction
      if (status === 'completed') {
        const transactionId = `withdrawal_${withdrawalId}_${Date.now()}`;
        
        await this.createWalletTransaction({
          userId: withdrawal.user_id,
          type: 'debit',
          amount: withdrawal.amount,
          description: `Withdrawal to ${withdrawal.account_name} (${withdrawal.bank_account_number})`,
          transactionId: transactionId,
          status: 'completed',
          reference: `withdrawal_${withdrawalId}`
        });
      }

      // Send notification email
      const { data: user } = await supabase
        .from('users')
        .select('email, first_name, last_name')
        .eq('id', withdrawal.user_id)
        .single();

      if (user) {
        const emailTemplate = status === 'completed' ? 'withdrawal-completed' : 'withdrawal-rejected';
        await sendEmail({
          to: user.email,
          subject: `Withdrawal ${status === 'completed' ? 'Completed' : 'Rejected'} - Elevatio`,
          template: emailTemplate,
          data: {
            userName: user.first_name,
            amount: withdrawal.amount,
            accountName: withdrawal.account_name,
            accountNumber: withdrawal.bank_account_number,
            withdrawalId: withdrawalId,
            adminNotes: adminNotes
          }
        });
      }

      return {
        success: true,
        message: `Withdrawal ${status} successfully`,
        withdrawalId: withdrawalId,
        status: status
      };
    } catch (error) {
      console.error('Process withdrawal error:', error);
      throw error;
    }
  }

  // Get wallet transactions with pagination
  async getWalletTransactions(userId, page = 1, limit = 20, filters = {}) {
    try {
      const offset = (page - 1) * limit;
      
      let query = supabase
        .from('wallet_transactions')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      // Apply filters
      if (filters.type) {
        query = query.eq('type', filters.type);
      }
      if (filters.status) {
        query = query.eq('status', filters.status);
      }
      if (filters.startDate) {
        query = query.gte('created_at', filters.startDate);
      }
      if (filters.endDate) {
        query = query.lte('created_at', filters.endDate);
      }

      const { data: transactions, error, count } = await query;

      if (error) {
        console.error('Wallet transactions fetch error:', error);
        throw new Error('Failed to fetch wallet transactions');
      }

      return {
        transactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      console.error('Get wallet transactions error:', error);
      throw error;
    }
  }

  // Get withdrawal history
  async getWithdrawalHistory(userId, page = 1, limit = 20, status = null) {
    try {
      const offset = (page - 1) * limit;

      let query = supabase
        .from('wallet_withdrawals')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) {
        query = query.eq('status', status);
      }

      const { data: withdrawals, error, count } = await query;

      if (error) {
        console.error('Withdrawal history fetch error:', error);
        throw new Error('Failed to fetch withdrawal history');
      }

      return {
        withdrawals,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      console.error('Get withdrawal history error:', error);
      throw error;
    }
  }

  // Get wallet summary using the optimized view
  async getWalletSummary(userId) {
    try {
      // Use the wallet_summary view for comprehensive data
      const { data: summary, error } = await supabase
        .from('wallet_summary')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        console.error('Wallet summary fetch error:', error);
        // Fallback to individual queries
        return await this.getWalletSummaryFallback(userId);
      }

      // Get recent transactions (last 5)
      const { transactions } = await this.getWalletTransactions(userId, 1, 5);

      return {
        balance: parseFloat(summary.current_balance) || 0,
        formattedBalance: `₦${(parseFloat(summary.current_balance) || 0).toLocaleString()}`,
        availableBalance: parseFloat(summary.available_balance) || 0,
        formattedAvailableBalance: `₦${(parseFloat(summary.available_balance) || 0).toLocaleString()}`,
        pendingWithdrawals: parseFloat(summary.pending_withdrawals) || 0,
        totalCredited: parseFloat(summary.total_credited) || 0,
        totalDebited: parseFloat(summary.total_debited) || 0,
        lastTransactionDate: summary.last_transaction_date,
        recentTransactions: transactions,
        currency: this.currency
      };
    } catch (error) {
      console.error('Get wallet summary error:', error);
      throw error;
    }
  }

  // Fallback wallet summary method
  async getWalletSummaryFallback(userId) {
    try {
      const balance = await this.getWalletBalance(userId);

      // Get recent transactions (last 5)
      const { transactions } = await this.getWalletTransactions(userId, 1, 5);

      // Get pending withdrawals
      const { data: pendingWithdrawals, error: withdrawalError } = await supabase
        .from('wallet_withdrawals')
        .select('amount')
        .eq('user_id', userId)
        .eq('status', 'pending');

      if (withdrawalError) {
        console.error('Pending withdrawals fetch error:', withdrawalError);
      }

      const pendingWithdrawalAmount = pendingWithdrawals?.reduce((sum, w) => sum + parseFloat(w.amount), 0) || 0;

      return {
        balance: balance,
        formattedBalance: `₦${balance.toLocaleString()}`,
        availableBalance: balance - pendingWithdrawalAmount,
        formattedAvailableBalance: `₦${(balance - pendingWithdrawalAmount).toLocaleString()}`,
        pendingWithdrawals: pendingWithdrawalAmount,
        recentTransactions: transactions,
        currency: this.currency
      };
    } catch (error) {
      console.error('Get wallet summary fallback error:', error);
      throw error;
    }
  }

  // Verify wallet transaction
  async verifyWalletTransaction(transactionId) {
    try {
      const { data: transaction, error } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('transaction_id', transactionId)
        .single();

      if (error || !transaction) {
        return {
          verified: false,
          status: 'not_found',
          successful: false,
          message: 'Wallet transaction not found'
        };
      }

      return {
        verified: true,
        status: transaction.status,
        successful: transaction.status === 'completed',
        amount: transaction.amount,
        currency: this.currency,
        reference: transactionId,
        data: transaction
      };
    } catch (error) {
      console.error('Wallet verification error:', error);
      throw error;
    }
  }

  // Validate wallet consistency (admin function)
  async validateWalletConsistency(userId = null) {
    try {
      let query = supabase.rpc('validate_wallet_consistency');
      
      if (userId) {
        // If specific user, filter the results
        const { data: results, error } = await query;
        if (error) throw error;
        
        return results.filter(result => result.user_id === userId);
      }

      const { data: results, error } = await query;
      if (error) throw error;

      return results;
    } catch (error) {
      console.error('Validate wallet consistency error:', error);
      throw error;
    }
  }

  // Get all wallets with issues (admin function)
  async getWalletsWithIssues() {
    try {
      const results = await this.validateWalletConsistency();
      return results.filter(result => !result.is_consistent);
    } catch (error) {
      console.error('Get wallets with issues error:', error);
      throw error;
    }
  }
}

module.exports = WalletService;