import User from '../Models/User.js';
import Booking from '../Models/Booking.js';
import Ride from '../Models/Ride.js';
import Wallet from '../Models/Wallet.js';
import Withdrawal from '../Models/Withdrawal.js';

// Get list of drivers (with filter for pending/verified)
export const getDrivers = async (req, res) => {
    try {
        console.log(`Admin ${req.user.email} fetching drivers...`);
        const { status } = req.query;
        let query = { role: { $regex: /^driver$/i } };

        if (status === 'pending') {
            query['driverApprovalStatus'] = 'pending';
        } else if (status === 'approved') {
            query['driverApprovalStatus'] = 'approved';
        } else if (status === 'rejected') {
            query['driverApprovalStatus'] = 'rejected';
        }

        const drivers = await User.find(query).select('-password');
        console.log(`Found ${drivers.length} drivers.`);
        res.json({ success: true, count: drivers.length, data: drivers });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Verify driver documents
export const verifyDriver = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body; // 'approve' or 'reject'

        const driver = await User.findById(id);
        if (!driver || !/^driver$/i.test(driver.role)) {
            return res.status(404).json({ success: false, message: 'Driver not found' });
        }

        if (action === 'approve') {
            driver.driverApprovalStatus = 'approved';
            driver.rejectionReason = ""; // Clear rejection reason on approval
            driver.verificationStatus = {
                email: true,
                phone: true, 
                idCard: true,
                communityTrusted: true
            };
            driver.driverDetails.isOnline = false;
            await driver.save();
            return res.json({ success: true, message: 'Driver approved successfully', data: driver });
            
        } else if (action === 'reject') {
            const { rejectionReason } = req.body;
            driver.driverApprovalStatus = 'rejected';
            driver.rejectionReason = rejectionReason || "Your documents did not meet our requirements.";
            driver.verificationStatus.communityTrusted = false;
            driver.verificationStatus.idCard = false;
            await driver.save();
            return res.json({ success: true, message: 'Driver rejected', data: driver });
        } else {
            return res.status(400).json({ success: false, message: 'Invalid action' });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Get list of passengers
export const getPassengers = async (req, res) => {
    try {
        console.log(`Admin ${req.user.email} fetching passengers...`);
        const passengers = await User.find({ 
            role: { $regex: /^passenger$/i } 
        }).select('-password');
        
        console.log(`Found ${passengers.length} passengers.`);
        res.json({ success: true, count: passengers.length, data: passengers });
    } catch (error) {
        console.error('getPassengers error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Toggle user block status
export const toggleBlockStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findById(id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        user.isBlocked = !user.isBlocked;
        await user.save();

        res.json({ success: true, message: `User ${user.isBlocked ? 'blocked' : 'unblocked'} successfully`, data: user });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Get ride history for a specific passenger
export const getPassengerRides = async (req, res) => {
    try {
        const { id } = req.params;
        const rides = await Booking.find({ passenger: id })
            .populate('driver', 'name phone profileImage')
            .sort({ createdAt: -1 });
            
        res.json({ success: true, data: rides });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Get transaction history for a specific passenger
export const getPassengerTransactions = async (req, res) => {
    try {
        const { id } = req.params;
        
        // For now, transactions are inferred from completed or paid bookings. 
        // We'll return bookings that have a finalFare > 0.
        const rides = await Booking.find({ 
            passenger: id, 
            status: { $in: ['completed', 'cancelled'] } // cancelled might have cancellation fees later
        })
        .populate('driver', 'name')
        .sort({ createdAt: -1 });

        const transactions = rides.map(ride => {
            const isRefund = ride.status === 'cancelled' && ride.paymentStatus === 'completed'; // basic logic
            return {
                id: ride._id,
                date: ride.createdAt,
                type: isRefund ? 'Refund' : 'Payment',
                amount: ride.finalFare || ride.offeredFare || ride.estimatedFare, // Fallback fields
                method: ride.paymentMethod || 'cash',
                status: isRefund ? 'processed' : ride.paymentStatus === 'completed' ? 'success' : 'pending',
                relatedTo: ride.driver ? ride.driver.name : 'Unknown Driver',
                rideId: ride._id
            };
        });

        res.json({ success: true, data: transactions });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
// Get dashboard statistics
export const getDashboardStats = async (req, res) => {
    try {
        const totalPassengers = await User.countDocuments({ role: { $regex: /^passenger$/i } });
        const totalDrivers = await User.countDocuments({ role: { $regex: /^driver$/i } });
        const activeDrivers = await User.countDocuments({ role: { $regex: /^driver$/i }, driverApprovalStatus: 'approved' });
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const newRegistrationsToday = await User.countDocuments({ createdAt: { $gte: today } });

        // Revenue stats
        const revenueStats = await Booking.aggregate([
            { $match: { status: 'completed' } },
            { $group: {
                _id: null,
                totalRevenue: { $sum: '$finalFare' },
                todayRevenue: { 
                    $sum: { 
                        $cond: [{ $gte: ['$createdAt', today] }, '$finalFare', 0] 
                    }
                }
            }}
        ]);

        // Pooling stats
        const totalPools = await Ride.countDocuments();
        const activePools = await Ride.countDocuments({ status: { $in: ['scheduled', 'ongoing'] } });

        // Aggregate pooling revenue (sum of all confirmed/completed passenger bookings)
        const poolRevenueStats = await Ride.aggregate([
            { $unwind: '$passengers' },
            { $match: { 'passengers.bookingStatus': { $in: ['confirmed', 'completed'] } } },
            { $group: {
                _id: null,
                totalRevenue: { $sum: { $multiply: ['$passengers.seatsBooked', '$pricePerSeat'] } },
                todayRevenue: {
                    $sum: {
                        $cond: [{ $gte: ['$createdAt', today] }, { $multiply: ['$passengers.seatsBooked', '$pricePerSeat'] }, 0]
                    }
                }
            }}
        ]);

        const totalRevenue = (revenueStats[0]?.totalRevenue || 0) + (poolRevenueStats[0]?.totalRevenue || 0);
        const totalCommission = 0; // 0% commission per user request
        const totalPayouts = totalRevenue; // 100% to drivers

        const stats = {
            totalPassengers,
            totalDrivers,
            activeDrivers,
            newRegistrationsToday,
            totalPools,
            activePools,
            dailyRevenue: (revenueStats[0]?.todayRevenue || 0) + (poolRevenueStats[0]?.todayRevenue || 0),
            totalRevenue,
            totalCommission,
            totalPayouts
        };

        res.json({ success: true, data: stats });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Get detailed financial overview
export const getFinancialOverview = async (req, res) => {
    try {
        const stats = await Booking.aggregate([
            { $match: { status: 'completed' } },
            { $group: {
                _id: null,
                totalCollection: { $sum: '$finalFare' },
                totalCommission: { $sum: 0 }, // 0% commission
                totalPayouts: { $sum: '$finalFare' }
            }}
        ]);

        // Aggregate pooling revenue similarly for financial overview
        const poolStats = await Ride.aggregate([
            { $unwind: '$passengers' },
            { $match: { 'passengers.bookingStatus': { $in: ['confirmed', 'completed'] } } },
            { $group: {
                _id: null,
                totalCollection: { $sum: { $multiply: ['$passengers.seatsBooked', '$pricePerSeat'] } }
            }}
        ]);

        const rideData = stats[0] || { totalCollection: 0, totalCommission: 0, totalPayouts: 0 };
        const poolData = poolStats[0] || { totalCollection: 0 };

        const totalCollection = rideData.totalCollection + poolData.totalCollection;
        const totalCommission = 0; // Standard 0% Commission
        const totalPayouts = totalCollection;
        
        res.json({ success: true, data: {
            totalCollection,
            totalCommission,
            totalPayouts,
            netProfit: totalCommission
        }});
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Get driver wallets for admin payouts page
export const getDriverWallets = async (req, res) => {
    try {
        const drivers = await User.find({ role: { $regex: /^driver$/i } }).select('name _id walletBalance driverDetails.earnings');
        console.log(`Admin fetching driver wallets, found: ${drivers.length}`);
        
        const wallets = drivers.map(d => ({
            driverId: d._id,
            driverName: d.name,
            balance: d.walletBalance || 0,
            totalEarned: d.driverDetails?.earnings || 0,
            commissionDue: 0 
        }));
        
        res.json({ success: true, count: wallets.length, data: wallets });
    } catch (error) {
        console.error('getDriverWallets error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Get passenger wallets for admin
export const getPassengerWallets = async (req, res) => {
    try {
        const passengers = await User.find({ role: { $regex: /^passenger$/i } }).select('name _id walletBalance phone');
        console.log(`Admin fetching passenger wallets, found: ${passengers.length}`);
        
        const wallets = passengers.map(p => ({
            passengerId: p._id,
            passengerName: p.name,
            phone: p.phone,
            balance: p.walletBalance || 0
        }));
        
        res.json({ success: true, count: wallets.length, data: wallets });
    } catch (error) {
        console.error('getPassengerWallets error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Get all pooling rides
export const getAllPools = async (req, res) => {
    try {
        const { type, status } = req.query;
        let query = {};

        if (type) query.type = type;
        if (status) query.status = status;

        const pools = await Ride.find(query)
            .populate('host', 'name email phone profileImage driverDetails')
            .populate('passengers.user', 'name email phone')
            .sort({ scheduledTime: -1 });

        res.json({ success: true, count: pools.length, data: pools });
    } catch (error) {
        console.error('getAllPools error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
// Get all ride bookings (on-demand)
export const getAllRides = async (req, res) => {
    try {
        const { status } = req.query;
        let query = {};

        if (status && status !== 'all') {
            query.status = status;
        }

        const rides = await Booking.find(query)
            .populate('passenger', 'name email phone profileImage')
            .populate('driver', 'name email phone profileImage driverDetails')
            .sort({ createdAt: -1 });

        res.json({ success: true, count: rides.length, data: rides });
    } catch (error) {
        console.error('getAllRides error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Get single ride details
export const getRideById = async (req, res) => {
    try {
        const { id } = req.params;
        const ride = await Booking.findById(id)
            .populate('passenger', 'name email phone profileImage verificationStatus')
            .populate('driver', 'name email phone profileImage driverDetails verificationStatus')
            .lean();

        if (!ride) {
            return res.status(404).json({ success: false, message: 'Ride not found' });
        }

        res.json({ success: true, data: ride });
    } catch (error) {
        console.error('getRideById error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Get single pool details
export const getPoolById = async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await Ride.findById(id)
            .populate('host', 'name email phone profileImage driverDetails verificationStatus')
            .populate('passengers.user', 'name email phone profileImage verificationStatus')
            .lean();

        if (!pool) {
            return res.status(404).json({ success: false, message: 'Pool not found' });
        }

        res.json({ success: true, data: pool });
    } catch (error) {
        console.error('getPoolById error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
// Get all wallet transactions for the admin feed
export const getAllTransactions = async (req, res) => {
    try {
        // Fetch all wallets and their transactions
        const wallets = await Wallet.find().populate('user', 'name phone role');
        
        let allTransactions = [];
        
        wallets.forEach(wallet => {
            if (wallet.user) {
                const userTransactions = wallet.transactions.map(tx => ({
                    ...tx.toObject(),
                    userName: wallet.user.name,
                    userRole: wallet.user.role,
                    userId: wallet.user._id,
                    walletId: wallet._id
                }));
                allTransactions = [...allTransactions, ...userTransactions];
            }
        });
        
        // Sort by timestamp descending
        allTransactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Return latest 100 for now
        res.json({ success: true, count: allTransactions.length, data: allTransactions.slice(0, 100) });
    } catch (error) {
        console.error('getAllTransactions error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Get ride history for a specific driver
export const getDriverRides = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.query;

        // 1. Fetch on-demand bookings
        let bookingQuery = { driver: id };
        if (status && status !== 'all') {
            bookingQuery.status = status;
        }

        const bookings = await Booking.find(bookingQuery)
            .populate('passenger', 'name phone email')
            .sort({ createdAt: -1 });

        // Transform bookings for consistent output
        const formattedBookings = bookings.map(b => ({
            id: b._id,
            passenger: b.passenger?.name || 'Unknown',
            driver: req.params.id, // for consistency if needed
            from: b.pickup?.address || 'N/A',
            to: b.dropoff?.address || 'N/A',
            date: new Date(b.createdAt).toISOString().split('T')[0],
            time: new Date(b.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            amount: b.finalFare || b.offeredFare || 0,
            status: b.status,
            type: 'on-demand'
        }));

        // 2. Fetch pooling rides (host)
        let poolQuery = { host: id };
        if (status && status !== 'all') {
            poolQuery.status = status;
        }
        
        const pools = await Ride.find(poolQuery).sort({ createdAt: -1 });
        
        // Transform pools for consistent output
        const formattedPools = pools.map(p => ({
            id: p._id,
            passenger: `${p.passengers.length} Bookings`,
            driver: req.params.id,
            from: p.origin?.name || 'N/A',
            to: p.destination?.name || 'N/A',
            date: new Date(p.scheduledTime).toISOString().split('T')[0],
            time: new Date(p.scheduledTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            amount: p.passengers.reduce((acc, curr) => acc + (curr.seatsBooked * p.pricePerSeat), 0),
            status: p.status,
            type: 'pooling'
        }));

        const allRides = [...formattedBookings, ...formattedPools].sort((a, b) => new Date(b.date + ' ' + b.time) - new Date(a.date + ' ' + a.time));

        res.json({ success: true, count: allRides.length, data: allRides });
    } catch (error) {
        console.error('getDriverRides error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Placeholder for refund actions (to be implemented with specific refund logic)
export const handleRefundAction = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body;
        
        res.json({ success: true, message: `Refund ${id} ${action}ed (Mocked)` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
// Get all withdrawal requests
export const getWithdrawals = async (req, res) => {
    try {
        const { status } = req.query;
        let query = {};
        if (status) query.status = status;

        const withdrawals = await Withdrawal.find(query)
            .populate('driver', 'name email phone walletBalance driverDetails.bankDetails')
            .sort({ createdAt: -1 });

        res.json({ success: true, count: withdrawals.length, data: withdrawals });
    } catch (error) {
        console.error('getWithdrawals error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// Update withdrawal status (Approve/Reject)
export const updateWithdrawalStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, remark, transactionId } = req.body; // 'approved', 'rejected', 'completed'

        const withdrawal = await Withdrawal.findById(id).populate('driver');
        if (!withdrawal) {
            return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
        }

        if (withdrawal.status === 'completed' || withdrawal.status === 'rejected') {
            return res.status(400).json({ success: false, message: 'Withdrawal already processed' });
        }

        withdrawal.status = status;
        if (remark) withdrawal.remark = remark;
        if (transactionId) withdrawal.transactionId = transactionId;

        const driver = await User.findById(withdrawal.driver._id);
        if (!driver) {
            return res.status(404).json({ success: false, message: 'Driver not found' });
        }

        // --- Handle Approval (Deduct Funds) ---
        if (status === 'approved' || status === 'completed') {
            // Check if we already deducted (To prevent double deduction if calling twice)
            if (withdrawal.processedAt) {
                 return res.status(400).json({ success: false, message: 'Withdrawal already processed and deducted' });
            }

            if (driver.walletBalance < withdrawal.amount) {
                // Should not happen with pending check, but good for safety
                return res.status(400).json({ success: false, message: `Insufficient driver balance (Current: ₹${driver.walletBalance})` });
            }

            driver.walletBalance -= withdrawal.amount;
            await driver.save();

            let wallet = await Wallet.findOne({ user: driver._id });
            if (!wallet) {
                wallet = await Wallet.create({ user: driver._id, balance: driver.walletBalance });
            }
            wallet.balance = driver.walletBalance;
            wallet.transactions.push({
                type: 'debit',
                amount: withdrawal.amount,
                description: `Withdrawal Settled: Request ID ${id.slice(-6).toUpperCase()}`,
                referenceId: id
            });
            await wallet.save();
            
            withdrawal.status = 'completed'; // Ensure final state is completed
            withdrawal.processedAt = new Date();
        }

        // --- Handle Rejection (No deduction needed now since we didn't deduct on request) ---
        // If we previously deducted on request, we would refund here. 
        // But in this new flow, rejection just means the balance stays as is.
        // If we wanted to "unlock" something, we would, but here the "Pending Check" in walletController 
        // will be cleared once this withdrawal is no longer 'pending'.

        await withdrawal.save();
        res.json({ success: true, message: `Withdrawal ${status} successfully and wallet updated`, data: withdrawal });
    } catch (error) {
        console.error('updateWithdrawalStatus error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
