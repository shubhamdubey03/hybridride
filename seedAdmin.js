import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import User from './Models/User.js';
import connectDB from './db.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const seedAdmin = async () => {
    await connectDB();

    const adminEmail = 'admin@hybridride.com';
    const adminPassword = 'admin123';
    const adminPhone = '+10000000000';

    const userExists = await User.findOne({ email: adminEmail });

    if (userExists) {
        console.log('Admin user already exists');
        process.exit();
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);

    const adminUser = await User.create({
        name: 'Super Admin',
        email: adminEmail,
        password: hashedPassword,
        phone: adminPhone,
        role: 'admin',
        verificationStatus: {
            email: true,
            phone: true,
            idCard: true,
            communityTrusted: true
        }
    });

    console.log(`Admin created: ${adminUser.email} / ${adminPassword}`);
    process.exit();
};

seedAdmin();
