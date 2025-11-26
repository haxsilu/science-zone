# Class Management System

A complete, production-ready Class Management System with Admin and Student roles, built for Railway deployment.

## Features

### Admin Features
- **Dashboard** - Overview of students, classes, attendance, and revenue
- **Student Management** - Add, edit, delete students with QR token generation
- **Class Management** - Manage classes and monthly fees
- **Enrollments** - Enroll students into classes
- **QR Scanner** - Scan student QR codes for attendance
- **Manual Attendance** - Mark attendance manually by class and date
- **Payment Tracking** - Record student payments
- **Unpaid Students** - View students who haven't paid for a month
- **Finance Report** - Monthly revenue reports by class
- **Exam Admin** - View exam seat bookings and layouts

### Student Features
- **Exam Seat Booking** - Book seats for December 5th exam (Grade 7 & 8 only)
- View current booking status

## Technology Stack

- **Backend**: Node.js, Express
- **Database**: SQLite (better-sqlite3)
- **Authentication**: express-session, bcrypt
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **QR Scanner**: html5-qrcode

## Installation

```bash
npm install
npm start
```

The server will start on port 5050 (or the port specified in `process.env.PORT`).

## Default Login Credentials

### Admin
- Username: `admin`
- Password: `admin123`

### Student
- Username: Student's phone number (set when creating student)
- Password: `1234` (default)

## Database Schema

The system uses SQLite with the following tables:
- `users` - User accounts (admin and students)
- `students` - Student information
- `classes` - Class definitions
- `enrollments` - Student-class enrollments
- `payments` - Payment records
- `attendance` - Attendance records
- `exam_slots` - Exam session definitions
- `exam_bookings` - Seat bookings

## Railway Deployment

1. Connect your GitHub repository to Railway
2. Set the start command: `node server.js`
3. The app will automatically use `process.env.PORT` provided by Railway
4. Database file (`class_manager.db`) is stored locally in the Railway filesystem

## Project Structure

```
/
├── server.js          # Main Express server
├── package.json       # Dependencies
├── class_manager.db   # SQLite database (created on first run)
└── public/           # Static files
    ├── login.html     # Login page
    ├── admin.html     # Admin dashboard
    ├── admin.css      # Admin styles
    ├── admin.js       # Admin JavaScript
    ├── student.html   # Student portal
    ├── student.css    # Student styles
    └── student.js     # Student JavaScript
```

## API Endpoints

### Authentication
- `POST /api/login` - Login (admin or student)
- `POST /api/logout` - Logout

### Students (Admin only)
- `GET /api/students` - List all students
- `POST /api/students` - Create student
- `PUT /api/students/:id` - Update student
- `DELETE /api/students/:id` - Delete student

### Classes
- `GET /api/classes` - List all classes
- `POST /api/classes` - Create class (Admin only)
- `PUT /api/classes/:id` - Update class (Admin only)

### Enrollments (Admin only)
- `POST /api/enrollments` - Enroll student in class
- `GET /api/classes/:id/students` - Get students in class

### Payments (Admin only)
- `POST /api/payments` - Record payment
- `GET /api/payments` - List payments

### Attendance (Admin only)
- `GET /api/attendance` - Get attendance by class and date
- `POST /api/attendance/manual` - Mark attendance manually
- `POST /api/scan` - Scan QR code for attendance

### Reports (Admin only)
- `GET /api/unpaid` - Get unpaid students for month
- `GET /api/finance` - Get finance report for month

### Exam Booking
- `GET /api/exam/slots` - List exam slots
- `GET /api/exam/slots/:id/layout` - Get seat layout for slot
- `POST /api/exam/book` - Book seat (Student only)
- `GET /api/exam/my-booking` - Get current booking (Student only)

## Notes

- Only Grade 7 and Grade 8 students can book exam seats
- Each student gets a unique QR token for attendance scanning
- Student login accounts are automatically created when a student is added
- The system uses a dark theme UI that's fully responsive

## Created by

Pulindu Pansilu
