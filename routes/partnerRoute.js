// const express = require('express');
// const PartnerController = require('../controllers/partnerController');
// const { authenticateToken,authenticatePartnerToken, authorizeRoles, validatePartnerRegistration, authLimiter } = require('../middleware/auth');
// const { uploadSingle } = require('../middleware/multer');

// const router = express.Router();
// const partnerController = new PartnerController();

// // Public routes - These should NOT require authentication
// router.post('/register', authLimiter, validatePartnerRegistration, partnerController.register);
// router.post('/login', authLimiter, partnerController.login);
// router.post('/verify-email', partnerController.verifyEmail);
// router.post('/resend-verification', partnerController.resendVerificationEmail);

// // Protected routes - Only these should require authentication
// // Use authenticatePartnerToken instead of authenticateToken for partners
// router.get('/dashboard', authenticatePartnerToken, partnerController.getDashboard);
// router.get('/bookings', authenticatePartnerToken, partnerController.getBookings);
// router.get('/bookings/:bookingId', authenticatePartnerToken, partnerController.getBookingDetails);

// // Enhanced payout routes
// router.post('/payout', authenticatePartnerToken, partnerController.requestPayout);
// router.get('/payouts', authenticatePartnerToken, partnerController.getPayouts);
// router.get('/payouts/:payoutId', authenticatePartnerToken, partnerController.getPayoutDetails);
// router.get('/profile', authenticatePartnerToken, partnerController.getPartnerProfile);
// router.put('/profile', authenticatePartnerToken, uploadSingle('profileImage'), partnerController.updateProfile);
// router.post('/profile/image', 
//   authenticatePartnerToken, 
//   uploadSingle('profileImage'),
//   partnerController.uploadProfileImage
// );


// // Enhanced routes for partner commission system
// router.get('/stats', authenticatePartnerToken, partnerController.getPartnerStats);
// router.get('/commissions', authenticatePartnerToken, partnerController.getCommissions);
// router.get('/commissions/summary', authenticatePartnerToken, partnerController.getCommissionSummary);


// module.exports = router;


const express = require('express');
const PartnerController = require('../controllers/partnerController');
const { authenticateToken, authenticatePartnerToken, authorizeRoles, validatePartnerRegistration, authLimiter } = require('../middleware/auth');
const { uploadSingle } = require('../middleware/multer');

const router = express.Router();
const partnerController = new PartnerController();

// Public routes - These should NOT require authentication
router.post('/register', authLimiter, validatePartnerRegistration, partnerController.register);
router.post('/login', authLimiter, partnerController.login);
router.post('/verify-email', partnerController.verifyEmail);
router.post('/resend-verification', partnerController.resendVerificationEmail);

// Password reset routes (public)
router.post('/forgot-password', partnerController.forgotPassword);
router.post('/reset-password', partnerController.resetPassword);

// Protected routes - Only these should require authentication
// Use authenticatePartnerToken instead of authenticateToken for partners
router.get('/dashboard', authenticatePartnerToken, partnerController.getDashboard);
router.get('/bookings', authenticatePartnerToken, partnerController.getBookings);
router.get('/bookings/:bookingId', authenticatePartnerToken, partnerController.getBookingDetails);

// Balance and commission routes
router.get('/balance', authenticatePartnerToken, partnerController.getAvailableBalance);
router.get('/stats', authenticatePartnerToken, partnerController.getPartnerStats);
router.get('/commissions', authenticatePartnerToken, partnerController.getCommissions);
router.get('/commissions/available', authenticatePartnerToken, partnerController.getAvailableCommissions);
router.get('/commissions/summary', authenticatePartnerToken, partnerController.getCommissionSummary);

// Enhanced payout routes
router.post('/payout', authenticatePartnerToken, partnerController.requestPayout);
router.get('/payouts', authenticatePartnerToken, partnerController.getPayouts);
router.get('/payouts/stats', authenticatePartnerToken, partnerController.getPayoutStats);
router.get('/payouts/:payoutId', authenticatePartnerToken, partnerController.getPayoutDetails);
router.delete('/payouts/:payoutId', authenticatePartnerToken, partnerController.cancelPayout);

// Profile management routes
router.get('/profile', authenticatePartnerToken, partnerController.getPartnerProfile);
router.put('/profile', authenticatePartnerToken, uploadSingle('profileImage'), partnerController.updateProfile);
router.post('/profile/image', 
  authenticatePartnerToken, 
  uploadSingle('profileImage'),
  partnerController.uploadProfileImage
);

// Admin routes (if needed for partner approval)
router.put('/approve/:partnerId', authenticateToken, authorizeRoles('admin'), partnerController.approvePartner);

module.exports = router;