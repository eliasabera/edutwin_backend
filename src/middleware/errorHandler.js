const notFound = (req, res, _next) => {
	return res.status(404).json({
		success: false,
		message: `Route not found: ${req.originalUrl}`,
	});
};

const errorHandler = (err, _req, res, _next) => {
	const statusCode = err.statusCode || 500;

	return res.status(statusCode).json({
		success: false,
		message: err.message || "Internal server error",
	});
};

module.exports = {
	notFound,
	errorHandler,
};
