import Withdrawal from '../Models/Withdrawal.js';
import User from '../Models/User.js';
import Wallet from '../Models/Wallet.js';

// @desc    Request withdrawal (Drivers only)
// @route   POST /api/wallet/withdraw
// @access  Private (Driver)
export const requestWithdrawal = async (req, res) => {
    try {
        const { amount, method, bankDetails } = req.body;
        const driverId = req.user._id;

        if (req.user.role !== 'driver') {
            return res.status(403).json({ success: false, message: "Only drivers can request withdrawals" });
        }

        const driver = await User.findById(driverId);
        if (driver.walletBalance < amount) {
            return res.status(400).json({ success: false, message: "Insufficient balance" });
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
            status: method === 'instant' ? 'completed' : 'pending' // Instant is auto-completed in this mock
        });

        // Deduct from driver balance (Net)
        driver.walletBalance -= amount;
        // Do NOT deduct from earnings (Gross) as it tracks total revenue
        await driver.save();

        // Log transaction in Wallet model
        let wallet = await Wallet.findOne({ user: driverId });
        if (!wallet) {
            wallet = await Wallet.create({ user: driverId, balance: driver.walletBalance });
        }
        
        wallet.balance = driver.walletBalance;
        wallet.transactions.push({
            type: 'debit',
            amount: amount,
            description: `Withdrawal (${method})${fee > 0 ? ' - 2% fee applied' : ''}`,
            referenceId: withdrawal._id
        });
        await wallet.save();

        res.status(200).json({
            success: true,
            message: method === 'instant' ? "Instant withdrawal successful (2% fee deducted)" : "Withdrawal request submitted",
            data: withdrawal,
            newBalance: driver.walletBalance
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
        const user = await User.findById(userId).select('walletBalance role');
        
        let wallet = await Wallet.findOne({ user: userId });
        if (!wallet) {
            wallet = await Wallet.create({ user: userId, balance: user.walletBalance || 0 });
        }

        res.status(200).json({
            success: true,
            balance: user.walletBalance,
            transactions: wallet.transactions.sort((a,b) => b.date - a.date)
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
