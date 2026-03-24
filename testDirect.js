import cloudinary from './Utils/cloudinary.js';

async function testDirectUpload() {
    try {
        console.log("Testing direct Cloudinary upload...");
        // Assuming there's a test.jpg in the backend folder or it's a URL
        const result = await cloudinary.uploader.upload("https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png", {
            folder: 'test_uploads',
            public_id: `test-upload-${Date.now()}`,
        });
        console.log("Direct Upload Success:", result.secure_url);
    } catch (error) {
        console.error("Direct Upload Failed:", error);
    }
}

testDirectUpload();
