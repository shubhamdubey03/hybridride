import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './db.js';

// ─── Routes ────────────────────────────────────────────────────
import authRoutes from './Routes/authRoutes.js';
import driverRoutes from './Routes/driverRoutes.js';
import adminRoutes from './Routes/adminRoutes.js';
import bookingRoutes from './Routes/bookingRoutes.js';
import poolRoutes from './Routes/poolRoutes.js';
import paymentRoutes from './Routes/paymentRoutes.js';
import walletRoutes from './Routes/walletRoutes.js';

dotenv.config();

const app = express();

// ─── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── DB ────────────────────────────────────────────────────────
connectDB();

// ─── API Routes ────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({ success: true, message: 'HybridRide API is running 🚗' });
});

// ─── Network Test Route ────────────────────────────────────────
app.get('/test', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Network connection successful! 🚀',
        ip: req.ip,
        time: new Date().toISOString()
    });
});

app.get('/version', (req, res) => {
    res.json({ version: '1.0.2', deployedAt: '2026-04-08 19:25' });
});


// ─── API Routes ────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/pools', poolRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/uploads', express.static('uploads'));

// ─── 404 handler ──────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// ─── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('GLOBAL ERROR CATCH:', err);
    res.status(500).json({ success: false, message: 'Internal server error', error: err.message || err });
});

// ─── Start Config for Vercel & Local ───────────────────────────
const PORT = process.env.PORT || 5000;

// Vercel sets an environment variable, so we only use app.listen if we're not on Vercel
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));
}

// Export the app for Vercel Serverless Function
export default app;
