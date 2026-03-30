const { body, validationResult } = require("express-validator");

const handleValidation = (req, res, next) => {
	const errors = validationResult(req);

	if (!errors.isEmpty()) {
		return res.status(400).json({
			success: false,
			message: "Validation failed",
			errors: errors.array(),
		});
	}

	return next();
};

const validateRegister = [
	body("email").isEmail().withMessage("Valid email is required"),
	body("password")
		.isString()
		.isLength({ min: 6 })
		.withMessage("Password must be at least 6 characters"),
	body("role")
		.optional()
		.isIn(["STUDENT", "TEACHER", "ADMIN"])
		.withMessage("Role must be STUDENT, TEACHER, or ADMIN"),
	handleValidation,
];

const validateLogin = [
	body("email").isEmail().withMessage("Valid email is required"),
	body("password").isString().notEmpty().withMessage("Password is required"),
	handleValidation,
];

module.exports = {
	handleValidation,
	validateRegister,
	validateLogin,
};
