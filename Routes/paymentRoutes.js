import express from 'express';
import { createOrder, verifyPayment, createRidePaymentOrder, verifyRidePayment } from '../Controllers/paymentController.js';
import { protect } from '../Middleware/authMiddleware.js';

const router = express.Router();

router.post('/create-order', protect, createOrder);
router.post('/verify', protect, verifyPayment);

// Pool / Outstation / Rental — always Razorpay, no cash
router.post('/create-ride-order', protect, createRidePaymentOrder);
router.post('/verify-ride', protect, verifyRidePayment);

export default router;
