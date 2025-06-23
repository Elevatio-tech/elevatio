// const express = require('express');
// const AdminController = require('../controllers/adminController');
// const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// const router = express.Router();
// const adminController = new AdminController();

// // Apply authentication and authorization middleware to all admin routes
// router.use(authenticateToken);
// router.use(authorizeRoles('admin'));

// // Dashboard
// router.get('/dashboard', adminController.getDashboard);

// // Users management
// router.get('/users', adminController.getAllUsers);
// router.put('/users/:action/:userId', adminController.manageUsers);

// // Partners management
// router.get('/partners', adminController.getAllPartners);
// router.put('/partners/:action/:partnerId', adminController.managePartners);
// router.put('/payouts/:payoutId/approve', adminController.approvePayout);

// // Bookings management
// router.get('/bookings', adminController.getAllBookings);
// router.get('/bookings/:bookingId', adminController.getBookingDetails);

// // Refunds management
// router.get('/refunds', adminController.getAllRefunds);
// router.put('/refunds/:refundId/:action', adminController.processRefund);

// // Reports
// router.get('/reports/:reportType', adminController.generateReports);

// // Promo codes management
// router.post('/promo-codes/:action', adminController.managePromoCodes);
// router.put('/promo-codes/:action', adminController.managePromoCodes);

// // System management
// router.get('/system/logs', adminController.getSystemLogs);
// router.get('/system/settings', adminController.getSystemSettings);
// router.put('/system/settings', adminController.updateSystemSettings);

// // Notifications
// router.post('/notifications', adminController.sendNotification);

// module.exports = router;


const express = require('express');
const AdminController = require('../controllers/adminController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();
const adminController = new AdminController();

// Apply authentication and authorization middleware to all admin routes
router.use(authenticateToken);
router.use(authorizeRoles('admin'));

// Dashboard
router.get('/dashboard', adminController.getDashboard);

// Users management
router.get('/users', adminController.getAllUsers);
router.put('/users/:action/:userId', adminController.manageUsers);

// Partners management
router.get('/partners', adminController.getAllPartners);
router.put('/partners/:action/:partnerId', adminController.managePartners);

// Bookings management
router.get('/bookings', adminController.getAllBookings);
router.get('/bookings/:bookingId', adminController.getBookingDetails);

// Refunds management
router.get('/refunds', adminController.getAllRefunds);
router.put('/refunds/:refundId/:action', adminController.processRefund);

// === PAYOUT MANAGEMENT ROUTES ===

// Get all payouts with filtering, pagination, and search
router.get('/payouts', adminController.getAllPayouts);

// Get specific payout details
router.get('/payouts/:payoutId', adminController.getPayoutDetails);

// Individual payout actions
router.put('/payouts/:payoutId/approve', adminController.approvePayout);
router.put('/payouts/:payoutId/reject', adminController.rejectPayout);
router.put('/payouts/:payoutId/process', adminController.processPayout);

// Bulk payout actions
router.post('/payouts/bulk-action', adminController.bulkPayoutAction);

// Payout statistics and analytics
router.get('/payouts/statistics/overview', adminController.getPayoutStatistics);

// Export payouts to CSV
router.get('/payouts/export/csv', adminController.exportPayouts);

// Reports
router.get('/reports/:reportType', adminController.generateReports);

// Promo codes management
// GET all promo codes
router.get('/promo-codes', adminController.getAllPromoCodes);

// POST/PUT for managing promo codes
router.post('/promo-codes/:action', adminController.managePromoCodes);
router.put('/promo-codes/:action', adminController.managePromoCodes);

// System management
router.get('/system/logs', adminController.getSystemLogs);
router.get('/system/settings', adminController.getSystemSettings);
router.put('/system/settings', adminController.updateSystemSettings);

// Notifications
// === NOTIFICATION MANAGEMENT ROUTES ===

// Send broadcast notification
router.post('/notifications', adminController.sendBroadcastNotification);

// Get notification history with filtering and pagination
router.get('/notifications/history', adminController.getNotificationHistory);

// Get notification statistics
router.get('/notifications/statistics', adminController.getNotificationStatistics);

// Get notification templates
router.get('/notifications/templates', adminController.getNotificationTemplates);

// Create or update notification template
router.post('/notifications/templates', adminController.saveNotificationTemplate);

// Get specific notification delivery details
router.get('/notifications/:id/delivery-details', adminController.getNotificationDeliveryDetails);

// Retry failed notification deliveries
router.post('/notifications/:id/retry', adminController.retryFailedDeliveries);

// Delete notification
router.delete('/notifications/:id', adminController.deleteNotification);

// Legacy endpoint for backward compatibility
router.post('/notifications/send', adminController.sendNotification);


module.exports = router;