#!/usr/bin/env node
/**
 * Submission Cleanup Script
 * Helps identify and fix issues with submission data
 */

import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

// Define schemas
const userSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  name: String,
  role: { type: String, enum: ['admin', 'student'], default: 'student' },
  profile: {
    studentName: String,
    schoolName: String,
    className: String,
    rollNumber: String,
    mobileNumber: String,
    address: String,
    updatedAt: Date
  },
  studentStatistics: {
    totalQuizzesAttempted: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },
    quizzesWon: { type: Number, default: 0 },
    lastQuizTakenAt: Date,
    lastPointsUpdatedAt: Date
  },
  createdAt: { type: Date, default: Date.now }
});

const submissionSchema = new mongoose.Schema({
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userAnswers: [{
    questionIndex: Number,
    selectedOption: Number,
    isCorrect: Boolean
  }],
  score: { type: Number, default: 0 },
  totalQuestions: Number,
  submittedAt: { type: Date, default: Date.now },
  timeTaken: Number,
  answersLocked: { type: Boolean, default: true },
  isDuplicateFlag: { type: Boolean, default: false }
});

submissionSchema.index({ quizId: 1, userId: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);
const Submission = mongoose.model('Submission', submissionSchema);

async function cleanup() {
  try {
    console.log('\n🧹 Submission Cleanup Tool\n');
    console.log('='.repeat(60));

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/quiz-platform';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // 1. Find orphaned submissions (submissions with invalid userId)
    console.log('1️⃣  Checking for orphaned submissions...');
    const allSubmissions = await Submission.find().populate('userId');
    const orphaned = allSubmissions.filter(sub => !sub.userId);
    
    if (orphaned.length > 0) {
      console.log(`   ⚠️  Found ${orphaned.length} orphaned submissions`);
      const ids = orphaned.map(s => s._id.toString()).join(', ');
      console.log(`   IDs: ${ids}\n`);
      
      console.log('   Deleting orphaned submissions...');
      await Submission.deleteMany({ userId: { $exists: false } });
      console.log(`   ✅ Deleted ${orphaned.length} orphaned submissions\n`);
    } else {
      console.log('   ✅ No orphaned submissions found\n');
    }

    // 2. Check for duplicate submissions (same user, same quiz)
    console.log('2️⃣  Checking for duplicate submissions (multiple entries per user-quiz)...');
    const quizzes = await mongoose.model('Quiz').find({}).select('_id');
    let duplicateCounts = {};
    
    for (const quiz of quizzes) {
      const groupedByUser = await Submission.aggregate([
        { $match: { quizId: quiz._id } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } }
      ]);
      
      if (groupedByUser.length > 0) {
        duplicateCounts[quiz._id.toString()] = groupedByUser;
      }
    }
    
    if (Object.keys(duplicateCounts).length > 0) {
      console.log(`   ⚠️  Found duplicate submissions:\n`);
      for (const [quizId, duplicates] of Object.entries(duplicateCounts)) {
        console.log(`   Quiz ${quizId}:`);
        duplicates.forEach(d => {
          console.log(`      User ${d._id}: ${d.count} submissions`);
        });
      }
      console.log('');
    } else {
      console.log('   ✅ No duplicate submissions found\n');
    }

    // 3. Check for impossible scenarios (submission time > quiz time)
    console.log('3️⃣  Checking submission data integrity...');
    const Quiz = mongoose.model('Quiz');
    const badSubmissions = [];
    
    for (const submission of allSubmissions) {
      const quiz = await Quiz.findById(submission.quizId);
      if (quiz && submission.timeTaken > (quiz.timeLimit * 60)) {
        badSubmissions.push({
          id: submission._id,
          quizId: submission.quizId,
          timeTaken: submission.timeTaken,
          quizTimeLimit: quiz.timeLimit * 60
        });
      }
    }
    
    if (badSubmissions.length > 0) {
      console.log(`   ⚠️  Found ${badSubmissions.length} submissions exceeding quiz time limit:`);
      badSubmissions.forEach(sub => {
        console.log(`      ${sub.id}: Took ${Math.round(sub.timeTaken / 60)}m, limit was ${sub.quizTimeLimit / 60}m`);
      });
      console.log('');
    } else {
      console.log('   ✅ All submissions within time limits\n');
    }

    // 4. Statistics summary
    console.log('4️⃣  Submission Statistics:');
    const totalSubmissions = allSubmissions.length;
    const uniqueUsers = new Set(allSubmissions.map(s => s.userId.toString())).size;
    const uniqueQuizzes = new Set(allSubmissions.map(s => s.quizId.toString())).size;
    const avgScore = allSubmissions.length > 0 
      ? (allSubmissions.reduce((sum, s) => sum + s.score, 0) / allSubmissions.length).toFixed(2)
      : 0;

    console.log(`   Total submissions: ${totalSubmissions}`);
    console.log(`   Unique users: ${uniqueUsers}`);
    console.log(`   Unique quizzes: ${uniqueQuizzes}`);
    console.log(`   Average score: ${avgScore}\n`);

    // 5. User profile completeness
    console.log('5️⃣  User profile completeness:');
    const usersWithSubmissions = await User.find({
      _id: { $in: allSubmissions.map(s => s.userId) }
    });
    
    const completeProfiles = usersWithSubmissions.filter(u => 
      u.profile?.studentName && u.profile?.schoolName && 
      u.profile?.className && u.profile?.mobileNumber
    ).length;
    
    console.log(`   Users with submissions: ${usersWithSubmissions.length}`);
    console.log(`   Users with complete profiles: ${completeProfiles}`);
    console.log(`   Users with incomplete profiles: ${usersWithSubmissions.length - completeProfiles}\n`);

    console.log('='.repeat(60));
    console.log('\n✅ Cleanup analysis complete!\n');

    // Offer to clear test data
    console.log('💡 To manually clear specific submissions:');
    console.log('   db.submissions.deleteMany({ submittedAt: { $lt: ISODate("2024-01-01") } })\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
  }
}

cleanup();
