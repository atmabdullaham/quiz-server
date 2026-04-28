import dotenv from 'dotenv';
import mongoose from 'mongoose';

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

const cleanupBrokenSubmissions = async () => {
  try {
    const db = mongoose.connection.db;
    const submissionsCollection = db.collection('submissions');

    // Step 1: Find submissions with null userId or studentProfileId
    console.log('\n🔍 Checking for broken submissions...\n');
    
    const nullUserIdSubmissions = await submissionsCollection
      .find({ userId: null })
      .toArray();
    
    const nullStudentProfileIdSubmissions = await submissionsCollection
      .find({ studentProfileId: null })
      .toArray();

    console.log(`📊 Submissions with null userId: ${nullUserIdSubmissions.length}`);
    if (nullUserIdSubmissions.length > 0) {
      console.log('  Samples:', nullUserIdSubmissions.slice(0, 2).map(s => ({
        _id: s._id,
        quizId: s.quizId,
        submittedAt: s.submittedAt
      })));
    }

    console.log(`\n📊 Submissions with null studentProfileId: ${nullStudentProfileIdSubmissions.length}`);
    if (nullStudentProfileIdSubmissions.length > 0) {
      console.log('  Samples:', nullStudentProfileIdSubmissions.slice(0, 2).map(s => ({
        _id: s._id,
        quizId: s.quizId,
        submittedAt: s.submittedAt
      })));
    }

    // Step 2: Show total submissions
    const totalSubmissions = await submissionsCollection.countDocuments();
    console.log(`\n📊 Total submissions: ${totalSubmissions}`);

    // Step 3: Show duplicate (quizId, userId) combinations
    console.log('\n🔍 Checking for duplicate (quizId, userId) combinations...\n');
    const duplicates = await submissionsCollection
      .aggregate([
        {
          $group: {
            _id: { quizId: '$quizId', userId: '$userId' },
            count: { $sum: 1 },
            ids: { $push: '$_id' }
          }
        },
        { $match: { count: { $gt: 1 } } }
      ])
      .toArray();

    if (duplicates.length > 0) {
      console.log(`⚠️  Found ${duplicates.length} duplicate (quizId, userId) combinations:`);
      for (const dup of duplicates.slice(0, 5)) {
        console.log(`  - Quiz: ${dup._id.quizId}, User: ${dup._id.userId}, Count: ${dup.count}`);
      }
      console.log(`\n💡 These are violations of the unique index and will cause E11000 errors.`);
    } else {
      console.log('✅ No duplicate (quizId, userId) combinations found');
    }

    // Step 4: Recommendation
    console.log('\n📋 Recommendation:');
    if (nullUserIdSubmissions.length > 0) {
      console.log('   ❌ Found submissions with null userId - these should be deleted');
      console.log(`   Run: db.submissions.deleteMany({ userId: null })`);
    }
    if (nullStudentProfileIdSubmissions.length > 0) {
      console.log('   ℹ️  Found submissions with null studentProfileId (expected from old version)');
    }
    if (duplicates.length > 0) {
      console.log('   ❌ Found duplicate submissions - these cause E11000 errors');
      console.log('   Consider removing older duplicates');
    }

  } catch (error) {
    console.error('\n❌ Error checking submissions:', error.message);
    throw error;
  }
};

const main = async () => {
  try {
    await connectDB();
    await cleanupBrokenSubmissions();
  } catch (error) {
    console.error('❌ Check failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 MongoDB connection closed');
    process.exit(0);
  }
};

main();
