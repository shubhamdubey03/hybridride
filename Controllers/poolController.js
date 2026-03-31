import Ride from '../Models/Ride.js';
import User from '../Models/User.js';
import Wallet from '../Models/Wallet.js';

// ─── 1. POST /api/pools/publish ─────────────────────────
// Driver publishes a new pool (City, Outstation, Rental)
// @access Private (Driver)
export const publishRide = async (req, res) => {
    try {
        const {
            type, // "City" | "Outstation" | "Rental"
            originName, originCoords,
            destinationName, destinationCoords,
            scheduledTime,
            vehicle,
            vehicleType, // "CAR" | "BIKE" | "TRAVELER"
            totalSeats,
            pricePerSeat,
            seatPricing,
            preferences
        } = req.body;

        if (!originName || !destinationName || !scheduledTime || !totalSeats || !pricePerSeat) {
            return res.status(400).json({ success: false, message: 'All ride details (origin, destination, time, seats, price) are required' });
        }

        // Rentals enforce "All Seats Booked" pricing structure automatically via frontend mapping,
        // but backend creates it as a single pool block.
        const newRide = await Ride.create({
            host: req.user._id,
            type: type || 'local', // Mapping 'City' -> 'local', 'Outstation' -> 'outstation'
            origin: {
                name: originName,
                location: { type: 'Point', coordinates: originCoords || [0, 0] }
            },
            destination: {
                name: destinationName,
                location: { type: 'Point', coordinates: destinationCoords || [0, 0] }
            },
            scheduledTime: new Date(scheduledTime),
            vehicle: vehicle || 'Standard Vehicle',
            vehicleType: (vehicleType?.toUpperCase() === 'SEDAN' || !vehicleType) ? 'CAR' : vehicleType.toUpperCase(),
            totalSeats: Number(totalSeats),
            availableSeats: Number(totalSeats),
            pricePerSeat: Number(pricePerSeat),
            seatPricing: seatPricing || {},
            preferences: preferences || {}
        });

        // Populate driver details immediately to return
        const populatedRide = await newRide.populate('host', 'name phone profileImage driverDetails');

        return res.status(201).json({ success: true, message: 'Pool ride published successfully', data: populatedRide });
    } catch (error) {
        console.error('publishRide error:', error);
        return res.status(500).json({ success: false, message: 'Failed to publish ride' });
    }
};

// ─── 2. GET /api/pools/search ───────────────────────────
// Passenger searches for upcoming pools
// @access Private (Passenger)
export const searchRides = async (req, res) => {
    try {
        const { type, date, fromCoords, toCoords } = req.query; // 'local', 'outstation', 'intercity', 'date'
        
        // Find rides that are upcoming, have seats, and optionally match the type filter
        let query = {
            status: 'scheduled',
            availableSeats: { $gt: 0 }
        };

        if (date) {
            const searchDate = new Date(date);
            const startOfDay = new Date(searchDate.setHours(0, 0, 0, 0));
            const endOfDay = new Date(searchDate.setHours(23, 59, 59, 999));
            query.scheduledTime = { $gte: startOfDay, $lte: endOfDay };
        } else {
            // Default: Upcoming rides from now
            query.scheduledTime = { $gte: new Date() };
        }

        if (fromCoords) {
            const [lng, lat] = fromCoords.split(',').map(Number);
            query["origin.location"] = {
                $geoWithin: {
                    $centerSphere: [[lng, lat], 10 / 6378.1] // 10km radius
                }
            };
        }

        if (toCoords) {
            const [lng, lat] = toCoords.split(',').map(Number);
            query["destination.location"] = {
                $geoWithin: {
                    $centerSphere: [[lng, lat], 20 / 6378.1] // 20km radius
                }
            };
        }

        const normalizedType = type ? type.toLowerCase() : null;

        if (normalizedType) {
            query.type = normalizedType;
        }

        // ─── Vehicle Eligibility Rules ─────────────────────────────────────────
        // TRAVELER vehicles are large multi-seaters meant for outstation/rental only.
        // They must NOT appear in city (local) pool searches — just like Rapido/Ola.
        if (normalizedType === 'local') {
            query.vehicleType = { $ne: 'TRAVELER' };
        }
        // For outstation/rental: all vehicle types (CAR, BIKE, TRAVELER) are allowed.
        // ───────────────────────────────────────────────────────────────────────

        const rides = await Ride.find(query)
            .populate('host', 'name phone profileImage driverDetails')
            .sort({ scheduledTime: 1 }) // Soonest first
            .limit(50); // Hard cap

        return res.status(200).json({ success: true, count: rides.length, data: rides });
    } catch (error) {
        console.error('searchRides error:', error);
        return res.status(500).json({ success: false, message: 'Failed to search rides' });
    }
};

// ─── 3. POST /api/pools/:id/book ─────────────────────────
// Passenger books seats
// @access Private (Passenger)
export const bookSeat = async (req, res) => {
    try {
        const { seats = 1, paymentMethod = 'razorpay' } = req.body;
        const rideId = req.params.id;

        // ── Cash NOT allowed for pooling ──────────────────────────────────────────────────────────
        // Outstation pooling and all Ride pools require Razorpay payment.
        // The frontend handles the Razorpay checkout BEFORE calling this endpoint.
        if (paymentMethod === 'cash') {
            return res.status(400).json({
                success: false,
                message: 'Cash is not accepted for pool bookings. Please pay via Razorpay.'
            });
        }
        // ──────────────────────────────────────────────────────────────────────

        const ride = await Ride.findById(rideId);
        if (!ride) return res.status(404).json({ success: false, message: 'Ride not found' });
        
        if (ride.availableSeats < seats) {
            return res.status(400).json({ success: false, message: `Only ${ride.availableSeats} seats available` });
        }

        if (ride.host.toString() === req.user._id.toString()) {
            return res.status(400).json({ success: false, message: 'Cannot book your own published ride' });
        }

        // Check if user already booked this ride
        const existingPassenger = ride.passengers.find(p => p.user.toString() === req.user._id.toString());
        if (existingPassenger && existingPassenger.bookingStatus !== 'cancelled') {
            return res.status(400).json({ success: false, message: 'You have already booked a seat on this ride' });
        }

        // ── Wallet balance check & immediate deduction ──────────────────────────────
        // All rides are wallet-only. Deduct at booking time (not at completion).
        const totalAmount = seats * ride.pricePerSeat;
        const passengerUser = await User.findById(req.user._id);
        if (!passengerUser) return res.status(404).json({ success: false, message: 'Passenger not found' });
        if ((passengerUser.walletBalance || 0) < totalAmount) {
            return res.status(402).json({
                success: false,
                message: `Insufficient wallet balance. You need ₹${totalAmount} but have ₹${passengerUser.walletBalance || 0}. Please top up your wallet.`
            });
        }
        passengerUser.walletBalance -= totalAmount;
        await passengerUser.save();
        // Log debit in Wallet
        let pWallet = await Wallet.findOne({ user: req.user._id });
        if (!pWallet) pWallet = await Wallet.create({ user: req.user._id, balance: passengerUser.walletBalance });
        pWallet.balance = passengerUser.walletBalance;
        pWallet.transactions.push({
            type: 'debit', amount: totalAmount,
            description: `Pool Seat Booking — ${seats} seat(s) (Ride: ${ride._id.toString().slice(-6).toUpperCase()})`,
            referenceId: ride._id,
        });
        await pWallet.save();
        // ────────────────────────────────────────────────────────────────────────────

        // Deduct seats and push to manifest
        ride.availableSeats -= seats;
        const pickupOtp = Math.floor(1000 + Math.random() * 9000).toString();
        ride.passengers.push({
            user: req.user._id,
            seatsBooked: seats,
            otp: pickupOtp,
            paymentMethod: 'wallet',
            bookingStatus: 'confirmed',
            paymentStatus: 'paid',
        });
        await ride.save();

        const updatedRide = await ride.populate([
            { path: 'host', select: 'name phone profileImage driverDetails' },
            { path: 'passengers.user', select: 'name phone profileImage' }
        ]);

        return res.status(200).json({
            success: true,
            message: 'Seat booked and payment deducted from wallet',
            otp: pickupOtp,
            amountPaid: totalAmount,
            walletBalance: passengerUser.walletBalance,
            data: updatedRide,
        });

    } catch (error) {
        console.error('bookSeat error:', error);
        return res.status(500).json({ success: false, message: 'Failed to book seat' });
    }
};

// ─── 4. GET /api/pools/driver-history ────────────────────
// Driver fetches all trips they have hosted
// @access Private (Driver)
export const getDriverPools = async (req, res) => {
    try {
        const rides = await Ride.find({ host: req.user._id })
            .populate('passengers.user', 'name phone profileImage')
            .sort({ scheduledTime: -1 });

        return res.status(200).json({ success: true, count: rides.length, data: rides });
    } catch (error) {
        console.error('getDriverPools error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch driver history' });
    }
};

// ─── 5. GET /api/pools/history ───────────────────────────
// Passenger fetches trips they have joined
// @access Private (Passenger)
export const getPassengerPools = async (req, res) => {
    try {
        // Query rides where this user ID is inside the passengers array AND their booking is not cancelled
        const rides = await Ride.find({ 
            passengers: { 
                $elemMatch: { 
                    user: req.user._id, 
                    bookingStatus: { $ne: 'cancelled' } 
                } 
            } 
        })
            .populate('host', 'name phone profileImage driverDetails')
            .sort({ scheduledTime: -1 });

        return res.status(200).json({ success: true, count: rides.length, data: rides });
    } catch (error) {
        console.error('getPassengerPools error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch passenger history' });
    }
};

// ─── 6. PUT /api/pools/:id/status ──────────────────────────
// Driver updates the status of their pool (e.g. 'ongoing', 'cancelled')
// @access Private (Driver)
export const updatePoolStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['scheduled', 'ongoing', 'completed', 'cancelled'];
        
        if (!validStatuses.includes(status)) {
             return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const ride = await Ride.findById(req.params.id);

        if (!ride) {
            return res.status(404).json({ success: false, message: 'Ride not found' });
        }

        // Ensure only the host can update the status
        if (ride.host.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to update this ride' });
        }

        if (status === 'completed') {
            const now = new Date();
            if (new Date(ride.scheduledTime) > now) {
                return res.status(400).json({ success: false, message: 'Cannot complete a trip before its scheduled time' });
            }
        }

        ride.status = status;
        if (req.body.cancellationReason) {
            ride.cancellationReason = req.body.cancellationReason;
        }

        // Process payments if completed
        if (status === 'completed') {
            const host = await User.findById(ride.host);
            let hostWallet = await Wallet.findOne({ user: ride.host });
            if (!hostWallet) {
                hostWallet = await Wallet.create({ user: ride.host, balance: 0 });
            }

            for (let p of ride.passengers) {
                if (p.bookingStatus === 'confirmed' || p.bookingStatus === 'completed') {
                    const totalAmount = p.seatsBooked * ride.pricePerSeat;
                    const commission = totalAmount * 0.02;
                    const driverNetEarning = totalAmount - commission;

                    // Increment host earnings
                    host.driverDetails.earnings = (host.driverDetails.earnings || 0) + totalAmount;

                    // Force Wallet logic only for wallet/razorpay payers
                    // Cash payers settle directly with host — no wallet action needed
                    if (p.paymentMethod === 'wallet' || p.paymentMethod === 'razorpay') {
                        // 1. Deduct from passenger
                        const passenger = await User.findById(p.user);
                        if (passenger) {
                            passenger.walletBalance -= totalAmount;
                            await passenger.save();

                            let pWallet = await Wallet.findOne({ user: p.user });
                            if (!pWallet) {
                                pWallet = await Wallet.create({ user: p.user, balance: passenger.walletBalance });
                            }
                            pWallet.balance = passenger.walletBalance;
                            pWallet.transactions.push({
                                type: 'debit',
                                amount: totalAmount,
                                description: `Pool Payment (Ride ID: ${ride._id.toString().slice(-6).toUpperCase()})`,
                                referenceId: ride._id
                            });
                            await pWallet.save();
                        }

                        // 2. Credit Driver (Net: 98%)
                        host.walletBalance = (host.walletBalance || 0) + driverNetEarning;
                        hostWallet.balance += driverNetEarning;
                        hostWallet.transactions.push({
                            type: 'credit',
                            amount: driverNetEarning,
                            description: `Pool Earning (Ride ID: ${ride._id.toString().slice(-6).toUpperCase()}) - 2% Fee deducted`,
                            referenceId: ride._id
                        });
                    } 
                    p.bookingStatus = 'completed';
                    p.paymentStatus = 'completed';
                }
            }
            await host.save();
            await hostWallet.save();
        }

        await ride.save();

        return res.status(200).json({ success: true, message: `Ride status updated to ${status}`, data: ride });
    } catch (error) {
        console.error('updatePoolStatus error:', error);
        return res.status(500).json({ success: false, message: 'Failed to update ride status' });
    }
};

// ─── 7. PUT /api/pools/:id/cancel-booking ──────────────────
// Passenger cancels their own booking in a pool
// @access Private (Passenger)
export const cancelBooking = async (req, res) => {
    try {
        const { cancellationReason } = req.body;
        const rideId = req.params.id;

        const ride = await Ride.findById(rideId);
        if (!ride) return res.status(404).json({ success: false, message: 'Ride not found' });

        const passengerIndex = ride.passengers.findIndex(p => {
            const passengerId = p.user?._id || p.user;
            return passengerId && passengerId.toString() === req.user._id.toString() && p.bookingStatus !== 'cancelled';
        });
        
        if (passengerIndex === -1) {
            return res.status(400).json({ success: false, message: 'Active booking not found for this user' });
        }

        const booking = ride.passengers[passengerIndex];
        
        // Restore seats
        ride.availableSeats += booking.seatsBooked;
        
        // Update status and reason
        booking.bookingStatus = 'cancelled';
        booking.cancellationReason = cancellationReason || 'No reason provided';

        await ride.save();

        return res.status(200).json({ success: true, message: 'Booking cancelled successfully', data: ride });
    } catch (error) {
        console.error('cancelBooking error:', error);
        return res.status(500).json({ success: false, message: 'Failed to cancel booking' });
    }
};
