class ErrorResponse extends Error {
  constructor(message, statusCode, details) {
    super(message);
    this.statusCode = statusCode;
    if (details) this.details = details;
  }
}

module.exports = ErrorResponse;
