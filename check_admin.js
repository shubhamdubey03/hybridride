import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './Models/User.js';
import connectDB from './db.js';

dotenv.config();

const checkUser = async () => {
    await connectDB();
    const user = await User.findOne({ email: 'admin@hybridride.com' });
    if (user) {
        console.log('User found:');
        console.log('Email:', user.email);
        console.log('Role:', user.role);
    } else {
        console.log('User not found');
    }
    process.exit();
};

checkUser();
