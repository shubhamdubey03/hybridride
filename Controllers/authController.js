import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import User from '../Models/User.js';

const googleClient = new OAuth2Client('110831328035-bqft18nqtfk06o3qrc78d414s731m8b5.apps.googleusercontent.com');

// ─── Helper ────────────────────────────────────────────────────
const generateToken = (id) =>
    jwt.sign({ id }, process.env.JWT_SECRET || 'secret123', { expiresIn: '30d' });

const sendSuccess = (res, statusCode, message, data = {}) =>
    res.status(statusCode).json({ success: true, message, data });

const sendError = (res, statusCode, message) =>
    res.status(statusCode).json({ success: false, message });

// ─── @route  POST /api/auth/register ────────────────────────────
// @desc   Register as passenger or driver
// @access Public
export const register = async (req, res) => {
    try {
        const { name, email, phone, password, role } = req.body;

        if (!name || !email || !phone || !password) {
            return sendError(res, 400, 'Please provide name, email, phone and password');
        }

        const userExists = await User.findOne({ $or: [{ email }, { phone }] });
        if (userExists) {
            return sendError(res, 409, 'User with this email or phone already exists');
        }

        const hashedPassword = await bcrypt.hash(req.body.googleIdToken ? req.body.googleIdToken + (process.env.JWT_SECRET || 'secret') : password, 10);

        let driverDetailsData = undefined;
        if (role === 'driver') {
            let vehicleData = req.body.vehicle;

            // Fallback: Check if nested in driverDetails (common confusion)
            if (!vehicleData && req.body.driverDetails && req.body.driverDetails.vehicle) {
                vehicleData = req.body.driverDetails.vehicle;
            }

            // Fallback: parsing if string
            if (typeof vehicleData === 'string') {
                try {
                    console.log("DEBUG: vehicle data is string, parsing...");
                    vehicleData = JSON.parse(vehicleData);
                } catch (e) {
                    console.error("DEBUG: Failed to parse vehicle string:", e);
                }
            }

            if (vehicleData) {
                // Explicitly valid fields to prevent stripping
                driverDetailsData = {
                    vehicle: {
                        make: vehicleData.make,
                        model: vehicleData.model,
                        year: vehicleData.year,
                        plateNumber: vehicleData.plateNumber,
                        color: vehicleData.color,
                        fuelType: vehicleData.fuelType || 'Petrol',
                        seatingCapacity: Number(vehicleData.seatingCapacity) || 4,
                        bootSpace: vehicleData.bootSpace
                    },
                    licenseNumber: req.body.licenseNumber
                };
            } else {
                console.warn("Vehicle data not found in request body.");
            }
        }

        const user = new User({
            name,
            email,
            phone,
            password: hashedPassword,
            role: role || 'passenger',
            profileImage: req.body.profileImage || '',
            driverDetails: driverDetailsData,
            verificationStatus: {
                email: req.body.googleIdToken ? true : false,
                phone: false,
                idCard: false,
                communityTrusted: false
            }
        });

        const savedUser = await user.save();

        const token = generateToken(savedUser._id);
        const userData = savedUser.toObject();
        delete userData.password;

        return sendSuccess(res, 201, 'Registration successful', {
            ...userData,
            token,
        });
    } catch (error) {
        console.error('Register error:', error);
        return sendError(
            res,
            500,
            process.env.NODE_ENV === 'development'
                ? `Registration failed: ${error.message}`
                : 'Server error during registration'
        );
    }
};

// ─── @route  POST /api/auth/login ───────────────────────────────
// @desc   Login with email/phone + password
// @access Public
export const login = async (req, res) => {
    try {
        const { email, phone, password } = req.body;

        if (!password || (!email && !phone)) {
            return sendError(res, 400, 'Please provide (email or phone) and password');
        }

        const query = email ? { email } : { phone };
        const user = await User.findOne(query);

        if (!user) {
            return sendError(res, 401, 'Invalid credentials');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return sendError(res, 401, 'Invalid credentials');
        }

        const token = generateToken(user._id);
        const userData = user.toObject();
        delete userData.password;

        return sendSuccess(res, 200, 'Login successful', {
            ...userData,
            token,
        });
    } catch (error) {
        console.error('Login error:', error);
        return sendError(res, 500, `Login failed: ${error.message}`);
    }
};

// ─── @route  POST /api/auth/google ───────────────────────────────
// @desc   Login or Register with Google Sign-In
// @access Public
export const googleLogin = async (req, res) => {
    try {
        const { idToken, role } = req.body;

        if (!idToken) {
            return sendError(res, 400, 'Please provide idToken');
        }

        const ticket = await googleClient.verifyIdToken({
            idToken,
            audience: '110831328035-bqft18nqtfk06o3qrc78d414s731m8b5.apps.googleusercontent.com',
        });
        const payload = ticket.getPayload();

        if (!payload || !payload.email) {
            return sendError(res, 400, 'Invalid Google Token');
        }

        const { email, name, picture } = payload;

        let user = await User.findOne({ email });

        if (!user) {
            // User does not exist in our database.
            // Return 404 with Google payload so frontend can route to Profile Setup.
            return res.status(404).json({
                success: false,
                isRegistered: false,
                message: 'User not registered',
                googleData: {
                    email,
                    name: name || 'Google User',
                    picture,
                    idToken
                }
            });
        }

        const token = generateToken(user._id);
        const userData = user.toObject();
        delete userData.password;

        return sendSuccess(res, 200, 'Google Login successful', {
            ...userData,
            token,
        });

    } catch (error) {
        console.error('Google login error:', error);
        return sendError(res, 500, `Google Login failed: ${error.message}`);
    }
};

// ─── @route  GET /api/auth/me ────────────────────────────────────
// @desc   Get logged-in user's profile
// @access Private
export const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password');
        return sendSuccess(res, 200, 'Profile fetched', user);
    } catch (error) {
        console.error('GetMe error:', error);
        return sendError(res, 500, 'Server error fetching profile');
    }
};
