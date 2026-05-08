import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// MongoDB Connection
const mongodbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/quiz-platform';

const userSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, unique: true },
  email: String,
  name: String,
  picture: String,
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  profile: {
    studentName: String,
    schoolName: String,
    className: String,
    rollNumber: String,
    mobileNumber: String,
    address: String,
    createdAt: Date,
    updatedAt: { type: Date, default: Date.now }
  },
  studentStatistics: {
    totalQuizzesAttempted: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },
    quizzesWon: { type: Number, default: 0 },
    lastQuizTakenAt: Date,
    lastPointsUpdatedAt: Date
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

async function checkAdminUsers() {
  try {
    console.log('\n🔍 Connecting to MongoDB...');
    await mongoose.connect(mongodbUri);
    console.log('✅ Connected to MongoDB\n');

    console.log('📊 Checking admin users...\n');

    // Get all users
    const allUsers = await User.find().select('email name role createdAt');
    console.log(`Total users in database: ${allUsers.length}\n`);

    // Separate admin and regular users
    const admins = allUsers.filter(u => u.role === 'admin');
    const regularUsers = allUsers.filter(u => u.role !== 'admin');

    console.log(`👤 Admin users (${admins.length}):`);
    if (admins.length === 0) {
      console.log('   ⚠️  No admin users found!\n');
    } else {
      admins.forEach(admin => {
        console.log(`   • ${admin.email} (${admin.name || 'No name'}) - Created: ${admin.createdAt.toDateString()}`);
      });
      console.log();
    }

    console.log(`👥 Regular users (${regularUsers.length}):`);
    if (regularUsers.length > 0) {
      regularUsers.slice(0, 5).forEach(user => {
        console.log(`   • ${user.email} (${user.name || 'No name'})`);
      });
      if (regularUsers.length > 5) {
        console.log(`   ... and ${regularUsers.length - 5} more`);
      }
      console.log();
    }

    // Ask user if they want to promote a user
    if (process.argv[2] === '--promote') {
      const emailToPromote = process.argv[3];
      if (!emailToPromote) {
        console.log('❌ Please provide email: node check-admin-users.js --promote user@example.com\n');
      } else {
        console.log(`\n🔄 Promoting ${emailToPromote} to admin...\n`);
        const user = await User.findOneAndUpdate(
          { email: emailToPromote },
          { role: 'admin' },
          { new: true }
        );

        if (user) {
          console.log(`✅ Successfully promoted ${user.email} to admin!`);
          console.log(`📌 User must log out and log back in to see the admin dashboard\n`);
        } else {
          console.log(`❌ User with email "${emailToPromote}" not found\n`);
        }
      }
    }

    await mongoose.connection.close();
    console.log('✅ Connection closed');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkAdminUsers();
