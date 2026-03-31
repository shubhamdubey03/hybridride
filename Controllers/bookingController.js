import Booking from '../Models/Booking.js';
import User from '../Models/User.js';
import Message from '../Models/Message.js';
import Wallet from '../Models/Wallet.js';

// ─────────────────────────────────────────────────────────
// Helper: Calculate a basic fare estimate
// Formula: base + (distanceKm * perKmRate) + (durationMins * perMinRate)
// ─────────────────────────────────────────────────────────
const estimateFare = (distanceKm, durationMins, vehicleType = 'CAR') => {
    const rates = {
        CAR:  { base: 50, perKm: 12, perMin: 1.5 },
        AUTO: { base: 30, perKm: 9,  perMin: 1.0 },
        BIKE: { base: 20, perKm: 6,  perMin: 0.8 },
    };
    const r = rates[vehicleType] || rates.CAR;
    return Math.round(r.base + distanceKm * r.perKm + durationMins * r.perMin);
};

// ─── 1. POST /api/bookings/request ─────────────────────────
// Passenger requests a ride
// @access Private (Passenger)
export const requestRide = async (req, res) => {
    try {
        let {
            pickupAddress, pickupCoords,
            dropoffAddress, dropoffCoords,
            rideType, vehicleType, seats,
            distanceKm, durationMins,
            offeredFare, paymentMethod
        } = req.body || {};

        // Robust Mapping: Convert frontend types to backend enums
        if (rideType === 'INSTANT') rideType = 'city';
        if (rideType === 'POOLING') rideType = 'pool';
        
        const v = String(vehicleType || '').toUpperCase();
        if (v.includes('CAR')) vehicleType = 'CAR';
        else if (v.includes('AUTO')) vehicleType = 'AUTO';
        else if (v.includes('BIKE')) vehicleType = 'BIKE';
        else if (vehicleType) vehicleType = 'CAR'; // Case-insensitive CAR fallback

        if (!pickupAddress || !pickupCoords || !dropoffAddress || !dropoffCoords) {
            return res.status(400).json({ success: false, message: 'Pickup and dropoff details are required' });
        }

        // Block if passenger already has an active ride
        const existingActive = await Booking.findOne({
            passenger: req.user._id,
            status: { $in: ['pending', 'accepted', 'arrived', 'ongoing'] }
        });
        if (existingActive) {
            return res.status(409).json({ success: false, message: 'You already have an active ride', data: { bookingId: existingActive._id } });
        }

        // ─── Vehicle Eligibility by Distance ─────────────────────────────────
        // Bikes and Autos are city-only vehicles (≤100 km).
        // For distances > 100 km, only CAR is permitted — just like Rapido/Ola/Uber.
        const tripDistanceKm = distanceKm || 0;
        if ((vehicleType === 'BIKE' || vehicleType === 'AUTO') && tripDistanceKm > 100) {
            const vehicleLabel = vehicleType === 'BIKE' ? 'Bikes' : 'Autos';
            return res.status(400).json({
                success: false,
                message: `${vehicleLabel} are not available for trips over 100 km. Please select a Car for long-distance rides.`
            });
        }
        // ─────────────────────────────────────────────────────────────────────

        // For city rides, use the base calculation.
        // For outstation/rental, trust the offeredFare from the frontend (which is based on driver's per/km rate)
        let estFare;
        if (rideType === 'city') {
            estFare = estimateFare(distanceKm || 5, durationMins || 15, vehicleType);
        } else {
            estFare = offeredFare || estimateFare(distanceKm || 5, durationMins || 15, vehicleType);
        }

        const finalCalculatedFare = offeredFare || estFare;

        // ─── Wallet balance check ───────────────────────────────────────────────────────────────────────
        // All rides are wallet-only. Cash is not accepted on HybridRide.
        // Check balance BEFORE creating the booking to prevent negative wallets.
        const requiredAmount = offeredFare || estFare;
        const passenger = await User.findById(req.user._id).select('walletBalance');
        if ((passenger?.walletBalance || 0) < requiredAmount) {
            return res.status(402).json({
                success: false,
                message: `Insufficient wallet balance. You need ₹${requiredAmount} but have ₹${passenger?.walletBalance || 0}. Please top up your wallet.`
            });
        }
        // ──────────────────────────────────────────────────────────────────────────────

        const booking = await Booking.create({
            passenger:     req.user._id,
            pickup:        { address: pickupAddress,  coordinates: pickupCoords  },
            dropoff:       { address: dropoffAddress, coordinates: dropoffCoords },
            rideType:      rideType     || 'city',
            vehicleType:   vehicleType  || 'CAR',
            seats:         seats        || 1,
            distanceKm:    distanceKm   || 0,
            durationMins:  durationMins || 0,
            estimatedFare: estFare,
            offeredFare:   offeredFare  || estFare,
            finalFare:     finalCalculatedFare,
            paymentMethod: 'wallet', // Always wallet — cash not accepted
        });

        return res.status(201).json({ success: true, message: 'Ride requested successfully', data: booking });

    } catch (error) {
        console.error('requestRide error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to request ride',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

// ─── 2. GET /api/bookings/nearby ───────────────────────────
// Driver sees only pending ride requests that match THEIR vehicle type.
// A bike driver sees BIKE bookings only, a car driver sees CAR bookings only.
// @access Private (Driver)
export const getNearbyRides = async (req, res) => {
    try {
        // Load the driver's full profile to get their registered vehicle type
        const driver = await User.findById(req.user._id).select('driverDetails');
        const driverVehicleType = driver?.driverDetails?.vehicle?.type?.toUpperCase();

        if (!driverVehicleType) {
            return res.status(400).json({
                success: false,
                message: 'Your vehicle type is not set. Please complete your driver profile.'
            });
        }

        // ─── Strict vehicle-type matching ─────────────────────────────────────
        // Only show bookings that match THIS driver's vehicle type.
        // Passengers who chose Car → only car drivers see the request.
        // Passengers who chose Bike → only bike drivers see the request.
        // Passengers who chose Auto → only auto drivers see the request.
        const query = {
            status: 'pending',
            driver: null,
            vehicleType: driverVehicleType  // ← enforced from driver's own profile
        };
        // ──────────────────────────────────────────────────────────────────────

        const rides = await Booking
            .find(query)
            .populate('passenger', 'name phone profileImage ridePersonality')
            .sort({ createdAt: -1 })
            .limit(20);

        // Obfuscate dropoffs for pending rides
        const obfuscatedRides = rides.map(b => {
            const obj = b.toObject();
            if (!['ongoing', 'completed'].includes(obj.status)) {
                obj.dropoff = {
                    address: "Hidden until OTP",
                    coordinates: [0, 0]
                };
            }
            return obj;
        });

        return res.json({ success: true, data: obfuscatedRides });
    } catch (error) {
        console.error('getNearbyRides error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch rides' });
    }
};

// ─── 3. POST /api/bookings/:id/accept ──────────────────────
// Driver accepts a ride request
// @access Private (Driver)
export const acceptRide = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);

        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
        if (booking.status !== 'pending') {
            return res.status(409).json({ success: false, message: `Cannot accept. Ride is already ${booking.status}` });
        }

        // ─── Vehicle type enforcement ──────────────────────────────────────────
        // The driver's registered vehicle must match the passenger's chosen vehicle.
        // This is the server-side guard — the frontend already filters,
        // but this ensures no driver can accept a mismatched booking.
        const driver = await User.findById(req.user._id).select('driverDetails');
        const driverVehicleType = driver?.driverDetails?.vehicle?.type?.toUpperCase();
        const bookingVehicleType = booking.vehicleType?.toUpperCase();

        if (driverVehicleType && bookingVehicleType && driverVehicleType !== bookingVehicleType) {
            return res.status(403).json({
                success: false,
                message: `Vehicle mismatch. This ride requires a ${bookingVehicleType} but your registered vehicle is a ${driverVehicleType}.`
            });
        }
        // ──────────────────────────────────────────────────────────────────────

        // Make sure driver doesn't have another active ride
        const driverBusy = await Booking.findOne({
            driver: req.user._id,
            status: { $in: ['accepted', 'arrived', 'ongoing'] }
        });
        if (driverBusy) {
            return res.status(409).json({ success: false, message: 'You already have an active ride' });
        }

        booking.driver     = req.user._id;
        booking.status     = 'accepted';
        booking.acceptedAt = new Date();
        // Generate a 4-digit OTP for the ride
        booking.otp = Math.floor(1000 + Math.random() * 9000).toString();
        await booking.save();

        const populated = await booking.populate([
            { path: 'passenger', select: 'name phone profileImage' },
            { path: 'driver',    select: 'name phone profileImage driverDetails' },
        ]);

        return res.json({ success: true, message: 'Ride accepted', data: populated });
    } catch (error) {
        console.error('acceptRide error:', error);
        return res.status(500).json({ success: false, message: 'Failed to accept ride' });
    }
};

// ─── 4. PUT /api/bookings/:id/status ───────────────────────
// Update ride status: arrived → ongoing → completed or cancelled
// @access Private (Driver or Passenger)
export const updateRideStatus = async (req, res) => {
    try {
        const { status, cancellationReason, otp } = req.body || {};

        const VALID_TRANSITIONS = {
            driver: {
                pending: ['cancelled'],
                accepted: ['arrived', 'cancelled'],
                arrived: ['ongoing', 'cancelled'],
                ongoing: ['completed', 'cancelled']
            },
            passenger: { 
                pending: ['cancelled'],
                accepted: ['cancelled'],
                arrived: ['cancelled'],
                ongoing: [], // Cannot cancel once started (OTP entered)
                completed: ['completed']
            },
        };

        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

        // Determine caller role
        const isDriver    = booking.driver    && booking.driver.toString()    === req.user._id.toString();
        const isPassenger = booking.passenger && booking.passenger.toString() === req.user._id.toString();

        if (!isDriver && !isPassenger) {
            return res.status(403).json({ success: false, message: 'Not authorized to update this ride' });
        }

        const role = isDriver ? 'driver' : 'passenger';
        const allowed = VALID_TRANSITIONS[role][booking.status] || [];
        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, message: `Cannot move from '${booking.status}' to '${status}' as ${role}` });
        }

        if (status === 'completed' && isDriver) {
            if (booking.status !== 'ongoing') {
                return res.status(400).json({ success: false, message: 'Trip must be ongoing before it can be completed' });
            }
        }
        
        // Apply status and relevant timestamp
        booking.status = status;
        const now = new Date();
        if (status === 'arrived')    booking.arrivedAt   = now;
        if (status === 'ongoing') {
            // Require OTP if the driver is starting the ride
            if (isDriver) {
                if (!otp || otp !== booking.otp) {
                    return res.status(400).json({ success: false, message: 'Invalid OTP. Please enter the correct 4-digit code.' });
                }
            }
            booking.startedAt = now;
        }
        if (status === 'completed') {
            if (booking.status !== 'completed') {
                booking.completedAt = now;
            }
            
            // CRITICAL FIX: Only set paymentStatus to completed if the PASSENGER is the one updating
            // This ensures the ride remains "active" for the passenger until they finish the payment screen.
            if (isPassenger) {
                booking.paymentStatus = 'completed';
            }

            // Deduct from passenger wallet (mandatory for all rides now)
            const passenger = await User.findById(booking.passenger);
            if (passenger) {
                const totalAmount = booking.finalFare || booking.offeredFare || 0;
                passenger.walletBalance -= totalAmount;
                await passenger.save();

                let passengerWallet = await Wallet.findOne({ user: booking.passenger });
                if (!passengerWallet) {
                    passengerWallet = await Wallet.create({ user: booking.passenger, balance: passenger.walletBalance });
                }
                passengerWallet.balance = passenger.walletBalance;
                passengerWallet.transactions.push({
                    type: 'debit',
                    amount: totalAmount,
                    description: `Ride Payment (ID: ${booking._id.toString().slice(-6).toUpperCase()})`,
                    referenceId: booking._id
                });
                await passengerWallet.save();
            }

            // Add earning to driver's wallet (if not already added)
            if (booking.driver && !booking.earningsProcessed) {
                const totalFare = booking.finalFare || booking.offeredFare || 0;
                const commission = totalFare * 0.02;
                const driverNetEarning = totalFare - commission;

                // Update Total Earnings (Aggregate)
                await User.findByIdAndUpdate(booking.driver, {
                    $inc: { 'driverDetails.earnings': totalFare }
                });

                // Wallet Logic
                let driverWallet = await Wallet.findOne({ user: booking.driver });
                if (!driverWallet) {
                    driverWallet = await Wallet.create({ user: booking.driver, balance: 0 });
                }

                if (booking.paymentMethod === 'wallet' || true) { // Force wallet logic for Rapido flow
                    // Credit Driver Wallet (Net Earning: 98%)
                    await User.findByIdAndUpdate(booking.driver, {
                        $inc: { walletBalance: driverNetEarning }
                    });
                    driverWallet.balance += driverNetEarning;
                    driverWallet.transactions.push({
                        type: 'credit',
                        amount: driverNetEarning,
                        description: `Ride Earning (ID: ${booking._id.toString().slice(-6).toUpperCase()}) - 2% Platform Fee deducted`,
                        referenceId: booking._id
                    });
                } 

                await driverWallet.save();
                booking.earningsProcessed = true; 
            }
        }

        if (status === 'cancelled') {
            booking.cancelledAt        = now;
            booking.cancelledBy        = role;
            booking.cancellationReason = cancellationReason || '';
        }

        await booking.save();

        return res.json({ success: true, message: `Ride status updated to '${status}'`, data: booking });
    } catch (error) {
        console.error('updateRideStatus error:', error);
        return res.status(500).json({ success: false, message: 'Failed to update status' });
    }
};

// ─── 5. GET /api/bookings/active ───────────────────────────
// Get current active ride for the logged-in user (passenger or driver)
// @access Private
export const getActiveRide = async (req, res) => {
    try {
        const isDriver = req.user.role === 'driver';
        
        // Drivers: Finished with ride as soon as status is 'completed'
        // Passengers: Ride stays active until paymentStatus is 'completed'
        const DRIVER_ACTIVE_STATUS = ['pending', 'accepted', 'arrived', 'ongoing'];
        const PASSENGER_ACTIVE_STATUS = ['pending', 'accepted', 'arrived', 'ongoing', 'completed'];

        const query = isDriver
            ? { driver: req.user._id, status: { $in: DRIVER_ACTIVE_STATUS } }
            : { passenger: req.user._id, status: { $in: PASSENGER_ACTIVE_STATUS }, paymentStatus: 'pending' };

        const booking = await Booking.findOne(query)
            .populate('passenger', 'name phone profileImage ridePersonality')
            .populate('driver', 'name phone profileImage driverDetails');

        if (!booking) return res.json({ success: true, data: null, message: 'No active ride' });

        // Obfuscate dropoff for driver if ride hasn't started
        if (isDriver && !['ongoing', 'completed'].includes(booking.status)) {
            const obfuscated = booking.toObject();
            obfuscated.dropoff = {
                address: "Hidden until OTP",
                coordinates: [0, 0]
            };
            return res.json({ success: true, data: obfuscated });
        }

        return res.json({ success: true, data: booking });
    } catch (error) {
        console.error('getActiveRide error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch active ride' });
    }
};

// ─── 6. GET /api/bookings/history ──────────────────────────
// Get ride history for the logged-in user
// @access Private
export const getRideHistory = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const query = req.user.role === 'driver'
            ? { driver: req.user._id, status: { $in: ['completed', 'cancelled'] } }
            : { passenger: req.user._id, status: { $in: ['completed', 'cancelled'] } };

        const [rides, total] = await Promise.all([
            Booking.find(query)
                .populate('passenger', 'name phone profileImage')
                .populate('driver', 'name phone profileImage driverDetails')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit)),
            Booking.countDocuments(query)
        ]);

        return res.json({
            success: true,
            data: rides,
            pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) }
        });
    } catch (error) {
        console.error('getRideHistory error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch ride history' });
    }
};

// ─── 7. POST /api/bookings/:id/rate ────────────────────────
// Rate the ride after it's completed
// @access Private
export const rateRide = async (req, res) => {
    try {
        const { rating, comment } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
        }

        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
        if (booking.status !== 'completed') {
            return res.status(400).json({ success: false, message: 'Can only rate completed rides' });
        }

        const isPassenger = booking.passenger.toString() === req.user._id.toString();
        const isDriver    = booking.driver && booking.driver.toString() === req.user._id.toString();

        if (!isPassenger && !isDriver) {
            return res.status(403).json({ success: false, message: 'Not authorized to rate this ride' });
        }

        const now = new Date();
        if (isPassenger) {
            if (booking.ratingByPassenger?.rating) {
                return res.status(409).json({ success: false, message: 'You have already rated this ride' });
            }
            booking.ratingByPassenger = { rating, comment, givenAt: now };

            // Update driver's ratings (both root and driverDetails for compatibility)
            if (booking.driver) {
                const driver = await User.findById(booking.driver);
                if (driver) {
                    // Update Root Ratings
                    const rootPrev = driver.ratings || { average: 0, count: 0 };
                    const rootCount = rootPrev.count + 1;
                    const rootAvg = ((rootPrev.average * rootPrev.count) + rating) / rootCount;
                    driver.ratings = { average: Math.round(rootAvg * 10) / 10, count: rootCount };

                    // Update Legacy DriverDetails Ratings
                    const prev = driver.driverDetails.ratings;
                    const count = prev.count + 1;
                    const avg = ((prev.average * prev.count) + rating) / count;
                    driver.driverDetails.ratings = { average: Math.round(avg * 10) / 10, count };
                    
                    await driver.save();
                }
            }
        } else {
            if (booking.ratingByDriver?.rating) {
                return res.status(409).json({ success: false, message: 'You have already rated this ride' });
            }
            booking.ratingByDriver = { rating, comment, givenAt: now };

            // Update passenger's ratings (root level)
            const passenger = await User.findById(booking.passenger);
            if (passenger) {
                const prev = passenger.ratings || { average: 0, count: 0 };
                const count = prev.count + 1;
                const avg = ((prev.average * prev.count) + rating) / count;
                passenger.ratings = { average: Math.round(avg * 10) / 10, count };
                await passenger.save();
            }
        }

        await booking.save();
        return res.json({ success: true, message: 'Rating submitted', data: booking });
    } catch (error) {
        console.error('rateRide error:', error);
        return res.status(500).json({ success: false, message: 'Failed to submit rating' });
    }
};

// ─── 8. GET /api/bookings/:id ──────────────────────────────
// Get a single booking by ID
// @access Private
export const getBookingById = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id)
            .populate('passenger', 'name phone profileImage ridePersonality')
            .populate('driver', 'name phone profileImage driverDetails');

        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

        const isPassenger = booking.passenger && booking.passenger._id.toString() === req.user._id.toString();
        const isDriver    = booking.driver && booking.driver._id.toString() === req.user._id.toString();

        if (!isPassenger && !isDriver) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        // Obfuscate dropoff for driver if ride hasn't started
        if (isDriver && !['ongoing', 'completed'].includes(booking.status)) {
            const obfuscated = booking.toObject();
            obfuscated.dropoff = {
                address: "Hidden until OTP",
                coordinates: [0, 0]
            };
            return res.json({ success: true, data: obfuscated });
        }

        return res.json({ success: true, data: booking });
    } catch (error) {
        console.error('getBookingById error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch booking' });
    }
};

// ─── 9. GET /api/bookings/:id/messages ─────────────────────
// Get chat messages for a specific booking
// @access Private
export const getMessages = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

        const isPassenger = booking.passenger.toString() === req.user._id.toString();
        const isDriver    = booking.driver && booking.driver.toString() === req.user._id.toString();

        if (!isPassenger && !isDriver) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        const messages = await Message.find({ booking: req.params.id }).sort({ createdAt: 1 });
        return res.json({ success: true, data: messages });
    } catch (error) {
        console.error('getMessages error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch messages' });
    }
};

// ─── 10. POST /api/bookings/:id/messages ────────────────────
// Send a chat message for a specific booking
// @access Private
export const sendMessage = async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || !text.trim()) {
            return res.status(400).json({ success: false, message: 'Message text is required' });
        }

        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

        const isPassenger = booking.passenger.toString() === req.user._id.toString();
        const isDriver    = booking.driver && booking.driver.toString() === req.user._id.toString();

        if (!isPassenger && !isDriver) {
            return res.status(403).json({ success: false, message: 'Not authorized to send messages' });
        }

        const message = await Message.create({
            booking: req.params.id,
            sender: req.user._id,
            text: text.trim(),
        });

        return res.status(201).json({ success: true, data: message });
    } catch (error) {
        console.error('sendMessage error:', error);
        return res.status(500).json({ success: false, message: 'Failed to send message' });
    }
};
