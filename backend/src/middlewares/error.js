const ErrorResponse = require('../utils/errorResponse');

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let error = err instanceof ErrorResponse ? err : new ErrorResponse(err.message, err.statusCode || err.status);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    error = new ErrorResponse('Resource not found', 404);
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0];
    const message = field === 'email'
      ? 'An account with this email already exists'
      : 'Duplicate value entered';
    error = new ErrorResponse(message, 409);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map((val) => val.message).join(', ');
    error = new ErrorResponse(message, 400);
  }

  // Malformed JSON body
  if (err.type === 'entity.parse.failed') {
    error = new ErrorResponse('Malformed JSON in request body', 400);
  }
  if (err.type === 'entity.too.large') {
    error = new ErrorResponse('Request body is too large', 413);
  }

  // Multer upload errors
  if (err.name === 'MulterError') {
    error = new ErrorResponse(err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 2 MB)' : err.message, 400);
  }

  const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;

  if (statusCode >= 500) {
    console.error(err);
  }

  // In production hide details of *unexpected* failures; our own ErrorResponse messages
  // (e.g. "We could not send the email right now") are written for users and stay visible.
  const unexpected = statusCode >= 500 && !(err instanceof ErrorResponse);
  res.status(statusCode).json({
    success: false,
    error: unexpected && process.env.NODE_ENV === 'production'
      ? 'Something went wrong on our side. Please try again.'
      : (error.message || 'Server Error'),
    ...(error.details ? { details: error.details } : {})
  });
};

module.exports = errorHandler;
