import mongoose from 'mongoose';
import dotenv from 'dotenv';
import {
  getBangladeshTimeNow,
  convertUTCToBangladesh,
  filterQuizzesByBangladeshTime
} from '../timezoneUtils.js';

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

const checkQuizzes = async () => {
  try {
    console.log('\n🕐 Current Bangladesh Time:', getBangladeshTimeNow());
    console.log('\n📋 Fetching ALL quizzes from database...\n');

    // Get all quizzes regardless of status
    const allQuizzes = await Quiz.find({});
    
    console.log(`Total quizzes in DB: ${allQuizzes.length}\n`);
    
    allQuizzes.forEach(quiz => {
      const start = quiz.startDate ? convertUTCToBangladesh(quiz.startDate) : null;
      const end = quiz.endDate ? convertUTCToBangladesh(quiz.endDate) : null;
      const now = getBangladeshTimeNow();
      
      console.log('─'.repeat(80));
      console.log(`📌 Quiz: ${quiz.title}`);
      console.log(`   ID: ${quiz._id}`);
      console.log(`   Status in DB: ${quiz.status}`);
      console.log(`   Start Date (Bangladesh): ${start ? start.toLocaleString() : 'NOT SET'}`);
      console.log(`   End Date (Bangladesh): ${end ? end.toLocaleString() : 'NOT SET'}`);
      
      if (start) {
        console.log(`   ├─ Start vs Now: ${start <= now ? '✅ Started' : '❌ Not yet started'} (${Math.floor((now - start) / 1000 / 60)} mins ago)`);
      }
      if (end) {
        console.log(`   └─ End vs Now: ${end >= now ? '✅ Still running' : '❌ Ended'} (${Math.floor((now - end) / 1000 / 60)} mins ago)`);
      }
      
      // Check why it's being filtered
      console.log(`\n   🔍 Filter Logic:`);
      if (quiz.status === 'draft') {
        console.log(`      ❌ Filtered OUT (status = 'draft')`);
      } else if (quiz.status === 'scheduled' && start && start > now) {
        console.log(`      ✅ Will SHOW (scheduled & hasn't started)`);
      } else if (quiz.status === 'active' && start && end) {
        if (start <= now && end >= now) {
          console.log(`      ✅ Will SHOW (active & within time range)`);
        } else {
          console.log(`      ❌ Filtered OUT (active but OUTSIDE time range)`);
          if (start > now) console.log(`         Reason: Quiz hasn't started yet`);
          if (end < now) console.log(`         Reason: Quiz has already ended`);
        }
      } else if (quiz.status === 'scheduled' && start && end) {
        if (start <= now && end >= now) {
          console.log(`      ✅ Will SHOW (scheduled but within time range - now active)`);
        } else {
          console.log(`      ❌ Filtered OUT (scheduled but outside time range)`);
        }
      } else {
        console.log(`      ❌ Filtered OUT (doesn't match any filter criteria)`);
      }
      
      console.log();
    });

    // Now apply the actual filter
    console.log('\n' + '='.repeat(80));
    console.log('📊 AFTER APPLYING filterQuizzesByBangladeshTime():\n');
    
    const filtered = filterQuizzesByBangladeshTime(allQuizzes);
    console.log(`Showing quizzes: ${filtered.length}`);
    filtered.forEach(quiz => {
      console.log(`   ✅ ${quiz.title} (${quiz.status})`);
    });

    if (filtered.length === 0) {
      console.log('   ⚠️  NO QUIZZES TO SHOW!\n');
      console.log('🔧 SOLUTIONS:');
      console.log('   1. Set quiz status to "active"');
      console.log('   2. Make sure startDate <= now AND endDate >= now');
      console.log('   3. For always-visible quizzes, use startDate far in past and endDate far in future');
    }

  } catch (error) {
    console.error('\n❌ Error checking quizzes:', error.message);
    throw error;
  }
};

const main = async () => {
  try {
    await connectDB();
    await checkQuizzes();
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
