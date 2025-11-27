const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const QRCode = require('qrcode');
const archiver = require('archiver');
const multer = require('multer');
const jimpModule = require('jimp');
const Jimp = jimpModule.Jimp || jimpModule.default || jimpModule;
const seatLayoutConfig = require('./seat-layout-config');

const app = express();
const PORT = process.env.PORT || 5050;
const QR_OUTPUT_DIR = path.join(__dirname, 'qrs');
const DB_FILE = path.join(__dirname, 'class_manager.db');
const DB_BACKUP_DIR = path.join(__dirname, 'db-backups');
const TMP_DIR = path.join(__dirname, 'tmp');
const QR_OPTIONS = {
  type: 'png',
  width: 400,
  margin: 2,
  color: {
    dark: '#000000',
    light: '#ffffffff'
  }
};

if (!fs.existsSync(QR_OUTPUT_DIR)) {
  fs.mkdirSync(QR_OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(DB_BACKUP_DIR)) {
  fs.mkdirSync(DB_BACKUP_DIR, { recursive: true });
}
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

const upload = multer({ dest: TMP_DIR });

const sanitizeFileComponent = (value = '') => {
  const safe = value.toString().trim().replace(/[^a-z0-9\-_.]/gi, '_');
  return safe || 'student';
};

const getStudentQrFilename = (studentId) => `student-${studentId}.png`;
const getStudentQrPath = (studentId) => path.join(QR_OUTPUT_DIR, getStudentQrFilename(studentId));

const writeStudentQr = async (student) => {
  if (!student || !student.id || !student.qr_token) {
    return null;
  }

  const qrPath = getStudentQrPath(student.id);
  const qrBuffer = await QRCode.toBuffer(student.qr_token, QR_OPTIONS);
  const qrImage = await Jimp.read(qrBuffer);
  const labelHeight = 60;
  const width = qrImage.getWidth();
  const height = qrImage.getHeight() + labelHeight;
  const labeledImage = new Jimp(width, height, 0xffffffff);

  labeledImage.composite(qrImage, 0, 0);

  const font = await getQrLabelFont();
  const label = (student.name || `Student ${student.id}`).trim();

  labeledImage.print(
    font,
    0,
    qrImage.getHeight(),
    {
      text: label,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
      alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
    },
    width,
    labelHeight
  );

  await labeledImage.writeAsync(qrPath);
  return qrPath;
};

const ensureStudentQr = async (student) => {
  if (!student) return null;
  const qrPath = getStudentQrPath(student.id);
  try {
    await fs.promises.access(qrPath, fs.constants.F_OK);
    return qrPath;
  } catch {
    return writeStudentQr(student);
  }
};

const buildQrDownloadName = (student) => `${sanitizeFileComponent(student?.name)}-${student?.id}.png`;

let qrFontPromise = null;
const getQrLabelFont = () => {
  if (!qrFontPromise) {
    qrFontPromise = Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
  }
  return qrFontPromise;
};

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
let db = new Database(DB_FILE);

const findClassByName = (className) => {
  if (!className) {
    return null;
  }
  return db.prepare('SELECT * FROM classes WHERE name = ?').get(className);
};

const setupDatabase = (database) => {
  database.exec(`
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

  const adminExists = database.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const adminHash = bcrypt.hashSync('admin123', 10);
    database.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', adminHash, 'admin');
  }

  const defaultClasses = ['Grade 6', 'Grade 7', 'Grade 8', 'O/L'];
  defaultClasses.forEach(className => {
    const exists = database.prepare('SELECT id FROM classes WHERE name = ?').get(className);
    if (!exists) {
      database.prepare('INSERT INTO classes (name, monthly_fee) VALUES (?, ?)').run(className, 2000);
    }
  });

  const slotsExist = database.prepare('SELECT id FROM exam_slots').get();
  if (!slotsExist) {
    database.prepare(`
      INSERT INTO exam_slots (label, start_time, end_time, max_seats) 
      VALUES (?, ?, ?, ?)
    `).run('Session 1', '2024-12-05T14:00:00', '2024-12-05T17:00:00', seatLayoutConfig.totalSeats);
    
    database.prepare(`
      INSERT INTO exam_slots (label, start_time, end_time, max_seats) 
      VALUES (?, ?, ?, ?)
    `).run('Session 2', '2024-12-05T17:30:00', '2024-12-05T20:30:00', seatLayoutConfig.totalSeats);
  }

  database.prepare('UPDATE exam_slots SET max_seats = ?').run(seatLayoutConfig.totalSeats);
};

setupDatabase(db);

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
    
    await ensureStudentQr(student);

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

app.get('/api/students/by-phone/:phone', requireAdmin, (req, res) => {
  const rawPhone = (req.params.phone || '').trim();
  if (!rawPhone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  const compactPhone = rawPhone.replace(/\s+/g, '');
  const numericPhone = rawPhone.replace(/[^0-9+]/g, '');

  let student = db.prepare('SELECT * FROM students WHERE phone = ?').get(rawPhone);
  if (!student && compactPhone !== rawPhone) {
    student = db.prepare('SELECT * FROM students WHERE phone = ?').get(compactPhone);
  }
  if (!student && numericPhone && numericPhone !== rawPhone && numericPhone !== compactPhone) {
    student = db.prepare('SELECT * FROM students WHERE phone = ?').get(numericPhone);
  }

  if (!student) {
    return res.status(404).json({ error: 'Student not found for that phone number' });
  }

  const classRecord = findClassByName(student.grade);
  res.json({
    id: student.id,
    name: student.name,
    phone: student.phone,
    grade: student.grade,
    qr_token: student.qr_token,
    class_id: classRecord ? classRecord.id : null,
    class_name: classRecord ? classRecord.name : null,
    monthly_fee: classRecord ? classRecord.monthly_fee : null
  });
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
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(result.lastInsertRowid);

    // Create student login account
    const defaultPassword = '1234';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    db.prepare('INSERT INTO users (username, password_hash, role, student_id) VALUES (?, ?, ?, ?)').run(phone, passwordHash, 'student', result.lastInsertRowid);

    await ensureStudentQr(student);
    
    res.json(student);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/students/qr/bulk', requireAdmin, async (req, res) => {
  try {
    const students = db.prepare('SELECT * FROM students ORDER BY name').all();
    
    if (!students.length) {
      return res.status(404).json({ error: 'No students found' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="student-qr-codes-${Date.now()}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('QR archive error:', err);
      res.end();
    });

    archive.pipe(res);

    for (const student of students) {
      await ensureStudentQr(student);
      archive.file(getStudentQrPath(student.id), { name: buildQrDownloadName(student) });
    }

    await archive.finalize();
  } catch (err) {
    console.error('Bulk QR download error:', err);
    res.status(500).json({ error: 'Failed to prepare QR archive' });
  }
});

app.get('/api/students/:id/qr', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    await ensureStudentQr(student);
    res.download(getStudentQrPath(student.id), buildQrDownloadName(student));
  } catch (err) {
    console.error('Single QR download error:', err);
    res.status(500).json({ error: 'Failed to prepare QR code' });
  }
});

app.put('/api/students/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, phone, grade } = req.body;
  
  try {
    db.prepare('UPDATE students SET name = ?, phone = ?, grade = ? WHERE id = ?').run(name, phone, grade, id);
    const updatedStudent = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    if (updatedStudent) {
      await ensureStudentQr(updatedStudent);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/students/:id', requireAdmin, async (req, res) => {
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
    // Delete exam bookings
    db.prepare('DELETE FROM exam_bookings WHERE student_id = ?').run(id);
    // Delete student
    db.prepare('DELETE FROM students WHERE id = ?').run(id);

    try {
      await fs.promises.unlink(getStudentQrPath(id));
    } catch (_) {
      // Ignore missing file
    }
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

// API: Settings - Database backup/restore
app.get('/api/settings/database/download', requireAdmin, (req, res) => {
  res.download(DB_FILE, `class-manager-${Date.now()}.db`, (err) => {
    if (err) {
      console.error('Database download error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to download database' });
      }
    }
  });
});

app.post('/api/settings/database/upload', requireAdmin, upload.single('dbFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Database file is required' });
  }

  const tempPath = req.file.path;
  let databaseReopened = false;
  let backupPath = null;

  try {
    const uploadedDb = new Database(tempPath, { readonly: true });
    uploadedDb.prepare('SELECT name FROM sqlite_master LIMIT 1').get();
    uploadedDb.close();

    const backupName = `class_manager-backup-${Date.now()}.db`;
    backupPath = path.join(DB_BACKUP_DIR, backupName);
    await fs.promises.copyFile(DB_FILE, backupPath);

    if (db) {
      db.close();
    }

    await fs.promises.copyFile(tempPath, DB_FILE);
    db = new Database(DB_FILE);
    setupDatabase(db);
    databaseReopened = true;

    res.json({ success: true, backup: backupName });
  } catch (err) {
    console.error('Database upload error:', err);
    if (backupPath) {
      try {
        await fs.promises.copyFile(backupPath, DB_FILE);
      } catch (restoreErr) {
        console.error('Failed to restore database after upload error:', restoreErr);
      }
    }
    if (!databaseReopened) {
      try {
        db = new Database(DB_FILE);
        setupDatabase(db);
      } catch (reopenErr) {
        console.error('Failed to reopen database after upload error:', reopenErr);
      }
    }
    res.status(500).json({ error: 'Failed to upload database' });
  } finally {
    fs.promises.unlink(tempPath).catch(() => {});
  }
});

// API: Exam Slots
app.get('/api/exam/slots', requireAuth, (req, res) => {
  const slots = db.prepare('SELECT * FROM exam_slots ORDER BY start_time').all().map(slot => ({
    ...slot,
    max_seats: seatLayoutConfig.totalSeats
  }));
  res.json(slots);
});

app.get('/api/exam/slots/:id/layout', requireAuth, (req, res) => {
  const { id } = req.params;
  const slotRecord = db.prepare('SELECT * FROM exam_slots WHERE id = ?').get(id);
  
  if (!slotRecord) {
    return res.status(404).json({ error: 'Slot not found' });
  }
  const slot = { ...slotRecord, max_seats: seatLayoutConfig.totalSeats };
  
  const bookings = db.prepare(`
    SELECT eb.*, s.grade as student_grade
    FROM exam_bookings eb
    LEFT JOIN students s ON eb.student_id = s.id
    WHERE eb.slot_id = ?
  `).all(id);
  
  res.json({ slot, bookings, layout: seatLayoutConfig });
});

app.delete('/api/exam/bookings/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const booking = db.prepare('SELECT * FROM exam_bookings WHERE id = ?').get(id);
  
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  
  db.prepare('DELETE FROM exam_bookings WHERE id = ?').run(id);
  res.json({ success: true });
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
  
  // Validate seat position using layout configuration
  if (!seatLayoutConfig.isValidSeat(seat_index, seat_pos)) {
    return res.status(400).json({ error: 'Invalid seat position' });
  }
  
  // Check if student already has a booking in any session
  const existing = db.prepare(`
    SELECT eb.*, es.label 
    FROM exam_bookings eb
    JOIN exam_slots es ON eb.slot_id = es.id
    WHERE eb.student_id = ?
    LIMIT 1
  `).get(studentId);
  
  if (existing) {
    return res.status(400).json({ error: `You already have a booking for ${existing.label}. Students are limited to one seat overall.` });
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
  if (seat_pos > 1) {
    adjacentSeats.push({ row: seat_index, col: seat_pos - 1 }); // Left
  }
  const currentRowSeats = seatLayoutConfig.getSeatsForRow(seat_index);
  if (seat_pos < currentRowSeats) {
    adjacentSeats.push({ row: seat_index, col: seat_pos + 1 }); // Right
  }
  
  // Vertical neighbors (same column, different row)
  // Check row above using layout configuration
  const rowAbove = seat_index - 1;
  if (rowAbove >= 1) {
    const rowAboveSeats = seatLayoutConfig.getSeatsForRow(rowAbove);
    // Only check if the column exists in the row above
    if (seat_pos <= rowAboveSeats) {
      adjacentSeats.push({ row: rowAbove, col: seat_pos }); // Above
    }
  }
  // Check row below using layout configuration
  const rowBelow = seat_index + 1;
  const rowBelowSeats = seatLayoutConfig.getSeatsForRow(rowBelow);
  if (rowBelowSeats > 0) {
    // Only check if the column exists in the row below
    if (seat_pos <= rowBelowSeats) {
      adjacentSeats.push({ row: rowBelow, col: seat_pos }); // Below
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
