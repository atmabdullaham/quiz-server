in existing collection I have user collection called users,
after user logedin via firebase, preliminary data saved which provided firebase,
after successfull login user can go to dashboard or able to attend quiz,
in our app, user can create or updata user profile data, 1. via prequiz from, 2. via dashboard,
when they create or updata studentprofile the data will save in to the collection called users,
for every user there is a userId provided by mongodb, throuthout the application for individual data, this id will be use, for all CRED operations,
is it will be the best to avoid total complexity for the system,

from user perspective:
user can see website without login, home page, result, notice, quiz etc, while not login start quiz button showes in quiz that login, click here going to login page, after login redirect to desired page not home page.
user can see result and details of the result without login,

after login, user can be able to go dashboard,
here, user can fillup student profile form or updata it, if student profile created before it showes here, and data will be saved in users collection by updating the individual user,

all individual or dynamic functionality regarding user will be based on \_id provided by mongodb for the user,

user quiz submission flow,
now the system is ok, i need some enrichment, like, while student submit quiz successfully, it will also update the user collection for the student, in user collection there will be another like student profile called stuentstatistics, here store, total attended Quiz= +1 after successfull quiz submission, total points: The points: previous + gets from this quiz,
now after student can showes correct answer after quiz submit, here correct answer showen is locked untill result pubication,

admin,
in quiz section for admin where showes all quiz with several options like delete, edit, pubilsh result etc,fot each quiz.during reasult making, check duplicate submission, if duplicate not consider for top list, it is a duplicate if class, roll, and phone are same, and here in table showes data of students, name, class, roll, address and points,

after publish button clicked, now data stored in published result collection, is actually need? or Quiz id and userObject id is ok?

for admin, from dashboard, admin can see all details like phone number and others data shoes in table format, but for user, only shoes,
position, name, school, class, and roll,

after result publish,

- the locked correct answer for the quiz will be unlocked,
- in user collection's studentstatistics, whoes name in reasult sheet, catch via \_id, will quiz won +1,
