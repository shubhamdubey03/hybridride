import mongoose from 'mongoose';

// This model handles on-demand ride requests (passenger books → driver accepts)
// The existing Ride.js handles carpool/pool-sharing (driver posts a route → passengers join)

const bookingSchema = new mongoose.Schema(
  {
    // ─── Participants ──────────────────────────────────
    passenger: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // ─── Locations ─────────────────────────────────────
    pickup: {
      address:     { type: String, required: true },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },

    dropoff: {
      address:     { type: String, required: true },
      coordinates: { type: [Number], required: true },
    },

    // ─── Ride Info ─────────────────────────────────────
    rideType: {
      type: String,
      enum: ['city', 'outstation', 'pool', 'rental'],
      default: 'city',
    },

    vehicleType: {
      type: String,
      enum: ['CAR', 'BIKE', 'AUTO'],
      default: 'CAR',
    },

    seats: { type: Number, default: 1 },

    // ─── Status Lifecycle ──────────────────────────────
    // pending → accepted → arrived → ongoing → completed
    //        ↘ cancelled
    status: {
      type: String,
      enum: ['pending', 'accepted', 'arrived', 'ongoing', 'completed', 'cancelled'],
      default: 'pending',
    },

    cancelledBy:        { type: String, enum: ['passenger', 'driver', 'system'] },
    cancellationReason: { type: String },

    // ─── Fare ──────────────────────────────────────────
    estimatedFare: { type: Number, default: 0 },
    offeredFare:   { type: Number, default: 0 }, // Custom bid by passenger
    finalFare:     { type: Number, default: 0 }, // Agreed/charged fare

    distanceKm:   { type: Number, default: 0 },
    durationMins: { type: Number, default: 0 },
    otp:          { type: String }, // 4-digit OTP to start ride
    earningsProcessed: { type: Boolean, default: false },

    // ─── Payment ───────────────────────────────────────
    paymentMethod: {
      type: String,
      enum: ['cash', 'wallet'],
      default: 'cash',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'completed'],
      default: 'pending',
    },

    // ─── Timestamps ────────────────────────────────────
    acceptedAt:   { type: Date },
    arrivedAt:    { type: Date },
    startedAt:    { type: Date },
    completedAt:  { type: Date },
    cancelledAt:  { type: Date },

    // ─── Ratings ───────────────────────────────────────
    ratingByPassenger: {
      rating:  { type: Number, min: 1, max: 5 },
      comment: { type: String },
      givenAt: { type: Date },
    },
    ratingByDriver: {
      rating:  { type: Number, min: 1, max: 5 },
      comment: { type: String },
      givenAt: { type: Date },
    },
  },
  { timestamps: true }
);

// Index for geospatial queries on pickup (to find nearby rides)
bookingSchema.index({ 'pickup.coordinates': '2dsphere' });

const Booking = mongoose.model('Booking', bookingSchema);
export default Booking;
