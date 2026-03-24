import cloudinary from './Utils/cloudinary.js';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

async function testStorage() {
    try {
        console.log("Testing storage directly...");
        const storage = new CloudinaryStorage({
            cloudinary: cloudinary,
            params: {
                folder: 'test_folder',
                allowed_formats: ['jpg', 'png'],
            },
        });

        const req = { user: { _id: 'test_user' } };
        const file = { originalname: 'test.jpg' };
        
        // This is a bit tricky to call manually as Multer usually calls it.
        // But some versions of CloudinaryStorage have an internal _handleFile or similar.
        console.log("Storage check passed (instantiation).");
    } catch (error) {
        console.error("Storage Test Failed:", error);
    }
}

testStorage();
