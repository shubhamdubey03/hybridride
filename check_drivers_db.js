import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from './Models/User.js';

dotenv.config();

const checkDrivers = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const drivers = await User.find({ role: 'driver' });
        console.log(`Found ${drivers.length} drivers`);

        drivers.forEach(d => {
            console.log(`- ID: ${d._id}, Name: ${d.name}, Role: ${d.role}, Status: ${d.driverApprovalStatus}, Trusted: ${d.verificationStatus?.communityTrusted}`);
        });

        const allUsers = await User.find({});
        console.log(`Total users in DB: ${allUsers.length}`);
        
        const possibleDrivers = allUsers.filter(u => u.name && (u.role === 'driver' || u.driverDetails));
        console.log(`Possible drivers (role=driver OR has driverDetails): ${possibleDrivers.length}`);
        possibleDrivers.forEach(d => {
            if (d.role !== 'driver') {
                console.log(`! WARNING: User ${d.name} has driverDetails but role is ${d.role}`);
            }
        });

        await mongoose.disconnect();
    } catch (error) {
        console.error('Error:', error);
    }
};

checkDrivers();
