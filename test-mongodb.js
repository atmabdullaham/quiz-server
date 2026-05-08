import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

console.log('\n🔍 MongoDB Atlas Connection Test\n');

const mongoUri = process.env.MONGODB_URI;
console.log(`📌 Connection URI: ${mongoUri.substring(0, 50)}...`);
console.log(`📌 Full URI: ${mongoUri}\n`);

// Extract info from URI
const match = mongoUri.match(/mongodb\+srv:\/\/([^:]+):(.+)@([^/]+)/);
if (match) {
  console.log(`✅ Username: ${match[1]}`);
  console.log(`✅ Password: ${match[2].substring(0, 5)}...`);
  console.log(`✅ Cluster: ${match[3]}\n`);
}

console.log('🔗 Attempting connection...\n');

mongoose.connect(mongoUri, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
  .then(() => {
    console.log('✅✅✅ SUCCESS! Connected to MongoDB Atlas!\n');
    console.log('Your .env file is correct!');
    console.log('You can now run: npm start\n');
    mongoose.connection.close();
    process.exit(0);
  })
  .catch(err => {
    console.log('❌ Connection Failed!\n');
    console.log('Error Type:', err.name);
    console.log('Error Message:', err.message);
    console.log();
    
    // Diagnostics
    if (err.message.includes('querySrv')) {
      console.log('🔧 SOLUTION: DNS cannot resolve MongoDB host');
      console.log('   → Check your internet connection');
      console.log('   → Try changing WiFi or use VPN');
      console.log('   → Or contact your ISP\n');
    }
    
    if (err.message.includes('authentication failed')) {
      console.log('🔧 SOLUTION: Wrong username or password');
      console.log('   → Verify credentials in MongoDB Atlas');
      console.log('   → Check .env file for typos\n');
    }
    
    if (err.message.includes('ECONNREFUSED')) {
      console.log('🔧 SOLUTION: MongoDB blocked or down');
      console.log('   → Check if cluster0 is RUNNING in MongoDB Atlas');
      console.log('   → Check if port 27017 is not blocked\n');
    }
    
    process.exit(1);
  });
