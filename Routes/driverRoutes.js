
import express from 'express';
import { protect, driverOnly } from '../Middleware/authMiddleware.js';
import upload from '../Utils/multer.js';
import { 
    getDriverProfile, 
    updateDriverProfile, 
    toggleOnline,
    uploadDocument,
    getOnlineDrivers,
    getEarnings
} from '../Controllers/driverController.js';

const router = express.Router();

// Unified upload handling moved to Utils/multer.js


// Routes
router.get('/profile', protect, driverOnly, getDriverProfile);
router.put('/profile', protect, driverOnly, updateDriverProfile);
router.post('/status', protect, driverOnly, toggleOnline);
router.get('/online', protect, getOnlineDrivers);
router.get('/earnings', protect, driverOnly, getEarnings);

// Upload Route with Error Handling - Accessible by all roles for profile images
router.post('/upload', protect, upload.single('document'), uploadDocument);

export default router;
