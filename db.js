import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const connectDB = async () => {
    // Check if we already have a connection
    if (mongoose.connection.readyState >= 1) {
        return;
    }

    try {
        if (!process.env.MONGO_URI) {
            throw new Error('MONGO_URI is missing in environment variables');
        }

        console.log("DEBUG: Attempting to connect to MongoDB...");
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
        });
        console.log("✅ Mongodb connected");
    } catch (error) {
        console.error("❌ MongoDB Connection Error:", error.message);
        // Do not fail silently; this will help debug the "buffering timed out" issues
        throw error;
    }
}
export default connectDB;