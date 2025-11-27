const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 5050;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  secret: 'class-management-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Initialize Database
const db = new Database('class_manager.db');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    student_id INTEGER,
    FOREIGN KEY (student_id) REFERENCES students(id)
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    grade TEXT NOT NULL,
    qr_token TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    monthly_fee INTEGER DEFAULT 2000
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    student_id INTEGER,
    class_id INTEGER,
    PRIMARY KEY (student_id, class_id),
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (class_id) REFERENCES classes(id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    class_id INTEGER NOT NULL,
    month TEXT NOT NULL,
    amount INTEGER NOT NULL,
    method TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(student_id, class_id, month),
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (class_id) REFERENCES classes(id)
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    class_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(student_id, class_id, date),
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (class_id) REFERENCES classes(id)
  );

  CREATE TABLE IF NOT EXISTS exam_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    max_seats INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS exam_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id INTEGER NOT NULL,
    seat_index INTEGER NOT NULL,
    seat_pos INTEGER NOT NULL,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    student_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(slot_id, seat_index, seat_pos),
    FOREIGN KEY (slot_id) REFERENCES exam_slots(id),
    FOREIGN KEY (student_id) REFERENCES students(id)
  );
`);

// Seed data
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const adminHash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', adminHash, 'admin');
}

// Seed classes
const classes = ['Grade 6', 'Grade 7', 'Grade 8', 'O/L'];
classes.forEach(className => {
  const exists = db.prepare('SELECT id FROM classes WHERE name = ?').get(className);
  if (!exists) {
    db.prepare('INSERT INTO classes (name, monthly_fee) VALUES (?, ?)').run(className, 2000);
  }
});

// Seed exam slots
const slotsExist = db.prepare('SELECT id FROM exam_slots').get();
if (!slotsExist) {
  db.prepare(`
    INSERT INTO exam_slots (label, start_time, end_time, max_seats) 
    VALUES (?, ?, ?, ?)
  `).run('Session 1', '2024-12-05T14:00:00', '2024-12-05T17:00:00', 14);
  
  db.prepare(`
    INSERT INTO exam_slots (label, start_time, end_time, max_seats) 
    VALUES (?, ?, ?, ?)
  `).run('Session 2', '2024-12-05T17:30:00', '2024-12-05T20:30:00', 14);
}

// Middleware: Check authentication
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.userId || req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const requireStudent = (req, res, next) => {
  if (!req.session.userId || req.session.role !== 'student') {
    return res.status(403).json({ error: 'Student access required' });
  }
  next();
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', async (req, res) => {
  const { username, password, role } = req.body;
  
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(username, role);
  
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.studentId = user.student_id;
  
  res.json({ success: true, role: user.role });
});

// Student registration/login endpoint
app.post('/api/student/register-login', async (req, res) => {
  const { name, phone, grade } = req.body;
  
  if (!name || !phone || !grade) {
    return res.status(400).json({ error: 'Missing required fields: name, phone, and grade are required' });
  }
  
  try {
    // Check if student exists by phone number
    let student = db.prepare('SELECT * FROM students WHERE phone = ?').get(phone);
    
    if (student) {
      // Update existing student info if needed
      db.prepare('UPDATE students SET name = ?, grade = ? WHERE id = ?').run(name, grade, student.id);
      student = db.prepare('SELECT * FROM students WHERE id = ?').get(student.id);
    } else {
      // Create new student
      const qrToken = `STU-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const result = db.prepare('INSERT INTO students (name, phone, grade, qr_token) VALUES (?, ?, ?, ?)').run(name, phone, grade, qrToken);
      student = db.prepare('SELECT * FROM students WHERE id = ?').get(result.lastInsertRowid);
    }
    
    // Check if user account exists
    let user = db.prepare('SELECT * FROM users WHERE student_id = ?').get(student.id);
    
    if (!user) {
      // Create user account with default password (phone number as username)
      const defaultPassword = '1234';
      const passwordHash = await bcrypt.hash(defaultPassword, 10);
      db.prepare('INSERT INTO users (username, password_hash, role, student_id) VALUES (?, ?, ?, ?)').run(phone, passwordHash, 'student', student.id);
      user = db.prepare('SELECT * FROM users WHERE student_id = ?').get(student.id);
    } else {
      // Update username if phone changed
      if (user.username !== phone) {
        db.prepare('UPDATE users SET username = ? WHERE id = ?').run(phone, user.id);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      }
    }
    
    // Set session
    req.session.userId = user.id;
    req.session.role = 'student';
    req.session.studentId = student.id;
    
    res.json({ success: true, role: 'student' });
  } catch (err) {
    console.error('Student registration error:', err);
    res.status(400).json({ error: err.message || 'Registration failed' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Admin routes
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Student routes
app.get('/student', requireStudent, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

// API: Students
app.get('/api/students', requireAdmin, (req, res) => {
  const students = db.prepare('SELECT * FROM students ORDER BY created_at DESC').all();
  res.json(students);
});

app.post('/api/students', requireAdmin, async (req, res) => {
  const { name, phone, grade } = req.body;
  
  if (!name || !phone || !grade) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Generate QR token
  const qrToken = `STU-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    const result = db.prepare('INSERT INTO students (name, phone, grade, qr_token) VALUES (?, ?, ?, ?)').run(name, phone, grade, qrToken);
    
    // Create student login account
    const defaultPassword = '1234';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    db.prepare('INSERT INTO users (username, password_hash, role, student_id) VALUES (?, ?, ?, ?)').run(phone, passwordHash, 'student', result.lastInsertRowid);
    
    res.json({ id: result.lastInsertRowid, name, phone, grade, qr_token: qrToken });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/students/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, phone, grade } = req.body;
  
  try {
    db.prepare('UPDATE students SET name = ?, phone = ?, grade = ? WHERE id = ?').run(name, phone, grade, id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/students/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  
  try {
    // Delete user account
    db.prepare('DELETE FROM users WHERE student_id = ?').run(id);
    // Delete enrollments
    db.prepare('DELETE FROM enrollments WHERE student_id = ?').run(id);
    // Delete payments
    db.prepare('DELETE FROM payments WHERE student_id = ?').run(id);
    // Delete attendance
    db.prepare('DELETE FROM attendance WHERE student_id = ?').run(id);
    // Delete student
    db.prepare('DELETE FROM students WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API: Classes
app.get('/api/classes', requireAuth, (req, res) => {
  const classes = db.prepare('SELECT * FROM classes ORDER BY name').all();
  res.json(classes);
});

app.post('/api/classes', requireAdmin, (req, res) => {
  const { name, monthly_fee } = req.body;
  
  try {
    const result = db.prepare('INSERT INTO classes (name, monthly_fee) VALUES (?, ?)').run(name, monthly_fee || 2000);
    res.json({ id: result.lastInsertRowid, name, monthly_fee: monthly_fee || 2000 });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/classes/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, monthly_fee } = req.body;
  
  try {
    db.prepare('UPDATE classes SET name = ?, monthly_fee = ? WHERE id = ?').run(name, monthly_fee, id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API: Enrollments
app.post('/api/enrollments', requireAdmin, (req, res) => {
  const { student_id, class_id } = req.body;
  
  try {
    db.prepare('INSERT OR IGNORE INTO enrollments (student_id, class_id) VALUES (?, ?)').run(student_id, class_id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/classes/:id/students', requireAdmin, (req, res) => {
  const { id } = req.params;
  const students = db.prepare(`
    SELECT s.* FROM students s
    INNER JOIN enrollments e ON s.id = e.student_id
    WHERE e.class_id = ?
    ORDER BY s.name
  `).all(id);
  res.json(students);
});

// API: Payments
app.post('/api/payments', requireAdmin, (req, res) => {
  const { student_id, class_id, month, amount, method } = req.body;
  
  try {
    db.prepare(`
      INSERT OR REPLACE INTO payments (student_id, class_id, month, amount, method)
      VALUES (?, ?, ?, ?, ?)
    `).run(student_id, class_id, month, amount, method);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/payments', requireAdmin, (req, res) => {
  const { month } = req.query;
  let query = `
    SELECT p.*, s.name as student_name, c.name as class_name
    FROM payments p
    JOIN students s ON p.student_id = s.id
    JOIN classes c ON p.class_id = c.id
  `;
  
  if (month) {
    query += ' WHERE p.month = ?';
    const payments = db.prepare(query).all(month);
    return res.json(payments);
  }
  
  const payments = db.prepare(query + ' ORDER BY p.created_at DESC').all();
  res.json(payments);
});

// API: Attendance
app.post('/api/attendance/manual', requireAdmin, (req, res) => {
  const { student_id, class_id, date, present } = req.body;
  
  try {
    if (present) {
      db.prepare(`
        INSERT OR IGNORE INTO attendance (student_id, class_id, date)
        VALUES (?, ?, ?)
      `).run(student_id, class_id, date);
    } else {
      db.prepare('DELETE FROM attendance WHERE student_id = ? AND class_id = ? AND date = ?').run(student_id, class_id, date);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/attendance', requireAdmin, (req, res) => {
  const { class_id, date } = req.query;
  
  if (!class_id || !date) {
    return res.status(400).json({ error: 'class_id and date required' });
  }
  
  const attendance = db.prepare(`
    SELECT s.*, 
           CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END as present
    FROM students s
    INNER JOIN enrollments e ON s.id = e.student_id
    LEFT JOIN attendance a ON s.id = a.student_id AND a.class_id = ? AND a.date = ?
    WHERE e.class_id = ?
    ORDER BY s.name
  `).all(class_id, date, class_id);
  
  res.json(attendance);
});

// API: QR Scan
app.post('/api/scan', requireAdmin, (req, res) => {
  const { token } = req.body;
  
  const student = db.prepare('SELECT * FROM students WHERE qr_token = ?').get(token);
  
  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }
  
  // Get student's class from grade
  const classData = db.prepare('SELECT * FROM classes WHERE name = ?').get(student.grade);
  
  if (!classData) {
    return res.status(404).json({ error: 'Class not found for grade' });
  }
  
  // Mark attendance for today
  const today = new Date().toISOString().split('T')[0];
  try {
    db.prepare(`
      INSERT OR IGNORE INTO attendance (student_id, class_id, date)
      VALUES (?, ?, ?)
    `).run(student.id, classData.id, today);
  } catch (err) {
    // Already marked, ignore
  }
  
  // Check payment status
  const currentMonth = new Date().toISOString().slice(0, 7);
  const payment = db.prepare(`
    SELECT * FROM payments 
    WHERE student_id = ? AND class_id = ? AND month = ?
  `).get(student.id, classData.id, currentMonth);
  
  res.json({
    student_name: student.name,
    class: classData.name,
    payment_status: payment ? 'paid' : 'unpaid',
    payment_amount: payment ? payment.amount : null
  });
});

// API: Unpaid
app.get('/api/unpaid', requireAdmin, (req, res) => {
  const { month } = req.query;
  if (!month) {
    return res.status(400).json({ error: 'Month required (YYYY-MM)' });
  }
  
  const unpaid = db.prepare(`
    SELECT s.*, c.name as class_name, c.monthly_fee
    FROM students s
    INNER JOIN enrollments e ON s.id = e.student_id
    INNER JOIN classes c ON e.class_id = c.id
    LEFT JOIN payments p ON s.id = p.student_id AND e.class_id = p.class_id AND p.month = ?
    WHERE p.id IS NULL
    ORDER BY c.name, s.name
  `).all(month);
  
  res.json(unpaid);
});

// API: Finance
app.get('/api/finance', requireAdmin, (req, res) => {
  const { month } = req.query;
  if (!month) {
    return res.status(400).json({ error: 'Month required (YYYY-MM)' });
  }
  
  const finance = db.prepare(`
    SELECT 
      c.name as class_name,
      COUNT(p.id) as payment_count,
      COALESCE(SUM(p.amount), 0) as total_revenue
    FROM classes c
    LEFT JOIN payments p ON c.id = p.class_id AND p.month = ?
    GROUP BY c.id, c.name
    ORDER BY c.name
  `).all(month);
  
  const grandTotal = finance.reduce((sum, item) => sum + item.total_revenue, 0);
  
  res.json({ classes: finance, grand_total: grandTotal });
});

// API: Exam Slots
app.get('/api/exam/slots', requireAuth, (req, res) => {
  const slots = db.prepare('SELECT * FROM exam_slots ORDER BY start_time').all();
  res.json(slots);
});

app.get('/api/exam/slots/:id/layout', requireAuth, (req, res) => {
  const { id } = req.params;
  const slot = db.prepare('SELECT * FROM exam_slots WHERE id = ?').get(id);
  
  if (!slot) {
    return res.status(404).json({ error: 'Slot not found' });
  }
  
  const bookings = db.prepare(`
    SELECT eb.*, s.grade as student_grade
    FROM exam_bookings eb
    LEFT JOIN students s ON eb.student_id = s.id
    WHERE eb.slot_id = ?
  `).all(id);
  
  res.json({ slot, bookings });
});

app.post('/api/exam/book', requireStudent, (req, res) => {
  const { slot_id, seat_index, seat_pos } = req.body;
  const studentId = req.session.studentId;
  
  if (!studentId) {
    return res.status(400).json({ error: 'Student ID not found in session' });
  }
  
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }
  
  // Only Grade 7 and 8 can book
  if (student.grade !== 'Grade 7' && student.grade !== 'Grade 8') {
    return res.status(403).json({ error: 'Only Grade 7 and Grade 8 students can book seats' });
  }
  
  // Validate seat position (1-6 rows, row 1 has 1-4 columns, rows 2-6 have 1-2 columns)
  if (seat_index < 1 || seat_index > 6) {
    return res.status(400).json({ error: 'Invalid seat row' });
  }
  const maxCols = seat_index === 1 ? 4 : 2;
  if (seat_pos < 1 || seat_pos > maxCols) {
    return res.status(400).json({ error: 'Invalid seat position' });
  }
  
  // Check if student already has a booking - prevent multiple bookings
  const existing = db.prepare(`
    SELECT * FROM exam_bookings 
    WHERE slot_id = ? AND student_id = ?
  `).get(slot_id, studentId);
  
  if (existing) {
    return res.status(400).json({ error: 'You already have a booking for this session. You can only book one seat.' });
  }
  
  // Check if seat is available
  const seatTaken = db.prepare(`
    SELECT * FROM exam_bookings 
    WHERE slot_id = ? AND seat_index = ? AND seat_pos = ?
  `).get(slot_id, seat_index, seat_pos);
  
  if (seatTaken) {
    return res.status(400).json({ error: 'Seat already taken' });
  }
  
  // Check grade separation: no same grade students next to each other
  // Get all bookings for this slot
  const allBookings = db.prepare(`
    SELECT seat_index, seat_pos, student_class 
    FROM exam_bookings 
    WHERE slot_id = ?
  `).all(slot_id);
  
  // Check adjacent seats
  const adjacentSeats = [];
  
  // Horizontal neighbors (same row, adjacent columns)
  const maxCols = seat_index === 1 ? 4 : 2;
  if (seat_pos > 1) {
    adjacentSeats.push({ row: seat_index, col: seat_pos - 1 }); // Left
  }
  if (seat_pos < maxCols) {
    adjacentSeats.push({ row: seat_index, col: seat_pos + 1 }); // Right
  }
  
  // Vertical neighbors (same column, different row)
  // Check row above
  if (seat_index > 1) {
    // If we're in row 2-6, we can check row 1 (row 1 has columns 1-4, so columns 1-2 exist)
    // If we're in row 1, we can check row 0 (doesn't exist, so skip)
    if (seat_index === 1) {
      // Row 1: no row above
    } else {
      // Row 2-6: check row above (seat_pos 1-2 exist in row 1)
      if (seat_pos <= 2) {
        adjacentSeats.push({ row: seat_index - 1, col: seat_pos }); // Above
      }
    }
  }
  // Check row below
  if (seat_index < 6) {
    // If we're in row 1, row 2 below only has columns 1-2
    // If we're in row 2-5, row below has same structure (2 columns)
    if (seat_index === 1) {
      // Row 1: check row 2 below (only columns 1-2 exist in row 2)
      if (seat_pos <= 2) {
        adjacentSeats.push({ row: seat_index + 1, col: seat_pos }); // Below
      }
    } else {
      // Row 2-5: check row below (same column structure, 2 columns)
      adjacentSeats.push({ row: seat_index + 1, col: seat_pos }); // Below
    }
  }
  
  // Check if any adjacent seat has the same grade
  for (const adj of adjacentSeats) {
    const adjBooking = allBookings.find(
      b => b.seat_index === adj.row && b.seat_pos === adj.col
    );
    
    if (adjBooking && adjBooking.student_class === student.grade) {
      return res.status(400).json({ 
        error: `Cannot book this seat. A ${student.grade} student is already seated next to this position. Grade 7 and Grade 8 students must alternate.` 
      });
    }
  }
  
  try {
    db.prepare(`
      INSERT INTO exam_bookings (slot_id, seat_index, seat_pos, student_name, student_class, student_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(slot_id, seat_index, seat_pos, student.name, student.grade, studentId);
    
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/exam/my-booking', requireStudent, (req, res) => {
  const studentId = req.session.studentId;
  
  if (!studentId) {
    return res.json({ booking: null, student: null });
  }
  
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  const booking = db.prepare(`
    SELECT eb.*, es.label, es.start_time, es.end_time
    FROM exam_bookings eb
    JOIN exam_slots es ON eb.slot_id = es.id
    WHERE eb.student_id = ?
  `).get(studentId);
  
  res.json({ booking: booking || null, student: student || null });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
