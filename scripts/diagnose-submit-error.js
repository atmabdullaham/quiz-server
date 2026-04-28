#!/usr/bin/env node
/**
 * EMERGENCY: Submit Quiz Error - Diagnostic & Fix Script
 * Helps diagnose and fix "already submitted" errors on first submission
 */

import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

// Define schemas
const userSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  name: String,
  profile: {
    studentName: String,
    schoolName: String,
    className: String,
    rollNumber: String,
    mobileNumber: String,
    address: String,
  }
});

const submissionSchema = new mongoose.Schema({
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userAnswers: [{ questionIndex: Number, selectedOption: Number, isCorrect: Boolean }],
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
const Quiz = mongoose.model('Quiz');

async function diagnoseSumbitIssue() {
  try {
    console.log('\n🚨 EMERGENCY: Submit Quiz Error - Diagnostic Tool\n');
    console.log('='.repeat(70));

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/quiz-platform';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // 1. Check submission schema index
    console.log('1️⃣  Checking database schema and indexes...');
    const indexes = await Submission.collection.getIndexes();
    console.log('   Submission indexes:');
    Object.keys(indexes).forEach(idx => {
      console.log(`     - ${idx}: ${JSON.stringify(indexes[idx].key)}`);
    });
    
    const uniqueIndex = Object.values(indexes).find(idx => idx.unique && idx.key.quizId && idx.key.userId);
    if (uniqueIndex) {
      console.log('   ✅ Unique index (quizId, userId) found\n');
    } else {
      console.log('   ⚠️  WARNING: Unique index (quizId, userId) NOT found!\n');
      console.log('   This can cause duplicate submissions!\n');
    }

    // 2. Find recent submissions (last 24 hours)
    console.log('2️⃣  Analyzing recent submissions (last 24 hours)...');
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentSubmissions = await Submission.find({
      submittedAt: { $gte: oneDayAgo }
    }).populate('userId', 'profile').populate('quizId', 'title');

    console.log(`   Total recent submissions: ${recentSubmissions.length}\n`);

    if (recentSubmissions.length > 0) {
      // Group by quiz
      const byQuiz = {};
      recentSubmissions.forEach(sub => {
        if (!byQuiz[sub.quizId._id]) {
          byQuiz[sub.quizId._id] = { title: sub.quizId.title, users: [] };
        }
        byQuiz[sub.quizId._id].users.push({
          userId: sub.userId._id,
          userName: sub.userId.profile?.studentName || 'Unknown',
          submittedAt: sub.submittedAt
        });
      });

      // Check for duplicate submissions (same user, same quiz)
      let duplicates = [];
      Object.entries(byQuiz).forEach(([quizId, data]) => {
        const userCounts = {};
        data.users.forEach(user => {
          userCounts[user.userId] = (userCounts[user.userId] || 0) + 1;
        });
        Object.entries(userCounts).forEach(([userId, count]) => {
          if (count > 1) {
            duplicates.push({ quizId, userId, count });
          }
        });
      });

      if (duplicates.length > 0) {
        console.log(`   ⚠️  FOUND ${duplicates.length} DUPLICATE SUBMISSIONS:\n`);
        duplicates.forEach(dup => {
          console.log(`      Quiz ${dup.quizId}: User has ${dup.count} submissions`);
        });
        console.log('');
      } else {
        console.log('   ✅ No duplicate submissions found\n');
      }
    }

    // 3. Check for orphaned submissions
    console.log('3️⃣  Checking for orphaned submissions...');
    const allSubmissions = await Submission.find().populate('userId');
    const orphaned = allSubmissions.filter(sub => !sub.userId);
    
    if (orphaned.length > 0) {
      console.log(`   ⚠️  Found ${orphaned.length} orphaned submissions (deleted users)\n`);
      console.log('   Affected IDs:');
      orphaned.forEach(sub => console.log(`     - ${sub._id}`));
      console.log('');
    } else {
      console.log('   ✅ No orphaned submissions\n');
    }

    // 4. Check for old test data
    console.log('4️⃣  Checking for old test data (older than 7 days)...');
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const oldSubmissions = await Submission.find({
      submittedAt: { $lt: sevenDaysAgo }
    }).populate('userId', 'profile').populate('quizId', 'title');

    console.log(`   Total submissions older than 7 days: ${oldSubmissions.length}\n`);

    if (oldSubmissions.length > 10) {
      console.log('   💡 Recommendation: Clean up old test data\n');
    }

    // 5. Recommend actions
    console.log('5️⃣  RECOMMENDED ACTIONS:');
    console.log('');
    
    if (orphaned.length > 0) {
      console.log('   📌 TO FIX ORPHANED SUBMISSIONS:');
      console.log(`      db.submissions.deleteMany({ userId: { $exists: false } })`);
      console.log('');
    }

    if (duplicates.length > 0) {
      console.log('   📌 TO FIX DUPLICATE SUBMISSIONS:');
      console.log('      (Manual review recommended - ensure you keep the first/best submission)');
      console.log('');
    }

    if (oldSubmissions.length > 10) {
      console.log('   📌 TO CLEAN UP OLD TEST DATA:');
      console.log(`      db.submissions.deleteMany({ submittedAt: { \\$lt: ISODate("${sevenDaysAgo.toISOString()}") } })`);
      console.log('');
    }

    console.log('   📌 TO RECREATE UNIQUE INDEX:');
    console.log('      db.submissions.dropIndex("quizId_1_userId_1")');
    console.log('      db.submissions.createIndex({ quizId: 1, userId: 1 }, { unique: true })');
    console.log('');

    // 6. Test with a specific user if provided
    const testUserId = process.argv[2];
    if (testUserId) {
      console.log(`6️⃣  Detailed check for User ${testUserId}...`);
      const userSubmissions = await Submission.find({ userId: testUserId })
        .populate('quizId', 'title')
        .sort({ submittedAt: -1 });
      
      console.log(`   Total submissions: ${userSubmissions.length}`);
      userSubmissions.forEach((sub, idx) => {
        console.log(`   ${idx + 1}. Quiz: ${sub.quizId?.title}, Score: ${sub.score}, Time: ${new Date(sub.submittedAt).toLocaleString()}`);
      });
      console.log('');
    }

    console.log('='.repeat(70));
    console.log('\n✅ Diagnostic complete!\n');
    console.log('💡 Next steps:');
    console.log('   1. Review recommendations above');
    console.log('   2. Execute cleanup commands in MongoDB if needed');
    console.log('   3. Clear browser cache (Ctrl+Shift+Delete)');
    console.log('   4. Test submission with a fresh account\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
  }
}

diagnoseSumbitIssue();
