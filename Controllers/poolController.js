import Ride from '../Models/Ride.js';
import User from '../Models/User.js';

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
            vehicle: vehicle || 'Sedan',
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

        if (type) {
            query.type = type.toLowerCase();
        }

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
        const { seats = 1 } = req.body;
        const rideId = req.params.id;

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

        // Deduct seats and push to manifest
        ride.availableSeats -= seats;
        
        // Generate a random 4-digit OTP for passenger to give driver
        const pickupOtp = Math.floor(1000 + Math.random() * 9000).toString();

        ride.passengers.push({
            user: req.user._id,
            seatsBooked: seats,
            bookingStatus: 'confirmed',
            pickupStatus: 'pending',
            otp: pickupOtp
        });

        await ride.save();

        const updatedRide = await ride.populate([
            { path: 'host', select: 'name phone profileImage driverDetails' },
            { path: 'passengers.user', select: 'name phone profileImage' }
        ]);

        return res.status(200).json({ success: true, message: 'Seat booked successfully', data: updatedRide });
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

        ride.status = status;
        if (req.body.cancellationReason) {
            ride.cancellationReason = req.body.cancellationReason;
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
