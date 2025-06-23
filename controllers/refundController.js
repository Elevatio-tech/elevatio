const UserRefundService = require('../services/refundService');

class RefundController {
  constructor() {
    this.userRefundService = new UserRefundService();
  }

  // Request a new refund
  requestRefund = async (req, res) => {
    try {
      const userId = req.user.id; // Assuming user is authenticated and available in req.user
      const { bookingId, reason, amount } = req.body;

      // Validation
      if (!bookingId || !reason) {
        return res.status(400).json({
          success: false,
          message: 'Booking ID and reason are required'
        });
      }

      if (reason.trim().length < 10) {
        return res.status(400).json({
          success: false,
          message: 'Reason must be at least 10 characters long'
        });
      }

      if (amount && (amount <= 0 || isNaN(amount))) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be a positive number'
        });
      }

      const result = await this.userRefundService.requestRefund(
        userId, 
        bookingId, 
        reason.trim(), 
        amount
      );

      res.status(201).json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('Error requesting refund:', error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  };

  // Get user's refund history
  getUserRefunds = async (req, res) => {
    try {
      const userId = req.user.id;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const status = req.query.status;

      const filters = {};
      if (status) {
        filters.status = status;
      }

      const result = await this.userRefundService.getUserRefunds(userId, page, limit, filters);

      res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('Error fetching user refunds:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch refunds'
      });
    }
  };

  // Get specific refund details
  getRefundById = async (req, res) => {
    try {
      const userId = req.user.id;
      const refundId = req.params.id;

      if (!refundId) {
        return res.status(400).json({
          success: false,
          message: 'Refund ID is required'
        });
      }

      const refund = await this.userRefundService.getRefundById(userId, refundId);

      res.status(200).json({
        success: true,
        data: refund
      });

    } catch (error) {
      console.error('Error fetching refund:', error);
      res.status(404).json({
        success: false,
        message: error.message
      });
    }
  };

  // Cancel a pending refund request
  cancelRefundRequest = async (req, res) => {
    try {
      const userId = req.user.id;
      const refundId = req.params.id;

      if (!refundId) {
        return res.status(400).json({
          success: false,
          message: 'Refund ID is required'
        });
      }

      const result = await this.userRefundService.cancelRefundRequest(userId, refundId);

      res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('Error cancelling refund request:', error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  };

  // Get user's wallet balance
  getWalletBalance = async (req, res) => {
    try {
      const userId = req.user.id;
      const result = await this.userRefundService.getUserWalletBalance(userId);

      res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('Error fetching wallet balance:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch wallet balance'
      });
    }
  };

  // Get bookings eligible for refund
  getEligibleBookings = async (req, res) => {
    try {
      const userId = req.user.id;
      const bookings = await this.userRefundService.getEligibleBookingsForRefund(userId);

      res.status(200).json({
        success: true,
        data: bookings
      });

    } catch (error) {
      console.error('Error fetching eligible bookings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch eligible bookings'
      });
    }
  };
}

module.exports = RefundController;