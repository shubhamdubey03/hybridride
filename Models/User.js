import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    phone: {
      type: String,
      unique: true,
      sparse: true, // Allows multiple null/undefined values for users who signed up via Google
      index: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
    },

    role: {
      type: String,
      enum: ["passenger", "driver", "admin"],
      default: "passenger",
    },

    driverApprovalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    profileImage: {
      type: String,
      default: "",
    },

    ratings: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },

    driverDetails: {
      licenseNumber: { type: String },

      vehicle: {
        make: { type: String, default: "" },
        model: { type: String, default: "" },
        year: { type: String, default: "" },
        plateNumber: { type: String, default: "" },
        color: { type: String, default: "" },
        type: { type: String, default: "CAR" },
        fuelType: {
          type: String,
          enum: ["Petrol", "Diesel", "CNG", "EV"],
          default: "Petrol",
        },
        seatingCapacity: { type: Number, default: 4 },
        bootSpace: { type: String, default: "" },
      }, 

      documents: {
        aadharFront: { type: String },
        aadharBack: { type: String }, 
        panCard: { type: String },
        licenseFront: { type: String },
        licenseBack: { type: String },
        registration: { type: String },
        insurance: { type: String },
        rc: { type: String },
        permit: { type: String },
        fitness: { type: String },
      },

      isOnline: { type: Boolean, default: false },

      currentLocation: {
        type: { type: String, enum: ["Point"], default: "Point" },
        coordinates: { type: [Number], default: [0, 0], index: "2dsphere" },
      },

      ratings: {
        average: { type: Number, default: 0 },
        count: { type: Number, default: 0 },
      },

      earnings: { type: Number, default: 0 },

      preferences: {
        outstationRatePerKm: { type: Number, default: 15 },
        nightCharge: { type: Number, default: 250 },
        allowNightStay: { type: Boolean, default: false }
      }
    },

    verificationStatus: {
      email: { type: Boolean, default: false },
      phone: { type: Boolean, default: false },
      idCard: { type: Boolean, default: false },
      communityTrusted: { type: Boolean, default: false },
    },

    ridePersonality: {
      type: [String],
      default: ["Quiet Ride", "AC On"], // Default tags for now
    },

    savedPlaces: [
      {
        type: { type: String, enum: ["Home", "Work", "Other"], required: true },
        label: { type: String, required: true },
        address: { type: String, required: true },
        coordinates: { type: [Number], index: "2dsphere" },
      },
    ],

    travelStats: {
      totalSavings: { type: Number, default: 1240 }, // Default for demo, should be 0 real
      co2Saved: { type: Number, default: 18 }, // Default for demo
    },

    isBlocked: { type: Boolean, default: false },
    rejectionReason: { type: String, default: "" },

    walletBalance: { type: Number, default: 0 },

    otp: { type: String, default: null },
    otpExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;
