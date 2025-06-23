const express = require('express');
const router = express.Router();
const WalletController = require('../controllers/walletController');
const { 
  authenticateToken, 
  withdrawalLimiter,
  fundingLimiter,
} = require('../middleware/auth');
const PaymentService = require('../services/paymentService');
// const rateLimit = require('express-rate-limit');

// Initialize controller
const walletController = new WalletController();
const paymentService = new PaymentService();

// // Rate limiting for sensitive operations
// const withdrawalLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 3, // Limit each IP to 3 withdrawal requests per windowMs
//   message: {
//     success: false,
//     error: 'Too many withdrawal requests, please try again later.',
//     code: 'RATE_LIMIT_EXCEEDED'
//   }
// });

// const fundingLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 10, // Limit each IP to 10 funding requests per windowMs
//   message: {
//     success: false,
//     error: 'Too many funding requests, please try again later.',
//     code: 'RATE_LIMIT_EXCEEDED'
//   }
// });

// Apply authentication middleware to all routes
router.use(authenticateToken);

// ======================
// WALLET BALANCE ROUTES
// ======================

// GET /api/wallet/balance - Get wallet balance
router.get('/balance', walletController.getWalletBalance.bind(walletController));

// GET /api/wallet/summary - Get wallet summary (balance + recent transactions + pending withdrawals)
router.get('/summary', walletController.getWalletSummary.bind(walletController));

// ======================
// WALLET FUNDING ROUTES
// ======================

// POST /api/wallet/fund - Fund wallet via external payment
router.post('/fund', fundingLimiter, walletController.fundWallet.bind(walletController));

// POST /api/wallet/fund/complete - Complete wallet funding after payment verification
router.post('/fund/complete', walletController.completeFunding.bind(walletController));

// ======================
// WALLET PAYMENT ROUTES
// ======================

// POST /api/wallet/pay - Process payment using wallet balance
router.post('/pay', walletController.processWalletPayment.bind(walletController));

// ======================
// WALLET CREDIT ROUTES (For refunds and internal use)
// ======================

// POST /api/wallet/credit - Credit wallet (mainly for refunds)
router.post('/credit', walletController.creditWallet.bind(walletController));

// ======================
// WALLET WITHDRAWAL ROUTES
// ======================

// POST /api/wallet/withdraw - Request withdrawal from wallet
router.post('/withdraw', withdrawalLimiter, walletController.requestWithdrawal.bind(walletController));

// GET /api/wallet/withdrawals - Get withdrawal history
router.get('/withdrawals', walletController.getWithdrawalHistory.bind(walletController));

// ======================
// TRANSACTION ROUTES
// ======================

// GET /api/wallet/transactions - Get wallet transactions with pagination and filters
router.get('/transactions', walletController.getWalletTransactions.bind(walletController));

// GET /api/wallet/transactions/:transactionId/verify - Verify a specific wallet transaction
router.get('/transactions/:transactionId/verify', walletController.verifyTransaction.bind(walletController));

router.get('/callback', async (req, res) => {
  try {
    const { status, tx_ref, transaction_id } = req.query;
    
    console.log('💰 Wallet funding callback received:', { status, tx_ref, transaction_id });

    if (status === 'successful' && tx_ref) {
      // Verify and complete the funding
      const verificationResult = await paymentService.verifyWalletFunding(tx_ref);
      
      if (verificationResult.successful) {
        // Redirect to success page
        return res.redirect(`${process.env.FRONTEND_URL}/wallet?funding=success&amount=${verificationResult.amount}`);
      }
    }
    
    // Redirect to wallet page with error
    res.redirect(`${process.env.FRONTEND_URL}/wallet?funding=failed`);
    
  } catch (error) {
    console.error('Wallet callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/wallet?funding=error`);
  }
});

// ======================
// HEALTH CHECK ROUTE
// ======================

// GET /api/wallet/health - Simple health check for wallet service
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Wallet service is running',
    timestamp: new Date().toISOString(),
    userId: req.user.id
  });
});

module.exports = router;