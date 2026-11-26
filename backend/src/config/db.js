const mongoose = require('mongoose');

// NOTE: query-selector injection (e.g. {"email": {"$gt": ""}}) is prevented in the
// controllers by coercing every user-supplied filter value to a string and by comparing
// OTP hashes in code rather than inside the query.
mongoose.set('strictQuery', true);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retries so the API survives MongoDB starting slower than Node (e.g. docker-compose)
const connectDB = async ({ retries = 8 } = {}) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const conn = await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      console.log(`MongoDB connected: ${conn.connection.host}`);
      return conn;
    } catch (error) {
      console.error(`MongoDB connection attempt ${attempt}/${retries} failed: ${error.message}`);
      if (attempt === retries) {
        console.error('Could not connect to MongoDB. Check MONGO_URI and that MongoDB is running.');
        process.exit(1);
      }
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 10000));
    }
  }
  return null;
};

module.exports = connectDB;
