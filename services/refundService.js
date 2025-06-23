const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../utils/emailService');
const WalletService = require('./walletService');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const walletService = new WalletService();

class UserRefundService {

  async requestRefund(userId, bookingId, reason, amount = null) {
    try {
      // First, verify the booking belongs to the user and get booking details
      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .select('id, booking_reference, total_amount, status, user_id')
        .eq('id', bookingId)
        .eq('user_id', userId)
        .single();

      if (bookingError || !booking) {
        throw new Error('Booking not found or does not belong to you');
      }

      // Check if booking is eligible for refund
      if (booking.status === 'cancelled' || booking.status === 'refunded') {
        throw new Error('This booking is not eligible for refund');
      }

      // Check if refund already exists for this booking
      const { data: existingRefund } = await supabase
        .from('refunds')
        .select('id, status')
        .eq('booking_id', bookingId)
        .eq('user_id', userId)
        .single();

      if (existingRefund) {
        throw new Error('A refund request already exists for this booking');
      }

      // Calculate refund amount (use provided amount or full booking amount)
      const refundAmount = amount || booking.total_amount;

      // Validate refund amount doesn't exceed booking amount
      if (refundAmount > booking.total_amount) {
        throw new Error('Refund amount cannot exceed booking amount');
      }

      // Create refund request
      const { data: refund, error: refundError } = await supabase
        .from('refunds')
        .insert({
          user_id: userId,
          booking_id: bookingId,
          amount: refundAmount,
          reason: reason,
          status: 'pending',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (refundError) {
        throw new Error('Failed to create refund request');
      }

      // Get user details for email
      const { data: user } = await supabase
        .from('users')
        .select('email, first_name, last_name')
        .eq('id', userId)
        .single();

      // Send confirmation email to user
      if (user) {
        await sendEmail({
          to: user.email,
          subject: 'Refund Request Submitted - Elevatio',
          template: 'refund-request-confirmation',
          data: {
            userName: user.first_name,
            amount: refundAmount,
            bookingReference: booking.booking_reference,
            reason: reason,
            refundId: refund.id
          }
        });
      }

      // Send notification to admin (optional)
      await sendEmail({
        to: process.env.ADMIN_EMAIL,
        subject: 'New Refund Request - Elevatio Admin',
        template: 'admin-refund-notification',
        data: {
          userName: user ? `${user.first_name} ${user.last_name}` : 'User',
          userEmail: user?.email,
          amount: refundAmount,
          bookingReference: booking.booking_reference,
          reason: reason,
          refundId: refund.id
        }
      });

      return {
        message: 'Refund request submitted successfully',
        refundId: refund.id,
        status: 'pending'
      };

    } catch (error) {
      throw error;
    }
  }

  async getUserRefunds(userId, page = 1, limit = 10, filters = {}) {
    try {
      const offset = (page - 1) * limit;
      let query = supabase
        .from('refunds')
        .select(`
          id,
          amount,
          reason,
          status,
          created_at,
          processed_at,
          bookings(
            id,
            booking_reference,
            total_amount,
            created_at
          )
        `, { count: 'exact' })
        .eq('user_id', userId)
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false });

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      const { data: refunds, error, count } = await query;

      if (error) throw error;

      return {
        refunds,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      throw error;
    }
  }

  async getRefundById(userId, refundId) {
    try {
      const { data: refund, error } = await supabase
        .from('refunds')
        .select(`
          id,
          amount,
          reason,
          status,
          created_at,
          processed_at,
          bookings(
            id,
            booking_reference,
            total_amount,
            status,
            created_at
          )
        `)
        .eq('id', refundId)
        .eq('user_id', userId)
        .single();

      if (error || !refund) {
        throw new Error('Refund not found');
      }

      return refund;
    } catch (error) {
      throw error;
    }
  }

  async cancelRefundRequest(userId, refundId) {
    try {
      // Check if refund exists and belongs to user
      const { data: refund, error: fetchError } = await supabase
        .from('refunds')
        .select('id, status')
        .eq('id', refundId)
        .eq('user_id', userId)
        .single();

      if (fetchError || !refund) {
        throw new Error('Refund request not found');
      }

      // Check if refund can be cancelled
      if (refund.status !== 'pending') {
        throw new Error('Only pending refund requests can be cancelled');
      }

      // Update refund status to cancelled
      const { error: updateError } = await supabase
        .from('refunds')
        .update({
          status: 'cancelled',
          processed_at: new Date().toISOString()
        })
        .eq('id', refundId);

      if (updateError) {
        throw new Error('Failed to cancel refund request');
      }

      return { message: 'Refund request cancelled successfully' };
    } catch (error) {
      throw error;
    }
  }

  async getUserWalletBalance(userId) {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('wallet_balance')
        .eq('id', userId)
        .single();

      if (error) throw error;

      return { balance: data?.wallet_balance || 0 };
    } catch (error) {
      throw error;
    }
  }

  async getEligibleBookingsForRefund(userId) {
    try {
      const { data: bookings, error } = await supabase
        .from('bookings')
        .select(`
          id,
          booking_reference,
          total_amount,
          status,
          created_at,
          refunds(id, status)
        `)
        .eq('user_id', userId)
        .in('status', ['confirmed', 'completed'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Filter out bookings that already have refund requests
      const eligibleBookings = bookings.filter(booking => 
        !booking.refunds || booking.refunds.length === 0
      );

      return eligibleBookings.map(booking => ({
        id: booking.id,
        booking_reference: booking.booking_reference,
        total_amount: booking.total_amount,
        status: booking.status,
        created_at: booking.created_at
      }));
    } catch (error) {
      throw error;
    }
  }

   async processRefund(refundId, adminUserId) {
    try {
      // Get refund details
      const { data: refund, error: refundError } = await supabase
        .from('refunds')
        .select(`
          id, user_id, amount, reason, status,
          bookings(booking_reference, total_amount)
        `)
        .eq('id', refundId)
        .single();

      if (refundError || !refund) {
        throw new Error('Refund not found');
      }

      if (refund.status !== 'pending') {
        throw new Error('Only pending refunds can be processed');
      }

      // Credit the user's wallet
      const creditResult = await walletService.creditWallet(
        refund.user_id,
        refund.amount,
        `Refund for booking ${refund.bookings.booking_reference}`,
        `refund_${refundId}`
      );

      // Update refund status to completed
      const { error: updateError } = await supabase
        .from('refunds')
        .update({
          status: 'completed',
          processed_at: new Date().toISOString(),
          processed_by: adminUserId
        })
        .eq('id', refundId);

      if (updateError) {
        console.error('Refund status update error:', updateError);
        throw new Error('Failed to update refund status');
      }

      // Update booking status to refunded
      await supabase
        .from('bookings')
        .update({ status: 'refunded' })
        .eq('id', refund.booking_id);

      return {
        success: true,
        message: 'Refund processed successfully',
        refundId: refundId,
        amount: refund.amount,
        walletTransactionId: creditResult.transactionId,
        newWalletBalance: creditResult.newBalance
      };

    } catch (error) {
      console.error('Process refund error:', error);
      throw error;
    }
  }

}

module.exports = UserRefundService;