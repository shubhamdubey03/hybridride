import express from 'express';
import { protect, adminOnly } from '../Middleware/authMiddleware.js';
import { 
    getDrivers, 
    verifyDriver, 
    getPassengers, 
    toggleBlockStatus, 
    getPassengerRides, 
    getPassengerTransactions, 
    getDashboardStats, 
    getFinancialOverview, 
    getAllPools, 
    getAllRides, 
    getRideById, 
    getPoolById,
    getDriverWallets
} from '../Controllers/adminController.js';

const router = express.Router();

// All routes are protected and admin-only
router.use(protect, adminOnly);

router.get('/drivers', getDrivers);
router.get('/passengers', getPassengers);
router.put('/passengers/:id/block', toggleBlockStatus);
router.get('/passengers/:id/rides', getPassengerRides);
router.get('/passengers/:id/transactions', getPassengerTransactions);
router.put('/drivers/:id/verify', verifyDriver);
router.get('/dashboard-stats', getDashboardStats);
router.get('/financial-overview', getFinancialOverview);
router.get('/driver-wallets', getDriverWallets);
router.get('/pools', getAllPools);
router.get('/pools/:id', getPoolById);
router.get('/rides', getAllRides);
router.get('/rides/:id', getRideById);

export default router;
