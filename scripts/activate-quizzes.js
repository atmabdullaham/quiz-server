import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/quiz-platform', {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    throw err;
  }
};

const quizSchema = new mongoose.Schema({}, { strict: false });
const Quiz = mongoose.model('Quiz', quizSchema, 'quizzes');

const makeQuizzesActive = async () => {
  try {
    console.log('\n🔧 Making all scheduled quizzes ACTIVE...\n');

    // Get current Bangladesh time
    const now = new Date();
    const utcTime = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
    const futureDate = new Date(utcTime + (6 + 30) * 60 * 60 * 1000);  // 30 days in future

    console.log(`📅 Setting end date to: ${futureDate.toISOString()}`);
    console.log();

    // Update all scheduled quizzes
    const result = await Quiz.updateMany(
      { status: 'scheduled' },
      {
        $set: {
          status: 'active',
          endDate: futureDate,
          updatedAt: new Date()
        }
      }
    );

    console.log(`✅ Updated ${result.modifiedCount} quizzes`);
    console.log(`   - Changed status from "scheduled" to "active"`);
    console.log(`   - Extended endDate to ${futureDate.toISOString()}`);

    // Show updated quizzes
    console.log('\n📋 Updated Quizzes:\n');
    const updated = await Quiz.find({ status: 'active' });
    updated.forEach(quiz => {
      console.log(`   ✅ ${quiz.title}`);
      console.log(`      End Date: ${quiz.endDate}`);
      console.log();
    });

  } catch (error) {
    console.error('\n❌ Error updating quizzes:', error.message);
    throw error;
  }
};

const main = async () => {
  try {
    await connectDB();
    await makeQuizzesActive();
  } catch (error) {
    console.error('❌ Update failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 MongoDB connection closed');
    console.log('\n🚀 Restart your server for changes to take effect: npm start\n');
    process.exit(0);
  }
};

main();
