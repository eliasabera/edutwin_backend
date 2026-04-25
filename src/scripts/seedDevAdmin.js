const bcrypt = require("bcryptjs");
const { User, AdminProfile } = require("../models");

const DEFAULT_ADMIN_EMAIL = process.env.ADMIN_TEST_EMAIL || "admin@gmail.com";
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_TEST_PASSWORD || "12345678";
const DEFAULT_ADMIN_NAME = process.env.ADMIN_TEST_FULL_NAME || "EduTwin Test Admin";

async function seedDevAdmin() {
	if (process.env.NODE_ENV === "production") {
		return null;
	}

	const email = String(DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
	const existingUser = await User.findOne({ email });

	if (existingUser) {
		if (existingUser.role !== "ADMIN") {
			throw new Error(`Existing user with email ${email} is not an ADMIN account`);
		}

		const existingProfile = await AdminProfile.findOne({ user_id: existingUser._id });
		if (!existingProfile) {
			await AdminProfile.create({
				user_id: existingUser._id,
				full_name: DEFAULT_ADMIN_NAME,
				phone_number: null,
				school_id: null,
			});
		}

		return { email, password: DEFAULT_ADMIN_PASSWORD, created: false };
	}

	const password_hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
	const adminUser = await User.create({
		email,
		password_hash,
		role: "ADMIN",
	});

	await AdminProfile.create({
		user_id: adminUser._id,
		full_name: DEFAULT_ADMIN_NAME,
		phone_number: null,
		school_id: null,
	});

	return { email, password: DEFAULT_ADMIN_PASSWORD, created: true };
}

module.exports = seedDevAdmin;