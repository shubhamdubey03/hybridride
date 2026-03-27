import Withdrawal from '../Models/Withdrawal.js';
import User from '../Models/User.js';
import Wallet from '../Models/Wallet.js';

// @desc    Request withdrawal (Drivers only)
// @route   POST /api/wallet/withdraw
// @access  Private (Driver)
export const requestWithdrawal = async (req, res) => {
    try {
        let { amount, method, bankDetails } = req.body;
        const driverId = req.user._id;

        const driver = await User.findById(driverId);

        // Fallback to profile bank details if not provided
        if (!bankDetails && driver.driverDetails?.bankDetails?.accountNumber) {
            bankDetails = driver.driverDetails.bankDetails;
        }

        if (!bankDetails) {
            return res.status(400).json({ success: false, message: "Please provide bank details in your profile first" });
        }

        // Check for existing pending withdrawal
        const existingPending = await Withdrawal.findOne({ driver: driverId, status: 'pending' });
        if (existingPending) {
            return res.status(400).json({ success: false, message: "You already have a pending withdrawal request. Please wait for admin approval." });
        }

        if (driver.walletBalance < amount || amount < 100) {
            return res.status(400).json({ success: false, message: amount < 100 ? "Minimum withdrawal is ₹100" : "Insufficient balance" });
        }

        let fee = 0;
        if (method === 'instant') {
            fee = amount * 0.02; // 2% fee
        }

        const netAmount = amount - fee;

        const withdrawal = await Withdrawal.create({
            driver: driverId,
            amount,
            fee,
            netAmount,
            method,
            bankDetails,
            status: 'pending' 
        });

        // NOTE: We no longer deduct on request. 
        // Logic moved to adminController.js during approval phase as requested by user.

        res.status(200).json({
            success: true,
            message: "Withdrawal request submitted successfully. Balance will be deducted once admin approves.",
            data: withdrawal,
            newBalance: driver.walletBalance // Still the same
        });

    } catch (error) {
        console.error("Withdrawal Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get wallet stats and history
// @route   GET /api/wallet/my-wallet
// @access  Private
export const getMyWallet = async (req, res) => {
    try {
        const userId = req.user._id;
        let user = await User.findById(userId);
        
        // Removed Lazy Sync as it was refilling wallets incorrectly after withdrawal requests.
        // Balances are now strictly updated via ride completion or admin approval.
        
        const hasPending = await Withdrawal.findOne({ driver: userId, status: 'pending' });
        
        let wallet = await Wallet.findOne({ user: userId });
        if (!wallet) {
            wallet = await Wallet.create({ user: userId, balance: user.walletBalance || 0 });
        }

        res.status(200).json({
            success: true,
            balance: user.walletBalance,
            hasPending: !!hasPending,
            transactions: wallet.transactions.sort((a,b) => b.timestamp - a.timestamp)
        });
    } catch (error) {
        console.error("Get Wallet Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Admin: Get all withdrawal requests
// @route   GET /api/wallet/admin/withdrawals
// @access  Private (Admin)
export const getAllWithdrawals = async (req, res) => {
    try {
        const withdrawals = await Withdrawal.find()
            .populate('driver', 'name email phone driverDetails.bankDetails')
            .sort({ createdAt: -1 });
            
        res.status(200).json({ success: true, data: withdrawals });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
