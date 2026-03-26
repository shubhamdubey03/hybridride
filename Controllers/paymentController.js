import Razorpay from "razorpay";
import crypto from "crypto";
import User from "../Models/User.js";
import Wallet from "../Models/Wallet.js";
import dotenv from "dotenv";

dotenv.config();

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// @desc    Create a razorpay order for wallet topup
// @route   POST /api/payments/create-order
// @access  Private
export const createOrder = async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount) return res.status(400).json({ success: false, message: "Amount is required" });

        const options = {
            amount: Math.round(amount * 100), // Razorpay operates in youngest currency unit (paise)
            currency: "INR",
            receipt: `receipt_order_${Date.now()}`,
        };

        const order = await razorpay.orders.create(options);

        if (!order) {
            return res.status(500).json({ success: false, message: "Some error occured creating order" });
        }

        res.status(200).json({ success: true, order });
    } catch (error) {
        console.error("Payment Order Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Validate payment and add to wallet
// @route   POST /api/payments/verify
// @access  Private
export const verifyPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;
        const userId = req.user._id;

        // Verify signature
        const sha = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
        sha.update(`${razorpay_order_id}|${razorpay_payment_id}`);
        const digest = sha.digest("hex");

        if (digest !== razorpay_signature) {
            return res.status(400).json({ success: false, message: "Transaction is not legit!" });
        }

        // Add funds to user wallet
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        user.walletBalance = (user.walletBalance || 0) + amount;
        
        // Quick workaround for driver earnings, keeping both balanced
        if (user.role === 'driver') {
             user.driverDetails.earnings = (user.driverDetails.earnings || 0) + amount;
        }
        
        await user.save();

        // Log transaction in Wallet model
        let wallet = await Wallet.findOne({ user: userId });
        if (!wallet) {
            wallet = await Wallet.create({ user: userId, balance: user.walletBalance });
        }
        
        wallet.balance = user.walletBalance;
        wallet.transactions.push({
            type: 'credit',
            amount: amount,
            description: 'Wallet Top-up via Razorpay',
            referenceId: razorpay_payment_id
        });
        await wallet.save();

        res.status(200).json({
            success: true,
            message: "Payment successfully verified and wallet updated",
            walletBalance: user.walletBalance,
        });
    } catch (error) {
        console.error("Payment Verification Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
