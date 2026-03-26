import express from 'express';
import { requestWithdrawal, getMyWallet, getAllWithdrawals } from '../Controllers/walletController.js';
import { protect, adminProtect } from '../Middleware/authMiddleware.js';

const router = express.Router();

router.post('/withdraw', protect, requestWithdrawal);
router.get('/my-wallet', protect, getMyWallet);
router.get('/admin/withdrawals', protect, adminProtect, getAllWithdrawals);

export default router;
