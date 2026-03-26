import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './Models/User.js';

dotenv.config();

const checkAdmin = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const admin = await User.findOne({ email: 'admin@hybridride.com' });
        if (admin) {
            console.log('Admin found:', admin._id, admin.role);
        } else {
            console.log('Admin NOT found with email admin@hybridride.com');
            const allAdmins = await User.find({ role: 'admin' });
            console.log('All admins in DB:', allAdmins.map(a => ({ id: a._id, email: a.email })));
        }

        await mongoose.connection.close();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

checkAdmin();
