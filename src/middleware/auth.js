const jwt = require("jsonwebtoken");
const { User } = require("../models");

const auth = async (req, res, next) => {
	try {
		const authHeader = req.headers.authorization;

		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return res.status(401).json({
				success: false,
				message: "Authorization token is required",
			});
		}

		const token = authHeader.split(" ")[1];
		const secret = process.env.JWT_SECRET || "dev_jwt_secret_change_me";

		const decoded = jwt.verify(token, secret);
		const user = await User.findById(decoded.id).select("_id email role");

		if (!user) {
			return res.status(401).json({
				success: false,
				message: "Invalid token user",
			});
		}

		req.user = {
			id: user._id.toString(),
			email: user.email,
			role: user.role,
		};

		return next();
	} catch (error) {
		return res.status(401).json({
			success: false,
			message: "Unauthorized",
		});
	}
};

module.exports = auth;
