import cloudinary from './Utils/cloudinary.js';

async function testCloudinary() {
    try {
        console.log("Testing Cloudinary connection...");
        const result = await cloudinary.api.ping();
        console.log("Cloudinary Ping Result:", result);
    } catch (error) {
        console.error("Cloudinary Connection Failed:", error);
    }
}

testCloudinary();
