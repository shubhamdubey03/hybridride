import User from '../Models/User.js';
import Booking from '../Models/Booking.js';
import Ride from '../Models/Ride.js';

// Get list of drivers (with filter for pending/verified)
export const getDrivers = async (req, res) => {
    try {
        console.log(`Admin ${req.user.email} fetching drivers...`);
        const { status } = req.query;
        let query = { role: 'driver' };

        if (status === 'pending') {
            query['driverApprovalStatus'] = 'pending';
        } else if (status === 'approved') {
            query['driverApprovalStatus'] = 'approved';
        } else if (status === 'rejected') {
            query['driverApprovalStatus'] = 'rejected';
        }

        const drivers = await User.find(query).select('-password');
        res.json({ success: true, data: drivers });
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
        if (!driver || driver.role !== 'driver') {
            return res.status(404).json({ success: false, message: 'Driver not found' });
        }

        if (action === 'approve') {
            driver.driverApprovalStatus = 'approved';
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
            driver.driverApprovalStatus = 'rejected';
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
        const passengers = await User.find({ role: 'passenger' }).select('-password');
        res.json({ success: true, data: passengers });
    } catch (error) {
        console.error(error);
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
        const totalPassengers = await User.countDocuments({ role: 'passenger' });
        const totalDrivers = await User.countDocuments({ role: 'driver' });
        const activeDrivers = await User.countDocuments({ role: 'driver', driverApprovalStatus: 'approved' });
        
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

        const stats = {
            totalPassengers,
            totalDrivers,
            activeDrivers,
            newRegistrationsToday,
            totalPools,
            activePools,
            dailyRevenue: (revenueStats[0]?.todayRevenue || 0) + (poolRevenueStats[0]?.todayRevenue || 0),
            totalRevenue: (revenueStats[0]?.totalRevenue || 0) + (poolRevenueStats[0]?.totalRevenue || 0)
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
                totalCommission: { $sum: { $multiply: ['$finalFare', 0.15] } }, // Assuming 15% flat commission for now
                totalPayouts: { $sum: { $multiply: ['$finalFare', 0.85] } }
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
        const totalCommission = (rideData.totalCollection * 0.15) + (poolData.totalCollection * 0.10); // Assuming 10% for pools
        const totalPayouts = totalCollection - totalCommission;
        
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
        const drivers = await User.find({ role: 'driver' }).select('name _id walletBalance driverDetails.earnings');
        
        const wallets = drivers.map(d => ({
            driverId: d._id,
            driverName: d.name,
            balance: d.walletBalance || 0,
            totalEarned: d.driverDetails?.earnings || 0,
            commissionDue: 0 // Mock for now, could be calculated based on bookings
        }));
        
        res.json({ success: true, count: wallets.length, data: wallets });
    } catch (error) {
        console.error('getDriverWallets error:', error);
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

// @desc    Admin upload driver documents
// @route   POST /api/admin/drivers/:id/upload
// @access  Private (Admin)
export const uploadDriverDocument = async (req, res) => {
    try {
        const { id } = req.params;
        const { docType } = req.body;

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const validDocTypes = ['licenseFront', 'licenseBack', 'registration', 'insurance', 'aadharFront', 'aadharBack', 'panCard', 'permit', 'fitness', 'rc', 'profileImage'];
        if (!docType || !validDocTypes.includes(docType)) {
            return res.status(400).json({ success: false, message: 'Invalid or missing docType' });
        }

        const filePath = `/uploads/${req.file.filename}`;

        let updateQuery = {};
        if (docType === 'profileImage') {
            updateQuery = { $set: { profileImage: filePath } };
        } else {
            const updateField = `driverDetails.documents.${docType}`;
            updateQuery = { $set: { [updateField]: filePath } };
        }

        const driver = await User.findByIdAndUpdate(
            id,
            updateQuery,
            { new: true }
        );

        if (!driver) {
            return res.status(404).json({ success: false, message: 'Driver not found' });
        }

        res.json({ success: true, message: `${docType} uploaded successfully`, data: driver });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
