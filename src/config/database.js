const mongoose = require("mongoose");
require("dotenv").config();

const MONGODB_URI = process.env.MONGODB_URI;

const connectDatabase = async () => {
	try {
		if (!MONGODB_URI) {
			throw new Error("MONGODB_URI is not defined in environment variables");
		}

		await mongoose.connect(MONGODB_URI);
		console.log("MongoDB connected");
	} catch (error) {
		console.error("MongoDB connection error:", error.message);
		process.exit(1);
	}
};

module.exports = connectDatabase;
