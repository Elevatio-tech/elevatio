const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../utils/emailService');
const WalletService = require('./walletService');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

class AdminService {
  async getDashboardStats() {
    try {
      // Get various statistics
      const [
        { count: totalUsers },
        { count: totalBookings },
        { count: totalPartners },
        { data: revenueData }
      ] = await Promise.all([
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('bookings').select('*', { count: 'exact', head: true }),
        supabase.from('partners').select('*', { count: 'exact', head: true }),
        supabase.from('bookings').select('total_amount, created_at').eq('status', 'confirmed')
      ]);

      const totalRevenue = revenueData.reduce((sum, booking) => sum + booking.total_amount, 0);
      const monthlyRevenue = revenueData
        .filter(booking => new Date(booking.created_at) >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        .reduce((sum, booking) => sum + booking.total_amount, 0);

      // Get pending approvals count
      const { count: pendingPartners } = await supabase
        .from('partners')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      const { count: pendingRefunds } = await supabase
        .from('refunds')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      return {
        totalUsers,
        totalBookings,
        totalPartners,
        totalRevenue,
        monthlyRevenue,
        pendingPartners,
        pendingRefunds
      };
    } catch (error) {
      throw error;
    }
  }

  async manageUsers(action, userId, data = {}) {
    try {
      switch (action) {
        case 'suspend':
          await supabase
            .from('users')
            .update({ 
              status: 'suspended',
              suspended_at: new Date().toISOString()
            })
            .eq('id', userId);
          break;
        case 'activate':
          await supabase
            .from('users')
            .update({ 
              status: 'active',
              suspended_at: null
            })
            .eq('id', userId);
          break;
        case 'update':
          await supabase
            .from('users')
            .update({
              ...data,
              updated_at: new Date().toISOString()
            })
            .eq('id', userId);
          break;
        case 'delete':
          await supabase
            .from('users')
            .update({
              status: 'deleted',
              email: `deleted_${Date.now()}@deleted.com`,
              deleted_at: new Date().toISOString()
            })
            .eq('id', userId);
          break;
      }

      return { message: `User ${action} successful` };
    } catch (error) {
      throw error;
    }
  }

  async getAllUsers(page = 1, limit = 20, filters = {}) {
    try {
      const offset = (page - 1) * limit;
      let query = supabase
        .from('users')
        .select(`
          id,
          email,
          first_name,
          last_name,
          phone,
          status,
          email_verified,
          wallet_balance,
          created_at,
          last_login
        `, { count: 'exact' })
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false });

      // Apply filters
      if (filters.status) {
        query = query.eq('status', filters.status);
      }
      if (filters.email_verified !== undefined) {
        query = query.eq('email_verified', filters.email_verified);
      }
      if (filters.search) {
        query = query.or(`email.ilike.%${filters.search}%,first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%`);
      }

      const { data: users, error, count } = await query;

      if (error) throw error;

      return {
        users,
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

  /**
   * Enhanced managePartners method with comprehensive error handling and validation
   */
  async managePartners(action, partnerId, data = {}) {
    console.log(`🔧 AdminService - managePartners called:`, { action, partnerId, data });

    try {
      // Validate inputs
      if (!partnerId) {
        throw new Error('Partner ID is required');
      }

      const validActions = ['approve', 'reject', 'suspend', 'activate', 'update_commission', 'update'];
      if (!validActions.includes(action)) {
        throw new Error(`Invalid action: ${action}. Valid actions are: ${validActions.join(', ')}`);
      }

      // Fetch current partner data
      const { data: partner, error: fetchError } = await supabase
        .from('partners')
        .select('*')
        .eq('id', partnerId)
        .single();

      if (fetchError) {
        console.error('❌ Error fetching partner:', fetchError);
        throw new Error(`Partner not found: ${fetchError.message}`);
      }

      if (!partner) {
        throw new Error('Partner not found');
      }

      console.log(`📋 Current partner status: ${partner.status}`);

      let updateData = {};
      let emailData = null;

      // Prepare update data based on action
      switch (action) {
        case 'approve':
          if (partner.status === 'approved') {
            console.log('⚠️ Partner already approved');
            return { message: 'Partner is already approved', partner };
          }
          
          updateData = { 
            status: 'approved', 
            approved_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          
          emailData = {
            to: partner.email,
            subject: 'Partner Application Approved - Elevatio',
            template: 'partner-approval',
            data: { 
              businessName: partner.business_name,
              contactPerson: partner.contact_person
            }
          };
          break;

        case 'reject':
          if (partner.status === 'rejected') {
            console.log('⚠️ Partner already rejected');
            return { message: 'Partner is already rejected', partner };
          }
          
          updateData = { 
            status: 'rejected',
            rejected_at: new Date().toISOString(),
            rejection_reason: data.reason || 'Application rejected',
            updated_at: new Date().toISOString()
          };
          
          emailData = {
            to: partner.email,
            subject: 'Partner Application Update - Elevatio',
            template: 'partner-rejection',
            data: { 
              businessName: partner.business_name,
              contactPerson: partner.contact_person,
              reason: data.reason
            }
          };
          break;

        case 'suspend':
          if (partner.status === 'suspended') {
            console.log('⚠️ Partner already suspended');
            return { message: 'Partner is already suspended', partner };
          }
          
          updateData = { 
            status: 'suspended',
            suspended_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          break;

        case 'activate':
          if (partner.status === 'suspended') {
            updateData = { 
              status: 'approved',
              suspended_at: null,
              updated_at: new Date().toISOString()
            };
          } else if (partner.status === 'approved') {
            console.log('⚠️ Partner already active');
            return { message: 'Partner is already active', partner };
          } else {
            throw new Error('Cannot activate partner that is not suspended or approved');
          }
          break;

        case 'update_commission':
          if (!data.commissionRate && data.commissionRate !== 0) {
            throw new Error('Commission rate is required');
          }
          
          const commissionRate = parseFloat(data.commissionRate);
          if (isNaN(commissionRate) || commissionRate < 0 || commissionRate > 1) {
            throw new Error('Commission rate must be a number between 0 and 1');
          }
          
          updateData = { 
            commission_rate: commissionRate,
            updated_at: new Date().toISOString()
          };
          break;

        case 'update':
          updateData = {
            ...data,
            updated_at: new Date().toISOString()
          };
          break;

        default:
          throw new Error(`Invalid action: ${action}`);
      }

      console.log(`🔄 Updating partner with data:`, updateData);

      // Perform the database update
      const { data: updatedPartner, error: updateError } = await supabase
        .from('partners')
        .update(updateData)
        .eq('id', partnerId)
        .select('*')
        .single();

      if (updateError) {
        console.error('❌ Database update error:', updateError);
        throw new Error(`Failed to update partner: ${updateError.message}`);
      }

      if (!updatedPartner) {
        console.error('❌ No data returned from update');
        throw new Error('Update failed: No data returned');
      }

      console.log(`✅ Partner updated successfully:`, {
        id: updatedPartner.id,
        oldStatus: partner.status,
        newStatus: updatedPartner.status,
        updatedAt: updatedPartner.updated_at
      });

      // Send email notification if needed (don't let email failures break the update)
      if (emailData) {
        try {
          console.log(`📧 Sending ${action} email to:`, emailData.to);
          await sendEmail(emailData);
          console.log(`✅ Email sent successfully for ${action}`);
        } catch (emailError) {
          console.error(`⚠️ Email sending failed for ${action}:`, emailError);
          // Don't throw error for email failures, just log it
        }
      }

      // Return success with updated partner data
      return { 
        message: `Partner ${action} successful`,
        partner: updatedPartner,
        previousStatus: partner.status,
        newStatus: updatedPartner.status
      };

    } catch (error) {
      console.error(`❌ AdminService - Error in ${action} partner:`, error);
      
      // Provide more specific error messages
      if (error.message.includes('not found')) {
        throw new Error(`Partner with ID ${partnerId} not found`);
      }
      
      if (error.message.includes('duplicate') || error.message.includes('unique')) {
        throw new Error('Partner update failed due to data conflict');
      }
      
      // Re-throw with original message if it's already descriptive
      throw error;
    }
  }

  /**
   * Enhanced getAllPartners method with comprehensive filtering, pagination, and error handling
   */
  async getAllPartners(page = 1, limit = 20, filters = {}) {
    console.log('🔍 AdminService - getAllPartners called with:', { page, limit, filters });

    try {
      // Validate and sanitize pagination parameters
      const validatedPage = Math.max(1, parseInt(page) || 1);
      const validatedLimit = Math.min(100, Math.max(1, parseInt(limit) || 20)); // Max 100 records per page
      const offset = (validatedPage - 1) * validatedLimit;

      console.log('📊 Validated pagination:', { page: validatedPage, limit: validatedLimit, offset });

      // Build the base query with comprehensive field selection
      let query = supabase
        .from('partners')
        .select(`
          id, 
          business_name, 
          email, 
          contact_person, 
          phone, 
          status, 
          commission_rate, 
          available_balance,
          created_at, 
          updated_at, 
          approved_at, 
          rejected_at, 
          suspended_at,
          rejection_reason,
          business_type,
          address,
          city,
          state,
          country,
          postal_code,
          website,
          description
        `, { count: 'exact' });

      // Apply status filter
      if (filters.status && filters.status.trim()) {
        const statusFilter = filters.status.trim().toLowerCase();
        console.log('🔍 Applying status filter:', statusFilter);
        query = query.eq('status', statusFilter);
      }

      // Apply comprehensive search filter
      if (filters.search && filters.search.trim()) {
        const searchTerm = filters.search.trim();
        console.log('🔍 Applying search filter:', searchTerm);
        
        // Search across multiple fields using OR condition
        const searchConditions = [
          `business_name.ilike.%${searchTerm}%`,
          `email.ilike.%${searchTerm}%`,
          `contact_person.ilike.%${searchTerm}%`,
          `phone.ilike.%${searchTerm}%`,
          `business_type.ilike.%${searchTerm}%`,
          `city.ilike.%${searchTerm}%`,
          `description.ilike.%${searchTerm}%`
        ].join(',');

        query = query.or(searchConditions);
      }

      // Apply additional filters
      if (filters.businessType && filters.businessType.trim()) {
        console.log('🔍 Applying business type filter:', filters.businessType);
        query = query.eq('business_type', filters.businessType.trim());
      }

      if (filters.city && filters.city.trim()) {
        console.log('🔍 Applying city filter:', filters.city);
        query = query.ilike('city', `%${filters.city.trim()}%`);
      }

      if (filters.country && filters.country.trim()) {
        console.log('🔍 Applying country filter:', filters.country);
        query = query.eq('country', filters.country.trim());
      }

      // Apply date range filters
      if (filters.createdAfter) {
        console.log('🔍 Applying created after filter:', filters.createdAfter);
        query = query.gte('created_at', filters.createdAfter);
      }

      if (filters.createdBefore) {
        console.log('🔍 Applying created before filter:', filters.createdBefore);
        query = query.lte('created_at', filters.createdBefore);
      }

      // Apply commission rate filters
      if (filters.minCommission !== undefined && filters.minCommission !== null) {
        console.log('🔍 Applying min commission filter:', filters.minCommission);
        query = query.gte('commission_rate', parseFloat(filters.minCommission));
      }

      if (filters.maxCommission !== undefined && filters.maxCommission !== null) {
        console.log('🔍 Applying max commission filter:', filters.maxCommission);
        query = query.lte('commission_rate', parseFloat(filters.maxCommission));
      }

      // Apply sorting
      const sortBy = filters.sortBy || 'created_at';
      const sortOrder = filters.sortOrder === 'asc' ? false : true; // true for descending (default)
      
      console.log('📈 Applying sort:', { sortBy, sortOrder: sortOrder ? 'desc' : 'asc' });
      query = query.order(sortBy, { ascending: !sortOrder });

      // Apply pagination
      query = query.range(offset, offset + validatedLimit - 1);

      // Execute the query
      console.log('🚀 Executing partners query...');
      const { data: partners, error, count } = await query;

      if (error) {
        console.error('❌ Database query error:', error);
        throw new Error(`Failed to fetch partners: ${error.message}`);
      }

      if (!partners) {
        console.warn('⚠️ No partners data returned');
        return {
          partners: [],
          pagination: {
            total: 0,
            page: validatedPage,
            limit: validatedLimit,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false
          }
        };
      }

      // Calculate pagination metadatacommission
      const totalRecords = count || 0;
      const totalPages = Math.ceil(totalRecords / validatedLimit);
      const hasNextPage = validatedPage < totalPages;
      const hasPreviousPage = validatedPage > 1;

      console.log('✅ Partners query successful:', {
        partnersCount: partners.length,
        totalRecords,
        totalPages,
        currentPage: validatedPage,
        hasNextPage,
        hasPreviousPage
      });

      // Process partners data to ensure consistency
      const processedPartners = partners.map(partner => ({
        ...partner,
        // Ensure commission_rate is properly formatted
        commission_rate: partner.commission_rate ? parseFloat(partner.commission_rate) : 0,
        // Ensure available_balance is properly formatted
        available_balance: partner.available_balance ? parseFloat(partner.available_balance) : 0,
        // Format dates consistently
        created_at: partner.created_at ? new Date(partner.created_at).toISOString() : null,
        updated_at: partner.updated_at ? new Date(partner.updated_at).toISOString() : null,
        approved_at: partner.approved_at ? new Date(partner.approved_at).toISOString() : null,
        rejected_at: partner.rejected_at ? new Date(partner.rejected_at).toISOString() : null,
        suspended_at: partner.suspended_at ? new Date(partner.suspended_at).toISOString() : null,
        // Ensure status is consistent
        status: partner.status ? partner.status.toLowerCase() : 'pending'
      }));

      // Return structured response
      return {
        partners: processedPartners,
        pagination: {
          total: totalRecords,
          page: validatedPage,
          limit: validatedLimit,
          totalPages,
          hasNextPage,
          hasPreviousPage,
          offset
        },
        filters: {
          ...filters,
          applied: Object.keys(filters).filter(key => 
            filters[key] !== undefined && 
            filters[key] !== null && 
            filters[key] !== ''
          )
        },
        metadata: {
          queryTime: new Date().toISOString(),
          resultsCount: processedPartners.length
        }
      };

    } catch (error) {
      console.error('❌ AdminService - Error in getAllPartners:', error);
      
      // Provide more specific error messages
      if (error.message.includes('permission')) {
        throw new Error('Insufficient permissions to access partners data');
      }
      
      if (error.message.includes('connection')) {
        throw new Error('Database connection error. Please try again.');
      }
      
      if (error.message.includes('timeout')) {
        throw new Error('Query timeout. Please try with more specific filters.');
      }
      
      // Re-throw with original message if it's already descriptive
      throw error;
    }
  }

  /**
   * Get partner statistics for dashboard
   */
  async getPartnerStats() {
    console.log('📊 AdminService - getPartnerStats called');

    try {
      // Get counts by status
      const { data: partners, error } = await supabase
        .from('partners')
        .select('status, created_at');

      if (error) {
        throw new Error(`Failed to fetch partner statistics: ${error.message}`);
      }

      // Calculate statistics
      const stats = {
        total: partners.length,
        pending: partners.filter(p => p.status === 'pending').length,
        approved: partners.filter(p => p.status === 'approved').length,
        rejected: partners.filter(p => p.status === 'rejected').length,
        suspended: partners.filter(p => p.status === 'suspended').length
      };

      // Get recent activity (partners created in last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentCount = partners.filter(p => 
        new Date(p.created_at) >= thirtyDaysAgo
      ).length;

      console.log('✅ Partner statistics retrieved:', stats);

      return {
        ...stats,
        recentSignups: recentCount,
        lastUpdated: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ AdminService - Error in getPartnerStats:', error);
      throw error;
    }
  }

  // 8. Method to approve payout (for admin use)

async approvePayout(payoutId, adminId = null) {
  try {
    console.log(`Processing payout approval: ${payoutId}`);

    // Get payout details with partner info
    const { data: payout, error: fetchError } = await supabase
      .from('payouts')
      .select(`
        *,
        partners!inner(available_balance, business_name, email, first_name, last_name)
      `)
      .eq('id', payoutId)
      .single();

    if (fetchError || !payout) {
      console.error('Payout fetch error:', fetchError);
      throw new Error('Payout not found');
    }

    if (payout.status !== 'pending') {
      throw new Error(`Cannot approve payout with status: ${payout.status}`);
    }

    const partner = payout.partners;
    const payoutAmount = parseFloat(payout.amount);
    const currentAvailableBalance = parseFloat(partner.available_balance) || 0;

    // Verify partner still has sufficient balance
    if (currentAvailableBalance < payoutAmount) {
      throw new Error(`Insufficient partner balance. Available: $${currentAvailableBalance.toFixed(2)}, Required: $${payoutAmount.toFixed(2)}`);
    }

    // Start transaction-like operations
    try {
      // 1. Update payout status to approved
      const { error: updatePayoutError } = await supabase
        .from('payouts')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: adminId,
          processed_at: new Date().toISOString()
        })
        .eq('id', payoutId);

      if (updatePayoutError) {
        throw new Error(`Failed to approve payout: ${updatePayoutError.message}`);
      }

      // 2. Deduct amount from partner's available balance
      const newAvailableBalance = currentAvailableBalance - payoutAmount;
      
      const { error: partnerUpdateError } = await supabase
        .from('partners')
        .update({
          available_balance: newAvailableBalance,
          updated_at: new Date().toISOString()
        })
        .eq('id', payout.partner_id);

      if (partnerUpdateError) {
        console.error('Partner balance update error:', partnerUpdateError);
        
        // Rollback payout approval
        await supabase
          .from('payouts')
          .update({
            status: 'pending',
            approved_at: null,
            approved_by: null,
            processed_at: null
          })
          .eq('id', payoutId);
        
        throw new Error(`Failed to update partner balance: ${partnerUpdateError.message}`);
      }

      console.log(`✅ Payout approved successfully: ${payoutId}`);
      console.log(`✅ Partner ${partner.business_name} balance updated: $${currentAvailableBalance} → $${newAvailableBalance}`);

      // Send approval notification email
      try {
        await this.sendPayoutApprovalEmail(partner, payout, newAvailableBalance);
      } catch (emailError) {
        console.warn('Failed to send payout approval email:', emailError);
      }

      return { 
        message: 'Payout approved successfully',
        payout_id: payoutId,
        amount: payoutAmount,
        partner_name: partner.business_name,
        previous_balance: currentAvailableBalance,
        new_balance: newAvailableBalance
      };

    } catch (transactionError) {
      console.error('Transaction error during payout approval:', transactionError);
      throw transactionError;
    }
    
  } catch (error) {
    console.error('Error approving payout:', error);
    throw error;
  }
}

async processPayout(payoutId, adminId, status = 'completed') {
  try {
    console.log(`Processing payout ${payoutId} with status: ${status}`);

    // Get payout details
    const { data: payout, error: payoutError } = await supabase
      .from('payouts')
      .select('*')
      .eq('id', payoutId)
      .single();

    if (payoutError || !payout) {
      throw new Error('Payout not found');
    }

    if (payout.status !== 'pending') {
      throw new Error(`Payout is not pending. Current status: ${payout.status}`);
    }

    // Update payout status
    const { error: updatePayoutError } = await supabase
      .from('payouts')
      .update({
        status: status,
        processed_at: new Date().toISOString(),
        processed_by: adminId,
        updated_at: new Date().toISOString()
      })
      .eq('id', payoutId);

    if (updatePayoutError) {
      throw new Error('Failed to update payout status');
    }

    // Update commission status based on payout result
    const newCommissionStatus = status === 'completed' ? 'paid_out' : 'earned';
    
    const { error: commissionUpdateError } = await supabase
      .from('partner_commissions')
      .update({ 
        status: newCommissionStatus,
        paid_out_at: status === 'completed' ? new Date().toISOString() : null
      })
      .eq('payout_id', payoutId);

    if (commissionUpdateError) {
      console.error('Error updating commission status after payout processing:', commissionUpdateError);
      // Don't throw - payout status is already updated
    }

    console.log(`✅ Payout ${payoutId} processed successfully with status: ${status}`);

    return {
      payout_id: payoutId,
      status: status,
      message: `Payout ${status} successfully`
    };

  } catch (error) {
    console.error('Error processing payout:', error);
    throw error;
  }
}

async rejectPayout(payoutId, adminId = null, rejectionReason = '') {
  try {
    console.log(`Processing payout rejection: ${payoutId}`);

    const { data: payout, error: fetchError } = await supabase
      .from('payouts')
      .select(`
        *,
        partners!inner(business_name, email, first_name, last_name)
      `)
      .eq('id', payoutId)
      .single();

    if (fetchError || !payout) {
      throw new Error('Payout not found');
    }

    if (payout.status !== 'pending') {
      throw new Error(`Cannot reject payout with status: ${payout.status}`);
    }

    // Update payout status to rejected
    const { error: updateError } = await supabase
      .from('payouts')
      .update({
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        rejected_by: adminId,
        rejection_reason: rejectionReason || 'Rejected by admin'
      })
      .eq('id', payoutId);

    if (updateError) {
      throw new Error('Failed to reject payout');
    }

    console.log(`✅ Payout rejected successfully: ${payoutId}`);

    // Send rejection notification email
    try {
      await this.sendPayoutRejectionEmail(payout.partners, payout, rejectionReason);
    } catch (emailError) {
      console.warn('Failed to send payout rejection email:', emailError);
    }

    return { 
      message: 'Payout rejected successfully',
      payout_id: payoutId,
      rejection_reason: rejectionReason
    };
    
  } catch (error) {
    console.error('Error rejecting payout:', error);
    throw error;
  }
}

async sendPayoutApprovalEmail(partner, payout, newBalance) {
  try {
    if (!emailService || typeof emailService.sendEmail !== 'function') {
      console.warn('Email service not available');
      return;
    }

    await emailService.sendEmail({
      to: partner.email,
      subject: 'Payout Approved - Funds Processed',
      template: 'payout-approval',
      data: {
        partner_name: partner.first_name,
        business_name: partner.business_name,
        amount: payout.amount,
        net_amount: payout.net_amount,
        processing_fee: payout.processing_fee,
        payout_id: payout.id,
        approved_at: new Date(payout.approved_at).toLocaleDateString(),
        new_balance: newBalance.toFixed(2)
      }
    });
    
  } catch (error) {
    console.error('Error sending payout approval email:', error);
  }
}

// Helper method to send payout rejection notification email
async sendPayoutRejectionEmail(partner, payout, rejectionReason) {
  try {
    if (!emailService || typeof emailService.sendEmail !== 'function') {
      console.warn('Email service not available');
      return;
    }

    await emailService.sendEmail({
      to: partner.email,
      subject: 'Payout Request Rejected',
      template: 'payout-rejection',
      data: {
        partner_name: partner.first_name,
        business_name: partner.business_name,
        amount: payout.amount,
        payout_id: payout.id,
        rejection_reason: rejectionReason || 'No reason provided',
        rejected_at: new Date().toLocaleDateString()
      }
    });
    
  } catch (error) {
    console.error('Error sending payout rejection email:', error);
  }
}


async getAllPayouts(page = 1, limit = 20, filters = {}) {
  try {
    console.log('Fetching all payouts with filters:', filters);

    const validatedPage = Math.max(1, parseInt(page) || 1);
    const validatedLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (validatedPage - 1) * validatedLimit;

    let query = supabase
      .from('payouts')
      .select(`
        *,
        partners!inner(business_name, email, first_name, last_name)
      `, { count: 'exact' });

    // Apply status filter
    if (filters.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }

    // Apply date range filter
    if (filters.startDate) {
      query = query.gte('requested_at', filters.startDate);
    }
    if (filters.endDate) {
      const endDateTime = new Date(filters.endDate);
      endDateTime.setHours(23, 59, 59, 999);
      query = query.lte('requested_at', endDateTime.toISOString());
    }

    // Apply search filter
    if (filters.search && filters.search.trim()) {
      const searchTerm = filters.search.trim();
      query = query.or(`partners.business_name.ilike.%${searchTerm}%,partners.email.ilike.%${searchTerm}%`);
    }

    // Apply sorting
    const sortBy = filters.sortBy || 'requested_at';
    const sortOrder = filters.sortOrder === 'asc' ? false : true;
    query = query.order(sortBy, { ascending: !sortOrder });

    // Apply pagination
    query = query.range(offset, offset + validatedLimit - 1);

    const { data: payouts, error, count } = await query;

    if (error) {
      console.error('Error fetching payouts:', error);
      throw new Error(`Failed to fetch payouts: ${error.message}`);
    }

    const totalRecords = count || 0;
    const totalPages = Math.ceil(totalRecords / validatedLimit);

    return {
      payouts: payouts || [],
      pagination: {
        total: totalRecords,
        page: validatedPage,
        limit: validatedLimit,
        totalPages,
        hasNextPage: validatedPage < totalPages,
        hasPreviousPage: validatedPage > 1
      }
    };

  } catch (error) {
    console.error('Error in getAllPayouts:', error);
    throw error;
  }
}
async getPayoutDetails(payoutId) {
    try {
      console.log(`📋 Getting payout details for: ${payoutId}`);

      const { data: payout, error } = await supabase
        .from('payouts')
        .select(`
          *,
          partners!inner(
            business_name,
            email,
            first_name,
            last_name,
            commission_rate,
            phone,
            available_balance
          )
        `)
        .eq('id', payoutId)
        .single();

      if (error || !payout) {
        throw new Error('Payout not found');
      }

      // Get associated commission details
      let commissionDetails = null;
      if (payout.commission_ids && payout.commission_ids.length > 0) {
        const { data: commissions, error: commissionError } = await supabase
          .from('partner_commissions')
          .select(`
            id,
            commission_amount,
            status,
            earned_at,
            booking_id,
            bookings!inner(
              booking_reference,
              total_amount,
              status as booking_status,
              created_at,
              user_id,
              users(first_name, last_name, email)
            )
          `)
          .in('id', payout.commission_ids);

        if (!commissionError) {
          commissionDetails = commissions;
        }
      }

      return {
        ...payout,
        commission_details: commissionDetails,
        commission_summary: commissionDetails ? {
          count: commissionDetails.length,
          total_amount: commissionDetails.reduce((sum, c) => sum + parseFloat(c.commission_amount), 0),
          date_range: {
            earliest: commissionDetails.reduce((min, c) => c.earned_at < min ? c.earned_at : min, commissionDetails[0]?.earned_at),
            latest: commissionDetails.reduce((max, c) => c.earned_at > max ? c.earned_at : max, commissionDetails[0]?.earned_at)
          }
        } : null
      };

    } catch (error) {
      console.error('Error getting payout details:', error);
      throw error;
    }
  }

  /**
   * Bulk payout actions (approve/reject multiple payouts)
   */
  async bulkPayoutAction(payoutIds, action, adminId = null, data = {}) {
    try {
      console.log(`🔄 Bulk payout action: ${action} for ${payoutIds.length} payouts`);

      if (!Array.isArray(payoutIds) || payoutIds.length === 0) {
        throw new Error('Payout IDs array is required');
      }

      const validActions = ['approve', 'reject'];
      if (!validActions.includes(action)) {
        throw new Error(`Invalid bulk action: ${action}`);
      }

      const results = {
        successful: [],
        failed: [],
        total: payoutIds.length
      };

      // Process each payout
      for (const payoutId of payoutIds) {
        try {
          let result;
          if (action === 'approve') {
            result = await this.approvePayout(payoutId, adminId);
          } else if (action === 'reject') {
            result = await this.rejectPayout(payoutId, adminId, data.rejectionReason);
          }

          results.successful.push({
            payout_id: payoutId,
            result
          });

        } catch (error) {
          console.error(`Failed to ${action} payout ${payoutId}:`, error);
          results.failed.push({
            payout_id: payoutId,
            error: error.message
          });
        }
      }

      console.log(`✅ Bulk ${action} completed:`, {
        successful: results.successful.length,
        failed: results.failed.length,
        total: results.total
      });

      return results;

    } catch (error) {
      console.error('Error in bulk payout action:', error);
      throw error;
    }
  }

  /**
   * Get payout statistics for dashboard
   */
  async getPayoutStatistics(filters = {}) {
    try {
      console.log('📊 Getting payout statistics with filters:', filters);

      // Base query
      let query = supabase.from('payouts').select('*');

      // Apply date filters
      if (filters.startDate) {
        query = query.gte('requested_at', filters.startDate);
      }
      if (filters.endDate) {
        const endDateTime = new Date(filters.endDate);
        endDateTime.setHours(23, 59, 59, 999);
        query = query.lte('requested_at', endDateTime.toISOString());
      }

      const { data: payouts, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch payout statistics: ${error.message}`);
      }

      const stats = {
        total_payouts: payouts.length,
        pending_payouts: payouts.filter(p => p.status === 'pending').length,
        approved_payouts: payouts.filter(p => p.status === 'approved').length,
        rejected_payouts: payouts.filter(p => p.status === 'rejected').length,
        completed_payouts: payouts.filter(p => p.status === 'completed').length,
        
        total_amount: payouts.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0),
        pending_amount: payouts.filter(p => p.status === 'pending').reduce((sum, p) => sum + parseFloat(p.amount || 0), 0),
        approved_amount: payouts.filter(p => p.status === 'approved').reduce((sum, p) => sum + parseFloat(p.amount || 0), 0),
        completed_amount: payouts.filter(p => p.status === 'completed').reduce((sum, p) => sum + parseFloat(p.amount || 0), 0),
        
        avg_payout_amount: payouts.length > 0 ? payouts.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) / payouts.length : 0,
        
        // Processing fees
        total_processing_fees: payouts.reduce((sum, p) => sum + parseFloat(p.processing_fee || 0), 0),
        
        // Timeline stats
        this_month: payouts.filter(p => {
          const payoutDate = new Date(p.requested_at);
          const now = new Date();
          return payoutDate.getMonth() === now.getMonth() && payoutDate.getFullYear() === now.getFullYear();
        }).length,
        
        last_30_days: payouts.filter(p => {
          const payoutDate = new Date(p.requested_at);
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          return payoutDate >= thirtyDaysAgo;
        }).length,

        // Status breakdown by percentage
        status_percentages: {
          pending: payouts.length > 0 ? (payouts.filter(p => p.status === 'pending').length / payouts.length * 100).toFixed(1) : 0,
          approved: payouts.length > 0 ? (payouts.filter(p => p.status === 'approved').length / payouts.length * 100).toFixed(1) : 0,
          rejected: payouts.length > 0 ? (payouts.filter(p => p.status === 'rejected').length / payouts.length * 100).toFixed(1) : 0,
          completed: payouts.length > 0 ? (payouts.filter(p => p.status === 'completed').length / payouts.length * 100).toFixed(1) : 0,
        },

        last_updated: new Date().toISOString()
      };

      console.log('✅ Payout statistics calculated:', stats);
      return stats;

    } catch (error) {
      console.error('Error getting payout statistics:', error);
      throw error;
    }
  }

  /**
   * Export payouts to CSV format
   */
  async exportPayouts(filters = {}) {
    try {
      console.log('📤 Exporting payouts with filters:', filters);

      let query = supabase
        .from('payouts')
        .select(`
          *,
          partners!inner(
            business_name,
            email,
            first_name,
            last_name,
            phone
          )
        `);

      // Apply filters
      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      if (filters.startDate) {
        query = query.gte('requested_at', filters.startDate);
      }

      if (filters.endDate) {
        const endDateTime = new Date(filters.endDate);
        endDateTime.setHours(23, 59, 59, 999);
        query = query.lte('requested_at', endDateTime.toISOString());
      }

      // Order by most recent first
      query = query.order('requested_at', { ascending: false });

      const { data: payouts, error } = await query;

      if (error) {
        throw new Error(`Failed to export payouts: ${error.message}`);
      }

      // Format data for CSV
      const csvData = payouts.map(payout => ({
        'Payout ID': payout.id,
        'Partner Business': payout.partners.business_name,
        'Partner Name': `${payout.partners.first_name} ${payout.partners.last_name}`,
        'Partner Email': payout.partners.email,
        'Partner Phone': payout.partners.phone || 'N/A',
        'Amount': parseFloat(payout.amount || 0).toFixed(2),
        'Net Amount': parseFloat(payout.net_amount || 0).toFixed(2),
        'Processing Fee': parseFloat(payout.processing_fee || 0).toFixed(2),
        'Status': payout.status.toUpperCase(),
        'Payment Method': payout.payment_method || 'N/A',
        'Bank Details': payout.bank_details ? JSON.stringify(payout.bank_details) : 'N/A',
        'Requested At': new Date(payout.requested_at).toLocaleString(),
        'Approved At': payout.approved_at ? new Date(payout.approved_at).toLocaleString() : 'N/A',
        'Processed At': payout.processed_at ? new Date(payout.processed_at).toLocaleString() : 'N/A',
        'Rejected At': payout.rejected_at ? new Date(payout.rejected_at).toLocaleString() : 'N/A',
        'Rejection Reason': payout.rejection_reason || 'N/A',
        'Admin Notes': payout.admin_notes || 'N/A'
      }));

      // Convert to CSV string
      if (csvData.length === 0) {
        return {
          csv: 'No data available for the selected filters',
          filename: `payouts_export_${new Date().toISOString().split('T')[0]}.csv`,
          count: 0
        };
      }

      const headers = Object.keys(csvData[0]);
      const csvString = [
        headers.join(','),
        ...csvData.map(row => 
          headers.map(header => {
            const value = row[header];
            // Escape commas and quotes in CSV
            if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
          }).join(',')
        )
      ].join('\n');

      console.log(`✅ Exported ${csvData.length} payouts to CSV`);

      return {
        csv: csvString,
        filename: `payouts_export_${new Date().toISOString().split('T')[0]}.csv`,
        count: csvData.length,
        filters_applied: filters
      };

    } catch (error) {
      console.error('Error exporting payouts:', error);
      throw error;
    }
  }

  /**
   * Get payout analytics data for charts
   */
  async getPayoutAnalytics(period = '30d') {
    try {
      console.log(`📈 Getting payout analytics for period: ${period}`);

      let startDate;
      const endDate = new Date();

      switch (period) {
        case '7d':
          startDate = new Date();
          startDate.setDate(startDate.getDate() - 7);
          break;
        case '30d':
          startDate = new Date();
          startDate.setDate(startDate.getDate() - 30);
          break;
        case '90d':
          startDate = new Date();
          startDate.setDate(startDate.getDate() - 90);
          break;
        case '1y':
          startDate = new Date();
          startDate.setFullYear(startDate.getFullYear() - 1);
          break;
        default:
          startDate = new Date();
          startDate.setDate(startDate.getDate() - 30);
      }

      const { data: payouts, error } = await supabase
        .from('payouts')
        .select('*')
        .gte('requested_at', startDate.toISOString())
        .lte('requested_at', endDate.toISOString())
        .order('requested_at', { ascending: true });

      if (error) {
        throw new Error(`Failed to fetch payout analytics: ${error.message}`);
      }

      // Group by date
      const dailyData = {};
      const statusData = { pending: 0, approved: 0, rejected: 0, completed: 0 };

      payouts.forEach(payout => {
        const date = new Date(payout.requested_at).toISOString().split('T')[0];
        
        if (!dailyData[date]) {
          dailyData[date] = {
            date,
            count: 0,
            amount: 0,
            pending: 0,
            approved: 0,
            rejected: 0,
            completed: 0
          };
        }

        dailyData[date].count++;
        dailyData[date].amount += parseFloat(payout.amount || 0);
        dailyData[date][payout.status]++;
        statusData[payout.status]++;
      });

      const chartData = Object.values(dailyData).sort((a, b) => new Date(a.date) - new Date(b.date));

      return {
        chart_data: chartData,
        status_summary: statusData,
        total_payouts: payouts.length,
        total_amount: payouts.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0),
        period,
        date_range: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        }
      };

    } catch (error) {
      console.error('Error getting payout analytics:', error);
      throw error;
    }
  }

  async processRefundRequest(refundId, action, adminId) {
  try {
    const { data: refund, error } = await supabase
      .from('refunds')
      .select(`
        *,
        bookings(booking_reference, total_amount),
        users(email, first_name, last_name)
      `)
      .eq('id', refundId)
      .single();

    if (error || !refund) {
      throw new Error('Refund request not found');
    }

    // Check if refund is still pending
    if (refund.status !== 'pending') {
      throw new Error('Refund request has already been processed');
    }

    if (action === 'approve') {
      // Process refund using WalletService for consistency
      const walletService = new WalletService();
      await walletService.creditWallet(
        refund.user_id,
        refund.amount,
        `Refund for booking ${refund.bookings?.booking_reference}`,
        `refund_${refundId}`
      );

      // Update refund status to 'completed' (matching your schema)
      const { error: updateError } = await supabase
        .from('refunds')
        .update({
          status: 'completed', // Changed from 'approved' to 'completed'
          processed_by: adminId,
          processed_at: new Date().toISOString()
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

      // Send approval email
      if (refund.users) {
        await sendEmail({
          to: refund.users.email,
          subject: 'Refund Approved - Elevatio',
          template: 'refund-approval',
          data: {
            userName: refund.users.first_name,
            amount: refund.amount,
            bookingReference: refund.bookings?.booking_reference,
            refundId: refundId
          }
        });
      }

    } else if (action === 'reject') {
      // Update refund status to 'failed' (matching your schema)
      const { error: updateError } = await supabase
        .from('refunds')
        .update({
          status: 'failed', // Changed from 'rejected' to 'failed'
          processed_by: adminId,
          processed_at: new Date().toISOString()
        })
        .eq('id', refundId);

      if (updateError) {
        console.error('Refund status update error:', updateError);
        throw new Error('Failed to update refund status');
      }

      // Send rejection email
      if (refund.users) {
        await sendEmail({
          to: refund.users.email,
          subject: 'Refund Request Update - Elevatio',
          template: 'refund-rejection',
          data: {
            userName: refund.users.first_name,
            amount: refund.amount,
            bookingReference: refund.bookings?.booking_reference,
            refundId: refundId
          }
        });
      }
    } else {
      throw new Error('Invalid action. Use "approve" or "reject"');
    }

    return { 
      message: `Refund ${action}d successfully`,
      refundId: refundId,
      status: action === 'approve' ? 'completed' : 'failed'
    };

  } catch (error) {
    console.error('Process refund request error:', error);
    throw error;
  }
}

  async getAllRefunds(page = 1, limit = 20, filters = {}) {
    try {
      const offset = (page - 1) * limit;
      let query = supabase
        .from('refunds')
        .select(`
          id,
          amount,
          status,
          created_at,
          processed_at,
          bookings(booking_reference),
          users(email, first_name, last_name)
        `, { count: 'exact' })
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

  async generateReports(reportType, dateRange) {
  try {
    const { startDate, endDate } = dateRange;
    
    switch (reportType) {
      case 'bookings':
        return await this.generateBookingsReport(startDate, endDate);
      case 'revenue':
        return await this.generateRevenueReport(startDate, endDate);
      case 'partners':
        return await this.generatePartnersReport(startDate, endDate);
      case 'users':
        return await this.generateUsersReport(startDate, endDate);
      default:
        throw new Error('Invalid report type');
    }
  } catch (error) {
    console.error('Report generation error:', error);
    throw error;
  }
}

async generateBookingsReport(startDate, endDate) {
  // First try with all fields, fall back to basic fields if columns don't exist
  let bookings, error;
  
  try {
    const result = await supabase
      .from('bookings')
      .select(`
        id,
        booking_reference,
        total_amount,
        status,
        booking_type,
        created_at,
        commission_earned,
        discount_amount,
        passengers(first_name, last_name, phone, email),
        users(email, first_name, last_name, phone),
        partners(business_name, email, commission_rate)
      `)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false });
    
    bookings = result.data;
    error = result.error;
  } catch (initialError) {
    console.warn('Full query failed, trying with basic fields:', initialError.message);
    
    // Fallback query with only guaranteed columns
    const result = await supabase
      .from('bookings')
      .select(`
        id,
        booking_reference,
        total_amount,
        status,
        booking_type,
        created_at,
        commission_earned,
        discount_amount,
        passengers(first_name, last_name),
        users(email, first_name, last_name),
        partners(business_name, email, commission_rate)
      `)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false });
    
    bookings = result.data;
    error = result.error;
  }

  if (error) {
    console.error('Bookings query error:', error);
    throw error;
  }

  // Process bookings data with null safety
  const processedBookings = (bookings || []).map(booking => ({
    ...booking,
    customer_name: booking.users ? 
      `${booking.users.first_name || ''} ${booking.users.last_name || ''}`.trim() || booking.users.email :
      'Unknown',
    passenger_names: booking.passengers && booking.passengers.length > 0 ? 
      booking.passengers.map(p => `${p.first_name || ''} ${p.last_name || ''}`.trim()).filter(name => name).join(', ') :
      'No passengers',
    partner_name: booking.partners?.business_name || 'Direct Booking'
  }));

  const summary = {
    totalBookings: bookings?.length || 0,
    confirmedBookings: bookings?.filter(b => b.status === 'confirmed').length || 0,
    cancelledBookings: bookings?.filter(b => b.status === 'cancelled').length || 0,
    pendingBookings: bookings?.filter(b => b.status === 'pending_payment').length || 0,
    totalValue: bookings?.reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0) || 0,
    confirmedValue: bookings
      ?.filter(b => b.status === 'confirmed')
      .reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0) || 0,
    oneWayBookings: bookings?.filter(b => b.booking_type === 'oneway').length || 0,
    roundTripBookings: bookings?.filter(b => b.booking_type === 'roundtrip').length || 0,
    averageBookingValue: bookings?.length > 0 ? 
      (bookings.reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0) / bookings.length) : 0,
    totalCommissions: bookings?.reduce((sum, b) => sum + (parseFloat(b.commission_earned) || 0), 0) || 0,
    partnerBookings: bookings?.filter(b => b.partners).length || 0,
    directBookings: bookings?.filter(b => !b.partners).length || 0
  };

  return {
    reportType: 'bookings',
    period: { startDate, endDate },
    data: processedBookings,
    summary
  };
}

async generateRevenueReport(startDate, endDate) {
  const { data: revenue, error } = await supabase
    .from('bookings')
    .select(`
      id,
      booking_reference,
      total_amount, 
      commission_earned, 
      discount_amount,
      created_at,
      booking_type,
      status,
      users(email, first_name, last_name),
      partners(business_name, commission_rate, email)
    `)
    .eq('status', 'confirmed')
    .gte('created_at', startDate)
    .lte('created_at', endDate)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Revenue query error:', error);
    throw error;
  }

  // Process revenue data with null safety
  const processedRevenue = (revenue || []).map(item => ({
    ...item,
    customer_name: item.users ? 
      `${item.users.first_name || ''} ${item.users.last_name || ''}`.trim() || item.users.email :
      'Unknown',
    partner_name: item.partners?.business_name || 'Direct Booking',
    net_amount: (parseFloat(item.total_amount) || 0) - (parseFloat(item.commission_earned) || 0) - (parseFloat(item.discount_amount) || 0)
  }));

  const summary = {
    totalRevenue: revenue?.reduce((sum, r) => sum + (parseFloat(r.total_amount) || 0), 0) || 0,
    totalCommissions: revenue?.reduce((sum, r) => sum + (parseFloat(r.commission_earned) || 0), 0) || 0,
    totalDiscounts: revenue?.reduce((sum, r) => sum + (parseFloat(r.discount_amount) || 0), 0) || 0,
    netRevenue: revenue?.reduce((sum, r) => sum + (parseFloat(r.total_amount) || 0) - (parseFloat(r.commission_earned) || 0), 0) || 0,
    averageBookingValue: revenue?.length > 0 ? 
      (revenue.reduce((sum, r) => sum + (parseFloat(r.total_amount) || 0), 0) / revenue.length) : 0,
    partnerBookings: revenue?.filter(r => r.partners).length || 0,
    directBookings: revenue?.filter(r => !r.partners).length || 0,
    oneWayRevenue: revenue?.filter(r => r.booking_type === 'oneway').reduce((sum, r) => sum + (parseFloat(r.total_amount) || 0), 0) || 0,
    roundTripRevenue: revenue?.filter(r => r.booking_type === 'roundtrip').reduce((sum, r) => sum + (parseFloat(r.total_amount) || 0), 0) || 0
  };

  return {
    reportType: 'revenue',
    period: { startDate, endDate },
    data: processedRevenue,
    summary
  };
}

async generatePartnersReport(startDate, endDate) {
  try {
    // First get all partners with basic info
    const { data: allPartners, error: partnersError } = await supabase
      .from('partners')
      .select(`
        id,
        business_name,
        email,
        status,
        commission_rate,
        total_earnings,
        created_at,
        phone,
        address
      `);

    if (partnersError) {
      console.error('Partners query error:', partnersError);
      throw partnersError;
    }

    // Then get bookings for the date range
    const { data: partnerBookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        id,
        total_amount,
        commission_earned,
        created_at,
        status,
        partner_id
      `)
      .not('partner_id', 'is', null)
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (bookingsError) {
      console.error('Partner bookings query error:', bookingsError);
      throw bookingsError;
    }

    // Process partner performance data with null safety
    const partnerStats = (allPartners || []).map(partner => {
      const partnerBookingsList = (partnerBookings || []).filter(b => b.partner_id === partner.id);
      const confirmedBookings = partnerBookingsList.filter(b => b.status === 'confirmed');
      
      return {
        id: partner.id,
        business_name: partner.business_name || 'Unknown Business',
        email: partner.email || '',
        status: partner.status || 'unknown',
        commission_rate: parseFloat(partner.commission_rate) || 0,
        phone: partner.phone || '',
        address: partner.address || '',
        created_at: partner.created_at,
        bookings: partnerBookingsList.length,
        confirmed_bookings: confirmedBookings.length,
        revenue: confirmedBookings.reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0),
        commissions: confirmedBookings.reduce((sum, b) => sum + (parseFloat(b.commission_earned) || 0), 0),
        pending_bookings: partnerBookingsList.filter(b => b.status === 'pending_payment').length,
        cancelled_bookings: partnerBookingsList.filter(b => b.status === 'cancelled').length,
        average_booking_value: confirmedBookings.length > 0 ? 
          (confirmedBookings.reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0) / confirmedBookings.length) : 0
      };
    });

    // Filter partners with activity in the date range
    const activePartnerStats = partnerStats.filter(p => p.bookings > 0);

    const summary = {
      totalPartners: allPartners?.length || 0,
      activePartners: allPartners?.filter(p => p.status === 'approved').length || 0,
      partnersWithBookings: activePartnerStats.length,
      totalCommissions: activePartnerStats.reduce((sum, p) => sum + p.commissions, 0),
      totalBookings: activePartnerStats.reduce((sum, p) => sum + p.bookings, 0),
      totalRevenue: activePartnerStats.reduce((sum, p) => sum + p.revenue, 0),
      averageCommissionRate: allPartners?.length > 0 ? 
        (allPartners.reduce((sum, p) => sum + (parseFloat(p.commission_rate) || 0), 0) / allPartners.length) : 0,
      topPerformingPartner: activePartnerStats.length > 0 ? 
        activePartnerStats.reduce((top, current) => current.revenue > top.revenue ? current : top).business_name : 'None'
    };

    return {
      reportType: 'partners',
      period: { startDate, endDate },
      data: activePartnerStats.length > 0 ? activePartnerStats : partnerStats.slice(0, 10),
      summary
    };
  } catch (error) {
    console.error('Partners report generation error:', error);
    throw error;
  }
}

async generateUsersReport(startDate, endDate) {
  const { data: users, error } = await supabase
    .from('users')
    .select(`
      id,
      email,
      first_name,
      last_name,
      status,
      email_verified,
      wallet_balance,
      created_at,
      last_login,
      phone,
      bookings(
        id,
        total_amount,
        status,
        created_at,
        booking_type
      )
    `)
    .gte('created_at', startDate)
    .lte('created_at', endDate)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Users query error:', error);
    throw error;
  }

  // Process user data with null safety
  const processedUsers = (users || []).map(user => {
    const userBookings = user.bookings || [];
    const confirmedBookings = userBookings.filter(b => b.status === 'confirmed');
    
    return {
      ...user,
      full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'No Name',
      total_bookings: userBookings.length,
      confirmed_bookings: confirmedBookings.length,
      pending_bookings: userBookings.filter(b => b.status === 'pending_payment').length,
      cancelled_bookings: userBookings.filter(b => b.status === 'cancelled').length,
      total_spent: confirmedBookings.reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0),
      average_booking_value: confirmedBookings.length > 0 ? 
        (confirmedBookings.reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0) / confirmedBookings.length) : 0,
      oneway_bookings: userBookings.filter(b => b.booking_type === 'oneway').length,
      roundtrip_bookings: userBookings.filter(b => b.booking_type === 'roundtrip').length
    };
  });

  const summary = {
    totalUsers: users?.length || 0,
    activeUsers: users?.filter(u => u.status === 'active').length || 0,
    verifiedUsers: users?.filter(u => u.email_verified).length || 0,
    usersWithBookings: users?.filter(u => u.bookings && u.bookings.length > 0).length || 0,
    totalWalletBalance: users?.reduce((sum, u) => sum + (parseFloat(u.wallet_balance) || 0), 0) || 0,
    averageWalletBalance: users?.length > 0 ? 
      (users.reduce((sum, u) => sum + (parseFloat(u.wallet_balance) || 0), 0) / users.length) : 0,
    totalUserSpending: processedUsers.reduce((sum, u) => sum + u.total_spent, 0),
    averageUserSpending: users?.length > 0 ? 
      (processedUsers.reduce((sum, u) => sum + u.total_spent, 0) / users.length) : 0
  };

  return {
    reportType: 'users',
    period: { startDate, endDate },
    data: processedUsers,
    summary
  };
}

  async managePromoCodes(action, promoData, promoId = null) {
  try {
    switch (action) {
      case 'create':
        const { data: newPromo, error: createError } = await supabase
          .from('promo_codes')
          .insert({
            code: promoData.code.toUpperCase(), // Ensure uppercase
            discount_type: promoData.discountType,
            discount_value: promoData.discountValue,
            max_discount: promoData.maxDiscount || null,
            usage_limit: promoData.usageLimit,
            expiry_date: promoData.expiryDate,
            status: 'active',
            created_by: promoData.adminId,
            used: 0, // Initialize usage count
            created_at: new Date().toISOString()
          })
          .select()
          .single();

        if (createError) throw createError;
        return { promo: newPromo, message: 'Promo code created successfully' };

      case 'update':
        // Only update the fields that are provided
        const updateFields = {};
        if (promoData.code) updateFields.code = promoData.code.toUpperCase();
        if (promoData.discountType) updateFields.discount_type = promoData.discountType;
        if (promoData.discountValue !== undefined) updateFields.discount_value = promoData.discountValue;
        if (promoData.maxDiscount !== undefined) updateFields.max_discount = promoData.maxDiscount;
        if (promoData.usageLimit !== undefined) updateFields.usage_limit = promoData.usageLimit;
        if (promoData.expiryDate) updateFields.expiry_date = promoData.expiryDate;
        
        updateFields.updated_at = new Date().toISOString();

        const { data: updatedPromo, error: updateError } = await supabase
          .from('promo_codes')
          .update(updateFields)
          .eq('id', promoId)
          .select()
          .single();

        if (updateError) throw updateError;
        return { promo: updatedPromo, message: 'Promo code updated successfully' };

      case 'deactivate':
        const { data: deactivatedPromo, error: deactivateError } = await supabase
          .from('promo_codes')
          .update({ 
            status: 'inactive',
            updated_at: new Date().toISOString()
          })
          .eq('id', promoId)
          .select()
          .single();

        if (deactivateError) throw deactivateError;
        return { promo: deactivatedPromo, message: 'Promo code deactivated successfully' };

      case 'activate':
        const { data: activatedPromo, error: activateError } = await supabase
          .from('promo_codes')
          .update({ 
            status: 'active',
            updated_at: new Date().toISOString()
          })
          .eq('id', promoId)
          .select()
          .single();

        if (activateError) throw activateError;
        return { promo: activatedPromo, message: 'Promo code activated successfully' };

      default:
        throw new Error('Invalid action');
    }
  } catch (error) {
    console.error('Promo code service error:', error);
    throw error;
  }
}

  // async getSystemLogs(page = 1, limit = 50, filters = {}) {
  //   try {
  //     const offset = (page - 1) * limit;
  //     let query = supabase
  //       .from('system_logs')
  //       .select('*', { count: 'exact' })
  //       .range(offset, offset + limit - 1)
  //       .order('created_at', { ascending: false });

  //     if (filters.level) {
  //       query = query.eq('level', filters.level);
  //     }
  //     if (filters.action) {
  //       query = query.eq('action', filters.action);
  //     }
  //     if (filters.startDate && filters.endDate) {
  //       query = query.gte('created_at', filters.startDate).lte('created_at', filters.endDate);
  //     }

  //     const { data: logs, error, count } = await query;

  //     if (error) throw error;

  //     return {
  //       logs,
  //       pagination: {
  //         page,
  //         limit,
  //         total: count,
  //         totalPages: Math.ceil(count / limit)
  //       }
  //     };
  //   } catch (error) {
  //     throw error;
  //   }
  // }

  async getAllBookings(page = 1, limit = 20, filters = {}) {
  console.log('🔍 AdminService - getAllBookings called with:', { page, limit, filters });
  
  try {
    // Validate and sanitize pagination parameters (matching your pattern)
    const validatedPage = Math.max(1, parseInt(page) || 1);
    const validatedLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (validatedPage - 1) * validatedLimit;

    console.log('📊 Validated pagination:', { page: validatedPage, limit: validatedLimit, offset });

    // Build the base query (matching your comprehensive select pattern)
    let query = supabase
      .from('bookings')
      .select(`
        *,
        users(id, email, first_name, last_name, phone),
        partners(id, business_name, email, phone),
        passengers(count),
        payments(id, amount, status, payment_method, created_at),
        seat_selections(count),
        baggage_selections(count)
      `, { count: 'exact' });

    // Apply status filter
    if (filters.status && filters.status.trim() && filters.status !== 'all') {
      const statusFilter = filters.status.trim().toLowerCase();
      console.log('🔍 Applying status filter:', statusFilter);
      query = query.eq('status', statusFilter);
    }

    // Apply booking type filter
    if (filters.bookingType && filters.bookingType.trim() && filters.bookingType !== 'all') {
      console.log('🔍 Applying booking type filter:', filters.bookingType);
      query = query.eq('booking_type', filters.bookingType.trim());
    }

    // Apply date range filter
    if (filters.startDate) {
      console.log('🔍 Applying start date filter:', filters.startDate);
      query = query.gte('created_at', filters.startDate);
    }
    if (filters.endDate) {
      console.log('🔍 Applying end date filter:', filters.endDate);
      // Add end of day to include the entire end date
      const endDateTime = new Date(filters.endDate);
      endDateTime.setHours(23, 59, 59, 999);
      query = query.lte('created_at', endDateTime.toISOString());
    }

    // Apply comprehensive search filter (matching your search pattern)
    if (filters.search && filters.search.trim()) {
      const searchTerm = filters.search.trim();
      console.log('🔍 Applying search filter:', searchTerm);
      
      // Search across multiple fields using OR condition
      const searchConditions = [
        `booking_reference.ilike.%${searchTerm}%`,
        `users.email.ilike.%${searchTerm}%`,
        `users.first_name.ilike.%${searchTerm}%`,
        `users.last_name.ilike.%${searchTerm}%`,
        `partners.business_name.ilike.%${searchTerm}%`
      ].join(',');

      query = query.or(searchConditions);
    }

    // Apply sorting (matching your pattern)
    const sortBy = filters.sortBy || 'created_at';
    const sortOrder = filters.sortOrder === 'asc' ? false : true;
    
    console.log('📈 Applying sort:', { sortBy, sortOrder: sortOrder ? 'desc' : 'asc' });
    query = query.order(sortBy, { ascending: !sortOrder });

    // Apply pagination
    query = query.range(offset, offset + validatedLimit - 1);

    // Execute the query
    console.log('🚀 Executing bookings query...');
    const { data: bookings, error, count } = await query;

    if (error) {
      console.error('❌ Database query error:', error);
      throw new Error(`Failed to fetch bookings: ${error.message}`);
    }

    if (!bookings) {
      console.warn('⚠️ No bookings data returned');
      return {
        bookings: [],
        pagination: {
          total: 0,
          page: validatedPage,
          limit: validatedLimit,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false
        }
      };
    }

    // Calculate pagination metadata (matching your pattern)
    const totalRecords = count || 0;
    const totalPages = Math.ceil(totalRecords / validatedLimit);
    const hasNextPage = validatedPage < totalPages;
    const hasPreviousPage = validatedPage > 1;

    console.log('✅ Bookings query successful:', {
      bookingsCount: bookings.length,
      totalRecords,
      totalPages,
      currentPage: validatedPage,
      hasNextPage,
      hasPreviousPage
    });

    // Process bookings data to ensure consistency (matching your pattern)
    const processedBookings = bookings.map(booking => ({
      ...booking,
      // Ensure amounts are properly formatted
      total_amount: booking.total_amount ? parseFloat(booking.total_amount) : 0,
      discount_amount: booking.discount_amount ? parseFloat(booking.discount_amount) : 0,
      commission_earned: booking.commission_earned ? parseFloat(booking.commission_earned) : 0,
      // Format dates consistently
      created_at: booking.created_at ? new Date(booking.created_at).toISOString() : null,
      updated_at: booking.updated_at ? new Date(booking.updated_at).toISOString() : null,
      // Ensure status is consistent
      status: booking.status ? booking.status.toLowerCase() : 'pending'
    }));

    // Return structured response (matching your pattern)
    return {
      bookings: processedBookings,
      pagination: {
        total: totalRecords,
        page: validatedPage,
        limit: validatedLimit,
        totalPages,
        hasNextPage,
        hasPreviousPage,
        offset
      },
      filters: {
        ...filters,
        applied: Object.keys(filters).filter(key => 
          filters[key] !== undefined && 
          filters[key] !== null && 
          filters[key] !== ''
        )
      },
      metadata: {
        queryTime: new Date().toISOString(),
        resultsCount: processedBookings.length
      }
    };

  } catch (error) {
    console.error('❌ AdminService - Error in getAllBookings:', error);
    
    // Provide more specific error messages (matching your pattern)
    if (error.message.includes('permission')) {
      throw new Error('Insufficient permissions to access bookings data');
    }
    
    if (error.message.includes('connection')) {
      throw new Error('Database connection error. Please try again.');
    }
    
    if (error.message.includes('timeout')) {
      throw new Error('Query timeout. Please try with more specific filters.');
    }
    
    // Re-throw with original message if it's already descriptive
    throw error;
  }
}

async getBookingDetails(bookingId) {
  try {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select(`
        *,
        users(id, email, first_name, last_name, phone, created_at),
        partners(id, business_name, email, phone, address),
        passengers(*),
        payments(
          id, 
          amount, 
          status, 
          payment_method, 
          transaction_id, 
          processed_at,
          created_at,
          updated_at
        ),
        seat_selections(
          id,
          seat_number,
          seat_class,
          extra_cost,
          passenger_id
        ),
        baggage_selections(
          id,
          baggage_type,
          weight_kg,
          extra_cost,
          passenger_id
        )
      `)
      .eq('id', bookingId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error('Booking not found');
      }
      throw error;
    }

    return booking;
  } catch (error) {
    console.error('Error in getBookingDetails service:', error);
    throw error;
  }
}

  async getSystemSettings() {
  try {
    const { data: settings, error } = await supabase
      .from('system_settings')
      .select('*')
      .eq('id', 1)
      .single();

    if (error) {
      // Handle case where table doesn't exist or no data found
      if (error.code === '42P01' || error.code === 'PGRST116') {
        console.log('System settings table/data not found, returning defaults');
        return {
          siteName: 'Elevatio',
          maintenanceMode: false,
          allowRegistration: true,
          maxFileSize: 5,
          sessionTimeout: 30
        };
      }
      throw error;
    }

    return {
      siteName: settings.site_name,
      maintenanceMode: settings.maintenance_mode,
      allowRegistration: settings.allow_registration,
      maxFileSize: settings.max_file_size,
      sessionTimeout: settings.session_timeout
    };
  } catch (error) {
    console.error('Error fetching system settings:', error);
    throw error;
  }
}

async updateSystemSettings(settings) {
  try {
    // Map frontend field names to database column names
    const dbSettings = {
      site_name: settings.siteName,
      maintenance_mode: settings.maintenanceMode,
      allow_registration: settings.allowRegistration,
      max_file_size: settings.maxFileSize,
      session_timeout: settings.sessionTimeout,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('system_settings')
      .upsert({
        id: 1,
        ...dbSettings
      })
      .select()
      .single();

    if (error) throw error;

    return { 
      settings: {
        siteName: data.site_name,
        maintenanceMode: data.maintenance_mode,
        allowRegistration: data.allow_registration,
        maxFileSize: data.max_file_size,
        sessionTimeout: data.session_timeout
      }, 
      message: 'System settings updated successfully' 
    };
  } catch (error) {
    console.error('Error updating system settings:', error);
    throw error;
  }
}

async getSystemLogs(page = 1, limit = 50, filters = {}) {
  try {
    const offset = (page - 1) * limit;
    let query = supabase
      .from('system_logs')
      .select('*', { count: 'exact' })
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    if (filters.level) {
      query = query.eq('level', filters.level);
    }
    if (filters.action) {
      query = query.eq('action', filters.action);
    }
    if (filters.startDate && filters.endDate) {
      query = query.gte('created_at', filters.startDate).lte('created_at', filters.endDate);
    }

    const { data: logs, error, count } = await query;

    if (error) {
      // Handle case where table doesn't exist
      if (error.code === '42P01') {
        console.log('System logs table not found, returning empty result');
        return {
          logs: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: 0,
            totalPages: 0
          }
        };
      }
      throw error;
    }

    return {
      logs: logs || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    };
  } catch (error) {
    console.error('Error fetching system logs:', error);
    throw error;
  }
}


/**
   * Send broadcast notification to users
   * @param {string} type - Notification type (info, warning, success, error)
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {string} recipients - Target recipients (all, active, partners, admins)
   * @returns {Promise<Object>} Result of notification send
   */
  async sendBroadcastNotification(type, title, message, recipients) {
    try {
      // Validate input
      if (!type || !title || !message || !recipients) {
        throw new Error('All notification fields are required');
      }

      const validTypes = ['info', 'warning', 'success', 'error'];
      const validRecipients = ['all', 'active', 'partners', 'admins'];

      if (!validTypes.includes(type)) {
        throw new Error('Invalid notification type');
      }

      if (!validRecipients.includes(recipients)) {
        throw new Error('Invalid recipients target');
      }

      // Get target users based on recipients filter
      const targetUsers = await this.getTargetUsers(recipients);

      if (targetUsers.length === 0) {
        throw new Error('No users found for the selected recipient group');
      }

      // Create notification record
      const notification = await this.createNotificationRecord({
        type,
        title,
        message,
        recipients,
        targetCount: targetUsers.length,
        sentAt: new Date(),
        status: 'pending'
      });

      // Send notifications to target users
      const sendResults = await this.sendNotificationsToUsers(targetUsers, {
        type,
        title,
        message,
        notificationId: notification.id
      });

      // Update notification status
      await this.updateNotificationStatus(notification.id, {
        status: 'sent',
        deliveredCount: sendResults.successCount,
        failedCount: sendResults.failureCount,
        completedAt: new Date()
      });

      return {
        success: true,
        notificationId: notification.id,
        targetCount: targetUsers.length,
        deliveredCount: sendResults.successCount,
        failedCount: sendResults.failureCount,
        message: 'Notification sent successfully'
      };

    } catch (error) {
      console.error('Error sending broadcast notification:', error);
      throw error;
    }
  }

  /**
   * Get target users based on recipients filter
   * @param {string} recipients - Target recipients
   * @returns {Promise<Array>} Array of target users
   */
  async getTargetUsers(recipients) {
    try {
      let query = 'SELECT id, email, push_token, notification_preferences FROM users WHERE ';
      let params = [];

      switch (recipients) {
        case 'all':
          query += 'status = ? AND deleted_at IS NULL';
          params = ['active'];
          break;
        case 'active':
          query += 'status = ? AND last_login_at > ? AND deleted_at IS NULL';
          params = ['active', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)]; // Active in last 30 days
          break;
        case 'partners':
          query += 'role = ? AND status = ? AND deleted_at IS NULL';
          params = ['partner', 'active'];
          break;
        case 'admins':
          query += 'role IN (?, ?) AND status = ? AND deleted_at IS NULL';
          params = ['admin', 'super_admin', 'active'];
          break;
        default:
          throw new Error('Invalid recipients filter');
      }

      const users = await db.query(query, params);
      return users || [];
    } catch (error) {
      console.error('Error getting target users:', error);
      throw error;
    }
  }

   /**
   * Send broadcast notification to users
   * @param {string} type - Notification type (info, warning, success, error)
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {string} recipients - Target recipients (all, active, partners, admins)
   * @returns {Promise<Object>} Result of notification send
   */
  async sendBroadcastNotification(type, title, message, recipients) {
    try {
      // Validate input
      if (!type || !title || !message || !recipients) {
        throw new Error('All notification fields are required');
      }

      const validTypes = ['info', 'warning', 'success', 'error'];
      const validRecipients = ['all', 'active', 'partners', 'admins'];

      if (!validTypes.includes(type)) {
        throw new Error('Invalid notification type');
      }

      if (!validRecipients.includes(recipients)) {
        throw new Error('Invalid recipients target');
      }

      // Get target users based on recipients filter
      const targetUsers = await this.getTargetUsers(recipients);

      if (targetUsers.length === 0) {
        throw new Error('No users found for the selected recipient group');
      }

      // Create notification record
      const notification = await this.createNotificationRecord({
        type,
        title,
        message,
        recipients,
        target_count: targetUsers.length,
        sent_at: new Date().toISOString(),
        status: 'pending'
      });

      // Send notifications to target users
      const sendResults = await this.sendNotificationsToUsers(targetUsers, {
        type,
        title,
        message,
        notificationId: notification.id
      });

      // Update notification status
      await this.updateNotificationStatus(notification.id, {
        status: 'sent',
        delivered_count: sendResults.successCount,
        failed_count: sendResults.failureCount,
        completed_at: new Date().toISOString()
      });

      return {
        success: true,
        notificationId: notification.id,
        targetCount: targetUsers.length,
        deliveredCount: sendResults.successCount,
        failedCount: sendResults.failureCount,
        message: 'Notification sent successfully'
      };

    } catch (error) {
      console.error('Error sending broadcast notification:', error);
      throw error;
    }
  }

  // /**
  //  * Get target users based on recipients filter
  //  * @param {string} recipients - Target recipients
  //  * @returns {Promise<Array>} Array of target users
  //  */
  // async getTargetUsers(recipients) {
  //   try {
  //     let query = supabase
  //       .from('users')
  //       .select('id, email, push_token, notification_preferences')
  //       .is('deleted_at', null);

  //     switch (recipients) {
  //       case 'all':
  //         query = query.eq('status', 'active');
  //         break;
  //       case 'active':
  //         const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  //         query = query
  //           .eq('status', 'active')
  //           .gt('last_login_at', thirtyDaysAgo);
  //         break;
  //       case 'partners':
  //         query = query
  //           .eq('role', 'partner')
  //           .eq('status', 'active');
  //         break;
  //       case 'admins':
  //         query = query
  //           .in('role', ['admin', 'super_admin'])
  //           .eq('status', 'active');
  //         break;
  //       default:
  //         throw new Error('Invalid recipients filter');
  //     }

  //     const { data: users, error } = await query;
      
  //     if (error) {
  //       console.error('Supabase error getting target users:', error);
  //       throw new Error(`Database error: ${error.message}`);
  //     }

  //     return users || [];
  //   } catch (error) {
  //     console.error('Error getting target users:', error);
  //     throw error;
  //   }
  // }

  /**
   * Create notification record in database
   * @param {Object} notificationData - Notification data
   * @returns {Promise<Object>} Created notification record
   */
  async createNotificationRecord(notificationData) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .insert([{
          type: notificationData.type,
          title: notificationData.title,
          message: notificationData.message,
          recipients: notificationData.recipients,
          target_count: notificationData.target_count,
          sent_at: notificationData.sent_at,
          status: notificationData.status,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) {
        console.error('Supabase error creating notification record:', error);
        throw new Error(`Database error: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('Error creating notification record:', error);
      throw error;
    }
  }

  /**
   * Send notifications to individual users
   * @param {Array} users - Target users
   * @param {Object} notificationData - Notification data
   * @returns {Promise<Object>} Send results
   */
  async sendNotificationsToUsers(users, notificationData) {
    try {
      let successCount = 0;
      let failureCount = 0;
      const sendPromises = [];

      for (const user of users) {
        const sendPromise = this.sendSingleNotification(user, notificationData)
          .then(() => {
            successCount++;
            return this.createUserNotificationRecord(user.id, notificationData.notificationId, 'delivered');
          })
          .catch((error) => {
            failureCount++;
            console.error(`Failed to send notification to user ${user.id}:`, error);
            return this.createUserNotificationRecord(user.id, notificationData.notificationId, 'failed');
          });

        sendPromises.push(sendPromise);
      }

      await Promise.allSettled(sendPromises);

      return {
        successCount,
        failureCount,
        totalCount: users.length
      };
    } catch (error) {
      console.error('Error sending notifications to users:', error);
      throw error;
    }
  }

  /**
   * Send single notification to a user
   * @param {Object} user - Target user
   * @param {Object} notificationData - Notification data
   * @returns {Promise<void>}
   */
  async sendSingleNotification(user, notificationData) {
    try {
      // Check user's notification preferences
      const preferences = user.notification_preferences || {};
      
      // Send push notification if user has push token and preferences allow
      if (user.push_token && preferences.push_notifications !== false) {
        await this.sendPushNotification(user.push_token, {
          title: notificationData.title,
          body: notificationData.message,
          type: notificationData.type
        });
      }

      // Send email notification if preferences allow
      if (preferences.email_notifications !== false) {
        await this.sendEmailNotification(user.email, {
          title: notificationData.title,
          message: notificationData.message,
          type: notificationData.type
        });
      }

      // Create in-app notification
      await this.createInAppNotification(user.id, notificationData);

    } catch (error) {
      console.error(`Error sending notification to user ${user.id}:`, error);
      throw error;
    }
  }

  /**
   * Send push notification
   * @param {string} pushToken - User's push token
   * @param {Object} notificationData - Notification data
   * @returns {Promise<void>}
   */
  async sendPushNotification(pushToken, notificationData) {
    try {
      // Implement your push notification service here (Firebase, AWS SNS, etc.)
      // This is a placeholder implementation
      console.log('Sending push notification:', { pushToken, notificationData });
      
      // Example with Firebase (you'll need to implement this based on your setup)
      // const message = {
      //   notification: {
      //     title: notificationData.title,
      //     body: notificationData.body
      //   },
      //   data: {
      //     type: notificationData.type
      //   },
      //   token: pushToken
      // };
      // await admin.messaging().send(message);
      
    } catch (error) {
      console.error('Error sending push notification:', error);
      throw error;
    }
  }

  /**
   * Send email notification
   * @param {string} email - User's email
   * @param {Object} notificationData - Notification data
   * @returns {Promise<void>}
   */
  async sendEmailNotification(email, notificationData) {
    try {
      // Implement your email service here (SendGrid, AWS SES, etc.)
      // This is a placeholder implementation
      console.log('Sending email notification:', { email, notificationData });
      
      // Example email sending logic
      // await emailService.send({
      //   to: email,
      //   subject: notificationData.title,
      //   html: this.generateEmailTemplate(notificationData)
      // });
      
    } catch (error) {
      console.error('Error sending email notification:', error);
      throw error;
    }
  }

  /**
 * Create user notification delivery record
 * @param {string} userId - User ID (can be admin string or UUID)
 * @param {string} notificationId - Notification ID (UUID)
 * @param {string} status - Delivery status
 * @param {string} deliveryMethod - Delivery method (default: 'in_app')
 * @param {string} errorMessage - Error message if failed
 * @returns {Promise<void>}
 */
async createUserNotificationRecord(userId, notificationId, status, deliveryMethod = 'in_app', errorMessage = null) {
  try {
    // For admin users, we need to handle the string ID differently
    const isAdmin = typeof userId === 'string' && userId.startsWith('admin-');
    
    if (isAdmin) {
      // For admin users, we might want to skip creating delivery records
      // or handle them differently since they don't exist in the users table
      console.log(`Skipping notification delivery record for admin user: ${userId}`);
      return;
    }

    const { error } = await supabase
      .from('notification_deliveries')
      .insert([{
        user_id: userId,
        notification_id: notificationId,
        status: status,
        delivery_method: deliveryMethod,
        error_message: errorMessage,
        delivered_at: new Date().toISOString()
      }]);

    if (error) {
      console.error('Supabase error creating user notification record:', error);
      throw new Error(`Database error: ${error.message}`);
    }
  } catch (error) {
    console.error('Error creating user notification record:', error);
    throw error;
  }
}

/**
 * Create in-app notification record
 * @param {string} userId - User ID (can be admin string or UUID)
 * @param {Object} notificationData - Notification data
 * @returns {Promise<void>}
 */
async createInAppNotification(userId, notificationData) {
  try {
    // For admin users, we need to handle the string ID differently
    const isAdmin = typeof userId === 'string' && userId.startsWith('admin-');
    
    if (isAdmin) {
      // For admin users, we might want to skip creating in-app notifications
      // since they don't exist in the users table
      console.log(`Skipping in-app notification for admin user: ${userId}`);
      return;
    }

    const { error } = await supabase
      .from('user_notifications')
      .insert([{
        user_id: userId,
        notification_id: notificationData.notificationId,
        title: notificationData.title,
        message: notificationData.message,
        type: notificationData.type,
        is_read: false,
        created_at: new Date().toISOString()
      }]);

    if (error) {
      console.error('Supabase error creating in-app notification:', error);
      throw new Error(`Database error: ${error.message}`);
    }
  } catch (error) {
    console.error('Error creating in-app notification:', error);
    throw error;
  }
}

/**
 * Get users based on recipient type - Updated to handle admin logic properly
 * @param {string} recipients - Recipient type ('all', 'active', 'partners', 'admins')
 * @returns {Promise<Array>} Array of users
 */
async getTargetUsers(recipients) {
  try {
    let users = [];

    switch (recipients) {
      case 'all':
        const { data: allUsers, error: allError } = await supabase
          .from('users')
          .select('id, email, first_name, last_name, push_token, notification_preferences, status');
        
        if (allError) throw new Error(`Database error: ${allError.message}`);
        users = allUsers || [];
        break;

      case 'active':
        const { data: activeUsers, error: activeError } = await supabase
          .from('users')
          .select('id, email, first_name, last_name, push_token, notification_preferences, status')
          .eq('status', 'active');
        
        if (activeError) throw new Error(`Database error: ${activeError.message}`);
        users = activeUsers || [];
        break;

      case 'partners':
        const { data: partners, error: partnersError } = await supabase
          .from('users')
          .select('id, email, first_name, last_name, push_token, notification_preferences, status')
          .eq('user_type', 'partner')
          .eq('status', 'active');
        
        if (partnersError) throw new Error(`Database error: ${partnersError.message}`);
        users = partners || [];
        break;

      case 'admins':
        // For admin notifications, we create a virtual admin user
        // This allows the notification system to work with admin users
        users = [{
          id: 'admin-system',
          email: process.env.ADMIN_EMAIL || 'admin@system.local',
          first_name: 'Admin',
          last_name: 'User',
          push_token: null,
          notification_preferences: {
            push_notifications: false,
            email_notifications: true
          },
          status: 'active'
        }];
        break;

      default:
        throw new Error(`Invalid recipient type: ${recipients}`);
    }

    return users;

  } catch (error) {
    console.error('Error getting target users:', error);
    throw error;
  }
}
  /**
   * Update notification status
   * @param {number} notificationId - Notification ID
   * @param {Object} updateData - Update data
   * @returns {Promise<void>}
   */
  async updateNotificationStatus(notificationId, updateData) {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({
          status: updateData.status,
          delivered_count: updateData.delivered_count,
          failed_count: updateData.failed_count,
          completed_at: updateData.completed_at
        })
        .eq('id', notificationId);

      if (error) {
        console.error('Supabase error updating notification status:', error);
        throw new Error(`Database error: ${error.message}`);
      }
    } catch (error) {
      console.error('Error updating notification status:', error);
      throw error;
    }
  }

  /**
   * Get notification history
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @param {Object} filters - Filter options
   * @returns {Promise<Object>} Notification history
   */
  async getNotificationHistory(page = 1, limit = 20, filters = {}) {
    try {
      const offset = (page - 1) * limit;
      
      // Build query with filters
      let query = supabase.from('notifications').select('*', { count: 'exact' });

      if (filters.type) {
        query = query.eq('type', filters.type);
      }

      if (filters.recipients) {
        query = query.eq('recipients', filters.recipients);
      }

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      if (filters.dateFrom) {
        query = query.gte('sent_at', filters.dateFrom);
      }

      if (filters.dateTo) {
        query = query.lte('sent_at', filters.dateTo);
      }

      // Execute query with pagination
      const { data: notifications, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('Supabase error getting notification history:', error);
        throw new Error(`Database error: ${error.message}`);
      }

      const total = count || 0;
      const totalPages = Math.ceil(total / limit);

      return {
        notifications: notifications || [],
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    } catch (error) {
      console.error('Error getting notification history:', error);
      throw error;
    }
  }

  /**
 * Get notification statistics
 * @param {string} dateFrom - Start date
 * @param {string} dateTo - End date
 * @returns {Promise<Object>} Notification statistics
 */
async getNotificationStatistics(dateFrom, dateTo) {
  try {
    // Get total notifications
    const { data: totalNotifications, error: totalError } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .gte('sent_at', dateFrom)
      .lte('sent_at', dateTo);

    if (totalError) {
      console.error('Error getting total notifications:', totalError);
      throw new Error(`Database error: ${totalError.message}`);
    }

    // Get statistics by type
    const { data: byType, error: typeError } = await supabase
      .from('notifications')
      .select('type, delivered_count, failed_count')
      .gte('sent_at', dateFrom)
      .lte('sent_at', dateTo);

    if (typeError) {
      console.error('Error getting notifications by type:', typeError);
      throw new Error(`Database error: ${typeError.message}`);
    }

    // Get statistics by recipients
    const { data: byRecipients, error: recipientsError } = await supabase
      .from('notifications')
      .select('recipients, delivered_count, failed_count')
      .gte('sent_at', dateFrom)
      .lte('sent_at', dateTo);

    if (recipientsError) {
      console.error('Error getting notifications by recipients:', recipientsError);
      throw new Error(`Database error: ${recipientsError.message}`);
    }

    // Calculate statistics
    const typeStats = {};
    const recipientStats = {};
    let totalDelivered = 0;
    let totalFailed = 0;

    byType?.forEach(notification => {
      const type = notification.type;
      if (!typeStats[type]) {
        typeStats[type] = { delivered: 0, failed: 0, total: 0 };
      }
      typeStats[type].delivered += notification.delivered_count || 0;
      typeStats[type].failed += notification.failed_count || 0;
      typeStats[type].total += 1;
      
      totalDelivered += notification.delivered_count || 0;
      totalFailed += notification.failed_count || 0;
    });

    byRecipients?.forEach(notification => {
      const recipient = notification.recipients;
      if (!recipientStats[recipient]) {
        recipientStats[recipient] = { delivered: 0, failed: 0, total: 0 };
      }
      recipientStats[recipient].delivered += notification.delivered_count || 0;
      recipientStats[recipient].failed += notification.failed_count || 0;
      recipientStats[recipient].total += 1;
    });

    return {
      overview: {
        totalNotifications: totalNotifications?.length || 0,
        totalDelivered,
        totalFailed,
        deliveryRate: totalDelivered + totalFailed > 0 ? (totalDelivered / (totalDelivered + totalFailed) * 100).toFixed(2) : 0
      },
      byType: typeStats,
      byRecipients: recipientStats,
      period: {
        from: dateFrom,
        to: dateTo
      }
    };

  } catch (error) {
    console.error('Error getting notification statistics:', error);
    throw error;
  }
}

/**
 * Get notification delivery details
 * @param {string} notificationId - Notification ID (UUID)
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @param {string} requesterId - ID of the user making the request (could be admin or regular user)
 * @returns {Promise<Object>} Delivery details
 */
async getNotificationDeliveryDetails(notificationId, page = 1, limit = 50, requesterId = null) {
  try {
    const offset = (page - 1) * limit;

    // Check if requester is admin
    const isAdmin = requesterId && (typeof requesterId === 'string' && requesterId.startsWith('admin-'));

    // Get notification details
    const { data: notification, error: notificationError } = await supabase
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .single();

    if (notificationError) {
      console.error('Error getting notification:', notificationError);
      throw new Error(`Database error: ${notificationError.message}`);
    }

    if (!notification) {
      throw new Error('Notification not found');
    }

    // For admin users, get all delivery records with user details
    if (isAdmin) {
      // Get delivery records with user details using LEFT JOIN to handle missing users
      const { data: deliveries, error: deliveriesError, count } = await supabase
        .from('notification_deliveries')
        .select(`
          *,
          users:user_id (
            id,
            email,
            first_name,
            last_name
          )
        `, { count: 'exact' })
        .eq('notification_id', notificationId)
        .order('delivered_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (deliveriesError) {
        console.error('Error getting delivery records:', deliveriesError);
        throw new Error(`Database error: ${deliveriesError.message}`);
      }

      // Process deliveries to handle cases where user might not exist
      const processedDeliveries = (deliveries || []).map(delivery => ({
        ...delivery,
        user: delivery.users || {
          id: delivery.user_id,
          email: delivery.user_id.startsWith('admin-') ? 'Admin User' : 'Unknown User',
          first_name: delivery.user_id.startsWith('admin-') ? 'Admin' : 'Unknown',
          last_name: delivery.user_id.startsWith('admin-') ? 'User' : 'User'
        }
      }));

      const total = count || 0;
      const totalPages = Math.ceil(total / limit);

      return {
        notification,
        deliveries: processedDeliveries,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    } else {
      // For regular users, only show their own delivery records
      if (!requesterId) {
        throw new Error('User ID required for non-admin access');
      }

      const { data: deliveries, error: deliveriesError, count } = await supabase
        .from('notification_deliveries')
        .select(`
          *,
          users:user_id (
            id,
            email,
            first_name,
            last_name
          )
        `, { count: 'exact' })
        .eq('notification_id', notificationId)
        .eq('user_id', requesterId)
        .order('delivered_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (deliveriesError) {
        console.error('Error getting delivery records:', deliveriesError);
        throw new Error(`Database error: ${deliveriesError.message}`);
      }

      const total = count || 0;
      const totalPages = Math.ceil(total / limit);

      return {
        notification,
        deliveries: deliveries || [],
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    }

  } catch (error) {
    console.error('Error getting notification delivery details:', error);
    throw error;
  }
}

/**
 * Delete notification
 * @param {number} notificationId - Notification ID
 * @returns {Promise<void>}
 */
async deleteNotification(notificationId) {
  try {
    // Check if notification exists
    const { data: notification, error: checkError } = await supabase
      .from('notifications')
      .select('id')
      .eq('id', notificationId)
      .single();

    if (checkError) {
      console.error('Error checking notification:', checkError);
      throw new Error(`Database error: ${checkError.message}`);
    }

    if (!notification) {
      throw new Error('Notification not found');
    }

    // Delete related records first (due to foreign key constraints)
    
    // Delete user notifications
    const { error: userNotificationsError } = await supabase
      .from('user_notifications')
      .delete()
      .eq('notification_id', notificationId);

    if (userNotificationsError) {
      console.error('Error deleting user notifications:', userNotificationsError);
      throw new Error(`Database error: ${userNotificationsError.message}`);
    }

    // Delete notification deliveries
    const { error: deliveriesError } = await supabase
      .from('notification_deliveries')
      .delete()
      .eq('notification_id', notificationId);

    if (deliveriesError) {
      console.error('Error deleting notification deliveries:', deliveriesError);
      throw new Error(`Database error: ${deliveriesError.message}`);
    }

    // Delete the notification
    const { error: deleteError } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId);

    if (deleteError) {
      console.error('Error deleting notification:', deleteError);
      throw new Error(`Database error: ${deleteError.message}`);
    }

  } catch (error) {
    console.error('Error deleting notification:', error);
    throw error;
  }
}

/**
 * Get notification templates
 * @returns {Promise<Array>} Notification templates
 */
async getNotificationTemplates() {
  try {
    const { data: templates, error } = await supabase
      .from('notification_templates')
      .select('*')
      .order('name');

    if (error) {
      console.error('Error getting notification templates:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return templates || [];

  } catch (error) {
    console.error('Error getting notification templates:', error);
    throw error;
  }
}

/**
 * Save notification template
 * @param {Object} templateData - Template data
 * @returns {Promise<Object>} Saved template
 */
async saveNotificationTemplate(templateData) {
  try {
    const { data: template, error } = await supabase
      .from('notification_templates')
      .upsert([{
        name: templateData.name,
        type: templateData.type,
        title: templateData.title,
        message: templateData.message,
        description: templateData.description,
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      console.error('Error saving notification template:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return template;

  } catch (error) {
    console.error('Error saving notification template:', error);
    throw error;
  }
}

}

module.exports = AdminService;