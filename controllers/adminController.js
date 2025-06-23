const { supabase } = require('../middleware/auth');
const AdminService = require('../services/adminService');
const adminService = new AdminService();

class AdminController {
  async getDashboard(req, res) {
    try {
      const stats = await adminService.getDashboardStats();
      res.json(stats);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async manageUsers(req, res) {
    try {
      const { action, userId } = req.params;
      const result = await adminService.manageUsers(action, userId, req.body);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async getAllPartners(req, res) {
    try {
      const { page = 1, limit = 20, status, search, ...otherFilters } = req.query;
      
      // Clean up filters - only include non-empty values
      const filters = {};
      
      if (status && status.trim()) {
        filters.status = status.trim();
      }
      
      if (search && search.trim()) {
        filters.search = search.trim();
      }
      
      // Add any other filters that are not empty
      Object.keys(otherFilters).forEach(key => {
        if (otherFilters[key] && otherFilters[key].toString().trim()) {
          filters[key] = otherFilters[key];
        }
      });
      
      console.log('📊 Admin Controller - getAllPartners called with:', {
        page: parseInt(page),
        limit: parseInt(limit),
        filters
      });
      
      const result = await adminService.getAllPartners(
        parseInt(page), 
        parseInt(limit), 
        filters
      );
      
      console.log('✅ Admin Controller - Partners fetched successfully:', {
        count: result.partners?.length || 0,
        total: result.pagination?.total || 0
      });
      
      res.json(result);
    } catch (error) {
      console.error('❌ Admin Controller - Error fetching partners:', error);
      res.status(400).json({ 
        error: error.message,
        details: 'Failed to fetch partners'
      });
    }
}

// Also fix the managePartners method for better error handling
async managePartners(req, res) {
    try {
      const { action, partnerId } = req.params;
      
      console.log('🔧 Admin Controller - managePartners called:', {
        action,
        partnerId,
        body: req.body
      });
      
      // Validate action
      const validActions = ['approve', 'reject', 'suspend', 'activate', 'update_commission', 'update'];
      if (!validActions.includes(action)) {
        return res.status(400).json({
          error: 'Invalid action',
          message: `Action must be one of: ${validActions.join(', ')}`
        });
      }
      
      // Validate partnerId
      if (!partnerId) {
        return res.status(400).json({
          error: 'Missing partner ID',
          message: 'Partner ID is required'
        });
      }
      
      const result = await adminService.managePartners(action, partnerId, req.body);
      
      console.log('✅ Admin Controller - Partner action completed:', {
        action,
        partnerId,
        result: result.message
      });
      
      res.json(result);
    } catch (error) {
      console.error('❌ Admin Controller - Error managing partner:', error);
      res.status(400).json({ 
        error: error.message,
        details: `Failed to ${req.params.action} partner`
      });
    }
}

  async getAllBookings(req, res) {
  console.log('🔧 AdminController - getAllBookings called:', req.query);
  
  try {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      search, 
      startDate, 
      endDate, 
      bookingType,
      sortBy,
      sortOrder
    } = req.query;

    const filters = {
      status,
      search,
      startDate,
      endDate,
      bookingType,
      sortBy,
      sortOrder
    };

    // Remove undefined/null values from filters (matching your pattern)
    Object.keys(filters).forEach(key => {
      if (filters[key] === undefined || filters[key] === null || filters[key] === '') {
        delete filters[key];
      }
    });

    const bookings = await adminService.getAllBookings(page, limit, filters);
    
    console.log('✅ AdminController - getAllBookings successful');
    res.json(bookings);
  } catch (error) {
    console.error('❌ AdminController - Error in getAllBookings:', error);
    res.status(400).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async getBookingDetails(req, res) {
  console.log('🔧 AdminController - getBookingDetails called:', req.params);
  
  try {
    const { bookingId } = req.params;
    
    if (!bookingId) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }
    
    const booking = await adminService.getBookingDetails(bookingId);
    
    console.log('✅ AdminController - getBookingDetails successful');
    res.json(booking);
  } catch (error) {
    console.error('❌ AdminController - Error in getBookingDetails:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ 
        error: 'Booking not found',
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(400).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

  async processRefund(req, res) {
    try {
      const { refundId, action } = req.params;
      const result = await adminService.processRefundRequest(refundId, action, req.user.id);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async generateReports(req, res) {
    try {
      const { reportType } = req.params;
      const { startDate, endDate } = req.query;
      const report = await adminService.generateReports(reportType, { startDate, endDate });
      res.json(report);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

 async managePromoCodes(req, res) {
  try {
    const { action } = req.params;
    let result;
    
    switch (action) {
      case 'create':
        result = await adminService.managePromoCodes('create', req.body);
        break;
      case 'update':
        const { promoId: updatePromoId, ...updateData } = req.body;
        result = await adminService.managePromoCodes('update', updateData, updatePromoId);
        break;
      case 'activate':
        const { promoId: activatePromoId } = req.body;
        result = await adminService.managePromoCodes('activate', null, activatePromoId);
        break;
      case 'deactivate':
        const { promoId: deactivatePromoId } = req.body;
        result = await adminService.managePromoCodes('deactivate', null, deactivatePromoId);
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    // FIX: Return consistent structure
    res.json({
      success: true,
      data: result.promo, // Extract the promo from result
      message: result.message
    });
  } catch (error) {
    console.error('Promo code management error:', error);
    res.status(400).json({ 
      success: false,
      error: error.message 
    });
  }
}

// Also update your getAllPromoCodes method:
async getAllPromoCodes(req, res) {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    
    let query = supabase
      .from('promo_codes')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }
    
    if (search) {
      query = query.ilike('code', `%${search}%`);
    }

    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data: promoCodes, error, count } = await query;

    if (error) throw error;

    // FIX: Return consistent structure
    res.json({
      success: true,
      data: promoCodes, // This should match what frontend expects
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Get promo codes error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
}


  /**
   * Send broadcast notification
   * POST /admin/notifications
   */
  async sendBroadcastNotification(req, res) {
    try {
      const { type, title, message, recipients } = req.body;

      // Validate required fields
      if (!type || !title || !message || !recipients) {
        return res.status(400).json({
          success: false,
          message: 'All fields are required: type, title, message, recipients'
        });
      }

      // Validate notification type
      const validTypes = ['info', 'warning', 'success', 'error'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid notification type. Must be one of: info, warning, success, error'
        });
      }

      // Validate recipients
      const validRecipients = ['all', 'active', 'partners', 'admins'];
      if (!validRecipients.includes(recipients)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid recipients. Must be one of: all, active, partners, admins'
        });
      }

      // Send notification
      const result = await adminService.sendBroadcastNotification(
        type,
        title,
        message,
        recipients
      );

      res.status(200).json({
        success: true,
        data: result,
        message: 'Notification sent successfully'
      });

    } catch (error) {
      console.error('Error in sendBroadcastNotification controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to send notification'
      });
    }
  }

  /**
   * Get notification history
   * GET /admin/notifications/history
   */
  async getNotificationHistory(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        type,
        recipients,
        status,
        dateFrom,
        dateTo
      } = req.query;

      // Validate pagination parameters
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      if (isNaN(pageNum) || pageNum < 1) {
        return res.status(400).json({
          success: false,
          message: 'Invalid page number'
        });
      }

      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return res.status(400).json({
          success: false,
          message: 'Invalid limit. Must be between 1 and 100'
        });
      }

      // Build filters object
      const filters = {};
      if (type) filters.type = type;
      if (recipients) filters.recipients = recipients;
      if (status) filters.status = status;
      if (dateFrom) filters.dateFrom = dateFrom;
      if (dateTo) filters.dateTo = dateTo;

      // Get notification history
      const result = await adminService.getNotificationHistory(
        pageNum,
        limitNum,
        filters
      );

      res.status(200).json({
        success: true,
        data: result,
        message: 'Notification history retrieved successfully'
      });

    } catch (error) {
      console.error('Error in getNotificationHistory controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to retrieve notification history'
      });
    }
  }

  /**
   * Get notification statistics
   * GET /admin/notifications/statistics
   */
  async getNotificationStatistics(req, res) {
    try {
      const { period = '30d' } = req.query;

      // Calculate date range based on period
      let dateFrom;
      const dateTo = new Date().toISOString();

      switch (period) {
        case '7d':
          dateFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          break;
        case '30d':
          dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          break;
        case '90d':
          dateFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
          break;
        default:
          dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      }

      // Get statistics from service
      const statistics = await adminService.getNotificationStatistics(dateFrom, dateTo);

      res.status(200).json({
        success: true,
        data: statistics,
        message: 'Notification statistics retrieved successfully'
      });

    } catch (error) {
      console.error('Error in getNotificationStatistics controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to retrieve notification statistics'
      });
    }
  }

/**
 * Get notification delivery details
 * Controller method for handling the API request
 */
async getNotificationDeliveryDetails(req, res) {
  try {
    const { notificationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    
    // Get the user ID from the authenticated request
    // This should come from your auth middleware
    const requesterId =  req.user?.id || req.user?.userId;
    
    if (!requesterId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User authentication required'
      });
    }

    // Validate notification ID format (should be UUID)
    if (!notificationId || notificationId.length !== 36) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid notification ID format'
      });
    }

    // Check if requester is admin
    const isAdmin = typeof requesterId === 'string' && requesterId.startsWith('admin-');
    
    let deliveryDetails;
    
    if (isAdmin) {
      // Use the admin-specific method for better reliability
      deliveryDetails = await AdminService.getAdminNotificationDeliveryDetails(
        notificationId,
        parseInt(page),
        parseInt(limit)
      );
    } else {
      // Use the regular method for non-admin users
      deliveryDetails = await AdminService.getNotificationDeliveryDetails(
        notificationId,
        parseInt(page),
        parseInt(limit),
        requesterId
      );
    }

    return res.status(200).json({
      success: true,
      data: deliveryDetails
    });

  } catch (error) {
    console.error('Error in getNotificationDeliveryDetails controller:', error);
    
    // Handle specific error types
    if (error.message.includes('Notification not found')) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Notification not found'
      });
    }
    
    if (error.message.includes('Database error')) {
      return res.status(500).json({
        error: 'Database Error',
        message: 'Failed to retrieve notification delivery details'
      });
    }

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'An error occurred while retrieving delivery details',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}


  /**
   * Retry failed notification deliveries
   * POST /admin/notifications/:id/retry
   */
  async retryFailedDeliveries(req, res) {
    try {
      const { id } = req.params;

      // Validate notification ID
      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          success: false,
          message: 'Invalid notification ID'
        });
      }

      // Retry failed deliveries
      const result = await adminService.retryFailedDeliveries(parseInt(id));

      res.status(200).json({
        success: true,
        data: result,
        message: 'Failed deliveries retry initiated successfully'
      });

    } catch (error) {
      console.error('Error in retryFailedDeliveries controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to retry deliveries'
      });
    }
  }

  /**
   * Delete notification
   * DELETE /admin/notifications/:id
   */
  async deleteNotification(req, res) {
    try {
      const { id } = req.params;

      // Validate notification ID
      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          success: false,
          message: 'Invalid notification ID'
        });
      }

      // Delete notification
      await adminService.deleteNotification(parseInt(id));

      res.status(200).json({
        success: true,
        message: 'Notification deleted successfully'
      });

    } catch (error) {
      console.error('Error in deleteNotification controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to delete notification'
      });
    }
  }

  /**
   * Get notification templates
   * GET /admin/notifications/templates
   */
  async getNotificationTemplates(req, res) {
    try {
      const templates = await adminService.getNotificationTemplates();

      res.status(200).json({
        success: true,
        data: templates,
        message: 'Notification templates retrieved successfully'
      });

    } catch (error) {
      console.error('Error in getNotificationTemplates controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to retrieve notification templates'
      });
    }
  }

  /**
   * Create or update notification template
   * POST /admin/notifications/templates
   */
  async saveNotificationTemplate(req, res) {
    try {
      const { name, type, title, message, description } = req.body;

      // Validate required fields
      if (!name || !type || !title || !message) {
        return res.status(400).json({
          success: false,
          message: 'Required fields: name, type, title, message'
        });
      }

      // Save template
      const template = await adminService.saveNotificationTemplate({
        name,
        type,
        title,
        message,
        description
      });

      res.status(201).json({
        success: true,
        data: template,
        message: 'Notification template saved successfully'
      });

    } catch (error) {
      console.error('Error in saveNotificationTemplate controller:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to save notification template'
      });
    }
  }

  // Legacy method for backward compatibility
  async sendNotification(req, res) {
    return this.sendBroadcastNotification(req, res);
  }

  async getAllUsers(req, res) {
    try {
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await adminService.getAllUsers(page, limit, filters);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  

  async getAllRefunds(req, res) {
    try {
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await adminService.getAllRefunds(page, limit, filters);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  // async getBookingDetails(req, res) {
  //   try {
  //     const { bookingId } = req.params;
  //     const booking = await adminService.getBookingDetails(bookingId);
  //     res.json(booking);
  //   } catch (error) {
  //     res.status(400).json({ error: error.message });
  //   }
  // }

  async getSystemLogs(req, res) {
  try {
    const { page = 1, limit = 50, ...filters } = req.query;
    const result = await adminService.getSystemLogs(page, limit, filters);
    res.json(result);
  } catch (error) {
    console.error('System logs controller error:', error);
    res.status(500).json({ error: error.message });
  }
}

async updateSystemSettings(req, res) {
  try {
    const result = await adminService.updateSystemSettings(req.body);
    res.json(result);
  } catch (error) {
    console.error('Update system settings error:', error);
    res.status(500).json({ error: error.message });
  }
}

async getSystemSettings(req, res) {
  try {
    console.log('Getting system settings...');
    const settings = await adminService.getSystemSettings();
    console.log('Settings found:', settings);
    res.json(settings);
  } catch (error) {
    console.error('System settings error:', error);
    res.status(500).json({ error: error.message });
  }
}

//   async approvePayout(req, res) {
//   try {
//     const { payoutId } = req.params;
//     // const adminId = req.user.id; // Assuming admin authentication
    
//     if (!payoutId) {
//       return res.status(400).json({
//         success: false,
//         error: 'Payout ID is required'
//       });
//     }
    
//     const result = await adminService.approvePayout(payoutId, adminId);
    
//     res.json({
//       success: true,
//       data: result,
//       message: 'Payout approved successfully'
//     });
//   } catch (error) {
//     console.error('Payout approval failed:', error.message);
//     res.status(400).json({ 
//       success: false,
//       error: error.message 
//     });
//   }
// }
 async getAllPayouts(req, res) {
    try {
      console.log('🔍 AdminController - getAllPayouts called with:', req.query);
      
      const { 
        page = 1, 
        limit = 20, 
        status, 
        search, 
        startDate, 
        endDate,
        sortBy,
        sortOrder
      } = req.query;

      const filters = {};
      
      // Clean up filters - only include non-empty values
      if (status && status.trim() && status !== 'all') {
        filters.status = status.trim();
      }
      
      if (search && search.trim()) {
        filters.search = search.trim();
      }
      
      if (startDate && startDate.trim()) {
        filters.startDate = startDate.trim();
      }
      
      if (endDate && endDate.trim()) {
        filters.endDate = endDate.trim();
      }
      
      if (sortBy && sortBy.trim()) {
        filters.sortBy = sortBy.trim();
      }
      
      if (sortOrder && sortOrder.trim()) {
        filters.sortOrder = sortOrder.trim();
      }

      console.log('📊 Processed filters:', filters);

      const result = await adminService.getAllPayouts(
        parseInt(page), 
        parseInt(limit), 
        filters
      );

      console.log('✅ AdminController - Payouts fetched successfully:', {
        count: result.payouts?.length || 0,
        total: result.pagination?.total || 0
      });

      res.json(result);
    } catch (error) {
      console.error('❌ AdminController - Error fetching payouts:', error);
      res.status(400).json({ 
        error: error.message,
        details: 'Failed to fetch payouts'
      });
    }
  }

  async getPayoutDetails(req, res) {
    try {
      const { payoutId } = req.params;
      
      console.log('🔍 AdminController - getPayoutDetails called for:', payoutId);
      
      if (!payoutId) {
        return res.status(400).json({
          error: 'Missing payout ID',
          message: 'Payout ID is required'
        });
      }
      
      const payout = await adminService.getPayoutDetails(payoutId);
      
      console.log('✅ AdminController - Payout details fetched successfully');
      res.json(payout);
    } catch (error) {
      console.error('❌ AdminController - Error fetching payout details:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          error: 'Payout not found',
          message: `Payout with ID ${req.params.payoutId} not found`
        });
      }
      
      res.status(400).json({ 
        error: error.message,
        details: 'Failed to fetch payout details'
      });
    }
  }

  async approvePayout(req, res) {
    try {
      const { payoutId } = req.params;
      const adminId = req.user?.id; // Get admin ID from authenticated user
      
      console.log('✅ AdminController - approvePayout called:', { payoutId, adminId });
      
      if (!payoutId) {
        return res.status(400).json({
          error: 'Missing payout ID',
          message: 'Payout ID is required'
        });
      }
      
      const result = await adminService.approvePayout(payoutId, adminId);
      
      console.log('✅ AdminController - Payout approved successfully');
      res.json({
        success: true,
        data: result,
        message: 'Payout approved successfully'
      });
    } catch (error) {
      console.error('❌ AdminController - Error approving payout:', error);
      res.status(400).json({ 
        success: false,
        error: error.message,
        details: 'Failed to approve payout'
      });
    }
  }

  async rejectPayout(req, res) {
    try {
      const { payoutId } = req.params;
      const { rejectionReason } = req.body;
      const adminId = req.user?.id;
      
      console.log('❌ AdminController - rejectPayout called:', { payoutId, adminId, rejectionReason });
      
      if (!payoutId) {
        return res.status(400).json({
          error: 'Missing payout ID',
          message: 'Payout ID is required'
        });
      }
      
      const result = await adminService.rejectPayout(payoutId, adminId, rejectionReason);
      
      console.log('✅ AdminController - Payout rejected successfully');
      res.json({
        success: true,
        data: result,
        message: 'Payout rejected successfully'
      });
    } catch (error) {
      console.error('❌ AdminController - Error rejecting payout:', error);
      res.status(400).json({ 
        success: false,
        error: error.message,
        details: 'Failed to reject payout'
      });
    }
  }

  async processPayout(req, res) {
    try {
      const { payoutId } = req.params;
      const { status = 'completed' } = req.body;
      const adminId = req.user?.id;
      
      console.log('🔄 AdminController - processPayout called:', { payoutId, status, adminId });
      
      if (!payoutId) {
        return res.status(400).json({
          error: 'Missing payout ID',
          message: 'Payout ID is required'
        });
      }

      const validStatuses = ['completed', 'failed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: 'Invalid status',
          message: `Status must be one of: ${validStatuses.join(', ')}`
        });
      }
      
      const result = await adminService.processPayout(payoutId, adminId, status);
      
      console.log('✅ AdminController - Payout processed successfully');
      res.json({
        success: true,
        data: result,
        message: `Payout ${status} successfully`
      });
    } catch (error) {
      console.error('❌ AdminController - Error processing payout:', error);
      res.status(400).json({ 
        success: false,
        error: error.message,
        details: 'Failed to process payout'
      });
    }
  }

  async bulkPayoutAction(req, res) {
    try {
      const { payoutIds, action, rejectionReason } = req.body;
      const adminId = req.user?.id;
      
      console.log('🔄 AdminController - bulkPayoutAction called:', { 
        payoutCount: payoutIds?.length, 
        action, 
        adminId 
      });
      
      if (!Array.isArray(payoutIds) || payoutIds.length === 0) {
        return res.status(400).json({
          error: 'Invalid payout IDs',
          message: 'Payout IDs array is required and cannot be empty'
        });
      }

      const validActions = ['approve', 'reject'];
      if (!validActions.includes(action)) {
        return res.status(400).json({
          error: 'Invalid action',
          message: `Action must be one of: ${validActions.join(', ')}`
        });
      }

      if (action === 'reject' && !rejectionReason) {
        return res.status(400).json({
          error: 'Missing rejection reason',
          message: 'Rejection reason is required when rejecting payouts'
        });
      }
      
      const result = await adminService.bulkPayoutAction(
        payoutIds, 
        action, 
        adminId, 
        { rejectionReason }
      );
      
      console.log('✅ AdminController - Bulk payout action completed:', {
        successful: result.successful.length,
        failed: result.failed.length,
        total: result.total
      });
      
      res.json({
        success: true,
        data: result,
        message: `Bulk ${action} completed. ${result.successful.length}/${result.total} successful.`
      });
    } catch (error) {
      console.error('❌ AdminController - Error in bulk payout action:', error);
      res.status(400).json({ 
        success: false,
        error: error.message,
        details: 'Failed to perform bulk payout action'
      });
    }
  }

  async getPayoutStatistics(req, res) {
    try {
      const { startDate, endDate } = req.query;
      
      console.log('📊 AdminController - getPayoutStatistics called with filters:', { startDate, endDate });
      
      const filters = {};
      if (startDate && startDate.trim()) {
        filters.startDate = startDate.trim();
      }
      if (endDate && endDate.trim()) {
        filters.endDate = endDate.trim();
      }
      
      const stats = await adminService.getPayoutStatistics(filters);
      
      console.log('✅ AdminController - Payout statistics fetched successfully');
      res.json(stats);
    } catch (error) {
      console.error('❌ AdminController - Error fetching payout statistics:', error);
      res.status(400).json({ 
        error: error.message,
        details: 'Failed to fetch payout statistics'
      });
    }
  }

  async exportPayouts(req, res) {
    try {
      const { status, startDate, endDate, format = 'csv' } = req.query;
      
      console.log('📤 AdminController - exportPayouts called with filters:', { status, startDate, endDate, format });
      
      const filters = {};
      if (status && status.trim() && status !== 'all') {
        filters.status = status.trim();
      }
      if (startDate && startDate.trim()) {
        filters.startDate = startDate.trim();
      }
      if (endDate && endDate.trim()) {
        filters.endDate = endDate.trim();
      }
      
      if (format !== 'csv') {
        return res.status(400).json({
          error: 'Invalid format',
          message: 'Only CSV format is currently supported'
        });
      }
      
      const result = await adminService.exportPayouts(filters);
      
      // Set appropriate headers for file download
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      
      res.send(result.data);
    } catch (error) {
      console.error('Export payouts failed:', error);
      res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }
  }

}

module.exports = AdminController;