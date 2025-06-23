const express = require('express');
const RefundController = require('../controllers/refundController');
const { authenticateToken, apiLimiter } = require('../middleware/auth');
// const { validateRefundRequest } = require('../middleware/validation'); // Optional validation middleware

const router = express.Router();
const refundController = new RefundController();

// Apply authentication middleware to all routes
router.use(authenticateToken);

// POST /api/refunds - Request a new refund
router.post('/', refundController.requestRefund);

// GET /api/refunds - Get user's refund history with pagination and filters
router.get('/', refundController.getUserRefunds);

// GET /api/refunds/eligible-bookings - Get bookings that can be refunded
router.get('/eligible-bookings', refundController.getEligibleBookings);

// GET /api/refunds/wallet-balance - Get user's wallet balance
router.get('/wallet-balance', refundController.getWalletBalance);

// GET /api/refunds/:id - Get specific refund details
router.get('/:id', refundController.getRefundById);

// PUT /api/refunds/:id/cancel - Cancel a pending refund request
router.put('/:id/cancel', refundController.cancelRefundRequest);

module.exports = router;

// Example validation middleware (optional)
// You can create this in ../middleware/validation.js
/*
const validateRefundRequest = (req, res, next) => {
  const { bookingId, reason, amount } = req.body;

  if (!bookingId) {
    return res.status(400).json({
      success: false,
      message: 'Booking ID is required'
    });
  }

  if (!reason || reason.trim().length < 10) {
    return res.status(400).json({
      success: false,
      message: 'Reason is required and must be at least 10 characters'
    });
  }

  if (amount && (isNaN(amount) || amount <= 0)) {
    return res.status(400).json({
      success: false,
      message: 'Amount must be a positive number'
    });
  }

  next();
};

module.exports = { validateRefundRequest };
*/