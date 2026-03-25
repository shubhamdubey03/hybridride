import User from '../Models/User.js';

// @desc    Get driver profile (with driverDetails)
// @route   GET /api/driver/profile
// @access  Private (Driver)
export const getDriverProfile = async (req, res) => {
    try {
        // req.user is set by auth middleware
        const user = await User.findById(req.user._id).select('-password');
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, data: user });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// @desc    Update driver details (Vehicle, License, etc.)
// @route   PUT /api/driver/profile
// @access  Private (Driver)
export const updateDriverProfile = async (req, res) => {
    try {
        const { name, phone, email, vehicle, licenseNumber, documents } = req.body || {};
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Update Basic Info
        if (name) user.name = name;
        if (phone) user.phone = phone;
        if (email) user.email = email;

        // Update driverDetails fields if provided
        if (licenseNumber) user.driverDetails.licenseNumber = licenseNumber;
        
        // Handle boolean isOnline separately
        if (typeof req.body.isOnline !== 'undefined') {
            user.driverDetails.isOnline = req.body.isOnline;
        }

        if (vehicle) {
            user.driverDetails.vehicle = { 
                ...user.driverDetails.vehicle, 
                ...vehicle 
            };
        }

        if (documents) {
            user.driverDetails.documents = {
                ...user.driverDetails.documents,
                ...documents
            };
        }

        await user.save();

        res.json({ success: true, message: 'Driver profile updated', data: user });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// @desc    Toggle Online/Offline status
// @route   POST /api/driver/status
// @access  Private (Driver)
export const toggleOnline = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const { isOnline } = req.body || {}; // Expect boolean

        if (isOnline !== undefined) {
             user.driverDetails.isOnline = isOnline;
        } else {
             // Toggle if not specified
             user.driverDetails.isOnline = !user.driverDetails.isOnline;
        }

        await user.save();
        
        res.json({ 
            success: true, 
            message: `You are now ${user.driverDetails.isOnline ? 'Online' : 'Offline'}`, 
            data: { isOnline: user.driverDetails.isOnline } 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};


// @desc    Handle Document Upload
// @route   POST /api/driver/upload
// @access  Private
export const uploadDocument = async (req, res) => {
    try {
        console.log("DEBUG: Upload Request Body:", req.body);
        console.log("DEBUG: Upload File:", req.file);
        
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const { docType } = req.body;
        const isDriver = req.user.role === 'driver';
        const validDocTypes = ['licenseFront', 'licenseBack', 'registration', 'insurance', 'aadharFront', 'aadharBack', 'panCard', 'permit', 'fitness', 'rc', 'profileImage'];

        if (!docType || !validDocTypes.includes(docType)) {
             return res.status(400).json({ success: false, message: 'Invalid or missing docType' });
        }

        // Security: Non-drivers can ONLY upload profileImage
        if (!isDriver && docType !== 'profileImage') {
            return res.status(403).json({ success: false, message: 'Passengers can only upload profile images' });
        }
        
        // Return the path - Cloudinary provides the full URL in req.file.path
        const filePath = req.file.path || `/uploads/${req.file.filename}`;
        
        let updateQuery = {};
        if (docType === 'profileImage') {
            updateQuery = { $set: { profileImage: filePath } };
        } else {
            const updateField = `driverDetails.documents.${docType}`;
            updateQuery = { 
                $set: { 
                    [updateField]: filePath,
                    driverApprovalStatus: 'pending' // Reset to pending for admin review
                } 
            };
        }
        
        const user = await User.findByIdAndUpdate(
            req.user._id,
            updateQuery,
            { new: true, runValidators: true }
        );

        res.json({ success: true, message: 'File uploaded and saved', filePath, docType });
    } catch (error) {
         console.error("UPLOAD ERROR:", error);
         res.status(500).json({ success: false, message: 'Upload Failed', error: error.message });
    }
};

// @desc    Get all online drivers
// @route   GET /api/driver/online
// @access  Private
export const getOnlineDrivers = async (req, res) => {
    try {
        const drivers = await User.find({
            role: 'driver',
            'driverDetails.isOnline': true
        }).select('-password');
        
        res.json({ success: true, data: drivers });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// @desc    Get dynamic earnings for the driver
// @route   GET /api/driver/earnings
// @access  Private (Driver)
import Booking from '../Models/Booking.js';

export const getEarnings = async (req, res) => {
    try {
        const driverId = req.user._id;

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        const startOfWeek = new Date(startOfToday); 
        startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
        
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const bookings = await Booking.find({
            driver: driverId,
            status: 'completed'
        });

        let today = 0;
        let week = 0;
        let month = 0;
        let total = 0;

        bookings.forEach(b => {
            const date = new Date(b.completedAt || b.createdAt);
            const amount = b.finalFare || 0;
            total += amount;

            if (date >= startOfToday) today += amount;
            if (date >= startOfWeek) week += amount;
            if (date >= startOfMonth) month += amount;
        });

        res.json({
            success: true,
            data: { today, week, month, total, currentBalance: total } // Keeping naming compatible with frontend wallet if needed
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error fetching earnings' });
    }
};
