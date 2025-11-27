let qrCodeScanner = null;
const currentDate = new Date().toISOString().split('T')[0];
const currentMonth = new Date().toISOString().slice(0, 7);
document.getElementById('attendanceDate').value = currentDate;
const manualAttendanceDateInput = document.getElementById('manualAttendanceDate');
if (manualAttendanceDateInput) {
    manualAttendanceDateInput.value = currentDate;
}
const quickFeeMonthInput = document.getElementById('quickFeeMonth');
if (quickFeeMonthInput && !quickFeeMonthInput.value) {
    quickFeeMonthInput.value = currentMonth;
}
let manualAttendanceStudent = null;
let quickFeeStudent = null;

// Tab switching
function showTab(tabName) {
    // Stop QR scanner if leaving QR scanner tab
    if (qrCodeScanner && document.getElementById('qr-scanner').classList.contains('active')) {
        qrCodeScanner.stop().then(() => {
            qrCodeScanner.clear();
        }).catch(() => {});
        qrCodeScanner = null;
    }
    
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    document.getElementById(tabName).classList.add('active');
    event.target.classList.add('active');
    
    // Load data when switching tabs
    if (tabName === 'dashboard') {
        loadDashboard();
    } else if (tabName === 'students') {
        loadStudents();
    } else if (tabName === 'classes') {
        loadClasses();
    } else if (tabName === 'qr-scanner') {
        initQRScanner();
        initManualAttendanceForm();
    } else if (tabName === 'attendance') {
        loadAttendance();
    } else if (tabName === 'payments') {
        loadPayments();
    } else if (tabName === 'unpaid') {
        const month = new Date().toISOString().slice(0, 7);
        document.getElementById('unpaidMonth').value = month;
        loadUnpaid();
    } else if (tabName === 'finance') {
        const month = new Date().toISOString().slice(0, 7);
        document.getElementById('financeMonth').value = month;
        loadFinance();
    } else if (tabName === 'exam-admin') {
        loadExamSlots();
    } else if (tabName === 'settings') {
        resetSettingsStatus();
    }
}

// Logout
async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/';
}

// Dashboard
async function loadDashboard() {
    try {
        const [students, classes, finance] = await Promise.all([
            fetch('/api/students').then(r => r.json()),
            fetch('/api/classes').then(r => r.json()),
            fetch(`/api/finance?month=${new Date().toISOString().slice(0, 7)}`).then(r => r.json())
        ]);
        
        document.getElementById('totalStudents').textContent = students.length;
        document.getElementById('totalClasses').textContent = classes.length;
        
        // Today's attendance
        const today = new Date().toISOString().split('T')[0];
        let todayCount = 0;
        for (const cls of classes) {
            try {
                const att = await fetch(`/api/attendance?class_id=${cls.id}&date=${today}`).then(r => r.json());
                todayCount += att.filter(a => a.present).length;
            } catch (e) {}
        }
        document.getElementById('todayAttendance').textContent = todayCount;
        
        document.getElementById('monthRevenue').textContent = finance.grand_total + ' LKR';
    } catch (err) {
        console.error('Dashboard load error:', err);
    }
}

// Students
async function loadStudents() {
    try {
        const students = await fetch('/api/students').then(r => r.json());
        const tbody = document.getElementById('studentsTable');
        tbody.innerHTML = students.map(s => `
            <tr>
                <td>${s.id}</td>
                <td>${s.name}</td>
                <td>${s.phone}</td>
                <td>${s.grade}</td>
                <td style="font-size: 12px;">${s.qr_token}</td>
                <td>
                    <button class="btn-edit" onclick="editStudent(${s.id})">Edit</button>
                    <button class="btn-secondary" onclick="downloadStudentQR(${s.id})">Download QR</button>
                    <button class="btn-danger" onclick="deleteStudent(${s.id})">Delete</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Students load error:', err);
    }
}

function showAddStudentForm() {
    document.getElementById('studentModalTitle').textContent = 'Add Student';
    document.getElementById('studentForm').reset();
    document.getElementById('studentId').value = '';
    document.getElementById('studentModal').style.display = 'block';
}

function editStudent(id) {
    fetch('/api/students')
        .then(r => r.json())
        .then(students => {
            const student = students.find(s => s.id === id);
            if (student) {
                document.getElementById('studentModalTitle').textContent = 'Edit Student';
                document.getElementById('studentId').value = student.id;
                document.getElementById('studentName').value = student.name;
                document.getElementById('studentPhone').value = student.phone;
                document.getElementById('studentGrade').value = student.grade;
                document.getElementById('studentModal').style.display = 'block';
            }
        });
}

async function saveStudent(event) {
    event.preventDefault();
    const id = document.getElementById('studentId').value;
    const data = {
        name: document.getElementById('studentName').value,
        phone: document.getElementById('studentPhone').value,
        grade: document.getElementById('studentGrade').value
    };
    
    try {
        if (id) {
            await fetch(`/api/students/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } else {
            await fetch('/api/students', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        }
        closeModal('studentModal');
        loadStudents();
    } catch (err) {
        alert('Error saving student: ' + err.message);
    }
}

async function deleteStudent(id) {
    if (!confirm('Are you sure you want to delete this student?')) return;
    
    try {
        await fetch(`/api/students/${id}`, { method: 'DELETE' });
        loadStudents();
    } catch (err) {
        alert('Error deleting student: ' + err.message);
    }
}

function getFilenameFromDisposition(disposition, fallback) {
    if (!disposition) return fallback;
    const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(disposition);
    if (match && match[1]) {
        try {
            return decodeURIComponent(match[1]);
        } catch (_) {
            return match[1];
        }
    }
    return fallback;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function downloadStudentQR(id) {
    try {
        const res = await fetch(`/api/students/${id}/qr`, { credentials: 'include' });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Unable to download QR');
        }
        const blob = await res.blob();
        const filename = getFilenameFromDisposition(res.headers.get('content-disposition'), `student-${id}-qr.png`);
        downloadBlob(blob, filename);
    } catch (err) {
        alert('Error downloading QR: ' + err.message);
    }
}

async function downloadAllStudentQRs() {
    try {
        const res = await fetch('/api/students/qr/bulk', { credentials: 'include' });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Unable to download QR archive');
        }
        const blob = await res.blob();
        const filename = getFilenameFromDisposition(res.headers.get('content-disposition'), 'student-qrs.zip');
        downloadBlob(blob, filename);
    } catch (err) {
        alert('Error downloading QR archive: ' + err.message);
    }
}

// Classes
async function loadClasses() {
    try {
        const classes = await fetch('/api/classes').then(r => r.json());
        const tbody = document.getElementById('classesTable');
        tbody.innerHTML = classes.map(c => `
            <tr>
                <td>${c.id}</td>
                <td>${c.name}</td>
                <td>${c.monthly_fee} LKR</td>
                <td>
                    <button class="btn-edit" onclick="editClass(${c.id})">Edit</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Classes load error:', err);
    }
}

function showAddClassForm() {
    document.getElementById('classModalTitle').textContent = 'Add Class';
    document.getElementById('classForm').reset();
    document.getElementById('classId').value = '';
    document.getElementById('classModal').style.display = 'block';
}

function editClass(id) {
    fetch('/api/classes')
        .then(r => r.json())
        .then(classes => {
            const cls = classes.find(c => c.id === id);
            if (cls) {
                document.getElementById('classModalTitle').textContent = 'Edit Class';
                document.getElementById('classId').value = cls.id;
                document.getElementById('className').value = cls.name;
                document.getElementById('classFee').value = cls.monthly_fee;
                document.getElementById('classModal').style.display = 'block';
            }
        });
}

async function saveClass(event) {
    event.preventDefault();
    const id = document.getElementById('classId').value;
    const data = {
        name: document.getElementById('className').value,
        monthly_fee: parseInt(document.getElementById('classFee').value)
    };
    
    try {
        if (id) {
            await fetch(`/api/classes/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } else {
            await fetch('/api/classes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        }
        closeModal('classModal');
        loadClasses();
    } catch (err) {
        alert('Error saving class: ' + err.message);
    }
}

// QR Scanner
function initQRScanner() {
    if (qrCodeScanner) {
        qrCodeScanner.stop().then(() => {
            qrCodeScanner.clear();
        }).catch(() => {});
        qrCodeScanner = null;
    }
    
    const qrReader = document.getElementById('qr-reader');
    qrReader.innerHTML = '';
    
    try {
        qrCodeScanner = new Html5Qrcode("qr-reader");
        qrCodeScanner.start(
            { facingMode: "environment" },
            {
                fps: 10,
                qrbox: { width: 250, height: 250 }
            },
            (decodedText) => {
                handleQRScan(decodedText);
            },
            (errorMessage) => {
                // Ignore errors
            }
        ).catch(err => {
            console.error('QR Scanner error:', err);
            document.getElementById('qr-reader').innerHTML = '<p style="color: #f87171;">Camera access denied or not available. Please allow camera permissions.</p>';
        });
    } catch (err) {
        console.error('QR Scanner initialization error:', err);
        document.getElementById('qr-reader').innerHTML = '<p style="color: #f87171;">QR Scanner not available. Please check browser compatibility.</p>';
    }
}

async function handleQRScan(token) {
    try {
        const res = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        
        const data = await res.json();
        
        if (res.ok) {
            const resultDiv = document.getElementById('scan-result');
            resultDiv.innerHTML = `
                <h3 style="color: #4ade80;">✓ Scan Successful</h3>
                <p><strong>Student:</strong> ${data.student_name}</p>
                <p><strong>Class:</strong> ${data.class}</p>
                <p><strong>Payment Status:</strong> <span style="color: ${data.payment_status === 'paid' ? '#4ade80' : '#f87171'}">${data.payment_status.toUpperCase()}</span></p>
            `;
            
            // Play beep sound
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUKjj8LZjHAY4kdfyzHksBSR3x/DdkEAKFF606euoVRQKRp/g8r5sIQUqgc7y2Yk2CBtpvfDknE4MDlCo4/C2YxwGOJHX8sx5LAUkd8fw3ZBACBRdtOnrqFUUCkaf4PK+bCEFKoHO8tmJNggbab3w5JxODA5QqOPwtmMcBjiR1/LMeSwFJHfH8N2QQAgUXbTp66hVFApGn+DyvmwhBSqBzvLZiTYIG2m98OScTgwOUKjj8LZjHAY4kdfyzHksBSR3x/DdkEA=');
            audio.play().catch(() => {});
        } else {
            document.getElementById('scan-result').innerHTML = `<p style="color: #f87171;">Error: ${data.error}</p>`;
        }
    } catch (err) {
        document.getElementById('scan-result').innerHTML = `<p style="color: #f87171;">Error: ${err.message}</p>`;
    }
}

// Manual Attendance / Quick Fee helpers (within QR tab)
function initManualAttendanceForm() {
    const today = new Date().toISOString().split('T')[0];
    const manualDate = document.getElementById('manualAttendanceDate');
    if (manualDate) {
        manualDate.value = today;
    }
    const quickFeeMonth = document.getElementById('quickFeeMonth');
    if (quickFeeMonth) {
        quickFeeMonth.value = new Date().toISOString().slice(0, 7);
    }
    manualAttendanceStudent = null;
    quickFeeStudent = null;
    updateStudentInfoPanel('manualAttendanceStudentInfo', null);
    updateStudentInfoPanel('quickFeeStudentInfo', null);
    setManualAttendanceStatus('', '');
    setQuickFeeStatus('', '');
}

function normalizePhone(phoneValue) {
    return (phoneValue || '').trim().replace(/\s+/g, '');
}

async function fetchStudentByPhone(phoneValue) {
    const normalized = normalizePhone(phoneValue);
    if (!normalized) {
        throw new Error('Phone number is required');
    }
    const res = await fetch(`/api/students/by-phone/${encodeURIComponent(normalized)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || 'Student lookup failed');
    }
    return data;
}

function updateStudentInfoPanel(elementId, student) {
    const panel = document.getElementById(elementId);
    if (!panel) return;
    
    if (!student) {
        panel.innerHTML = '';
        panel.classList.add('hidden');
        return;
    }
    
    const classLine = student.class_name
        ? `Class: ${student.class_name}`
        : '<span style="color:#f87171;">No class linked to this grade</span>';
    const feeLine = student.monthly_fee ? `<p>Monthly Fee: ${student.monthly_fee} LKR</p>` : '';
    
    panel.innerHTML = `
        <p><strong>${student.name}</strong> (${student.phone})</p>
        <p>Grade: ${student.grade}</p>
        <p>${classLine}</p>
        ${feeLine}
    `;
    panel.classList.remove('hidden');
}

async function lookupManualAttendanceStudent() {
    const phoneInput = document.getElementById('manualAttendancePhone');
    if (!phoneInput) return;
    
    setManualAttendanceStatus('Searching student...', 'pending');
    try {
        const student = await fetchStudentByPhone(phoneInput.value);
        manualAttendanceStudent = student;
        updateStudentInfoPanel('manualAttendanceStudentInfo', student);
        setManualAttendanceStatus('Student ready. Choose a date to mark attendance.', 'success');
    } catch (err) {
        manualAttendanceStudent = null;
        updateStudentInfoPanel('manualAttendanceStudentInfo', null);
        setManualAttendanceStatus(err.message, 'error');
    }
}

async function submitManualAttendance(present) {
    const date = document.getElementById('manualAttendanceDate').value;
    
    if (!manualAttendanceStudent) {
        setManualAttendanceStatus('Lookup a student first.', 'error');
        return;
    }
    if (!manualAttendanceStudent.class_id) {
        setManualAttendanceStatus('No class is linked to this student\'s grade.', 'error');
        return;
    }
    if (!date) {
        setManualAttendanceStatus('Select a date before marking attendance.', 'error');
        return;
    }
    
    setManualAttendanceStatus('Saving attendance...', 'pending');
    try {
        await fetch('/api/attendance/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student_id: manualAttendanceStudent.id,
                class_id: manualAttendanceStudent.class_id,
                date,
                present: !!present
            })
        });
        setManualAttendanceStatus(present ? 'Marked as present.' : 'Marked as absent.', 'success');
    } catch (err) {
        setManualAttendanceStatus(`Error: ${err.message}`, 'error');
    }
}

function setManualAttendanceStatus(message, state) {
    const statusEl = document.getElementById('manualAttendanceStatus');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.dataset.status = state || '';
}

async function lookupQuickFeeStudent() {
    const phoneInput = document.getElementById('quickFeePhone');
    if (!phoneInput) return;
    
    setQuickFeeStatus('Searching student...', 'pending');
    try {
        const student = await fetchStudentByPhone(phoneInput.value);
        quickFeeStudent = student;
        updateStudentInfoPanel('quickFeeStudentInfo', student);
        if (student.monthly_fee) {
            document.getElementById('quickFeeAmount').value = student.monthly_fee;
        }
        const monthInput = document.getElementById('quickFeeMonth');
        if (monthInput && !monthInput.value) {
            monthInput.value = new Date().toISOString().slice(0, 7);
        }
        setQuickFeeStatus('Student ready for fee entry.', 'success');
    } catch (err) {
        quickFeeStudent = null;
        updateStudentInfoPanel('quickFeeStudentInfo', null);
        setQuickFeeStatus(err.message, 'error');
    }
}

function setQuickFeeStatus(message, state) {
    const statusEl = document.getElementById('quickFeeStatus');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.dataset.status = state || '';
}

async function submitQuickFee() {
    if (!quickFeeStudent) {
        setQuickFeeStatus('Lookup a student first.', 'error');
        return;
    }
    if (!quickFeeStudent.class_id) {
        setQuickFeeStatus('No class is linked to this student\'s grade.', 'error');
        return;
    }
    
    const monthInput = document.getElementById('quickFeeMonth');
    const amountInput = document.getElementById('quickFeeAmount');
    const methodSelect = document.getElementById('quickFeeMethod');
    
    const month = (monthInput.value || '').trim();
    if (!month) {
        setQuickFeeStatus('Enter the month in YYYY-MM format.', 'error');
        return;
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
        setQuickFeeStatus('Month must follow YYYY-MM (e.g., 2024-12).', 'error');
        return;
    }
    
    const amountValue = amountInput.value || quickFeeStudent.monthly_fee;
    const amount = parseInt(amountValue, 10);
    if (!amount || amount <= 0) {
        setQuickFeeStatus('Enter a valid amount.', 'error');
        return;
    }
    
    const method = methodSelect.value || 'cash';
    
    setQuickFeeStatus('Recording payment...', 'pending');
    try {
        await fetch('/api/payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student_id: quickFeeStudent.id,
                class_id: quickFeeStudent.class_id,
                month,
                amount,
                method
            })
        });
        setQuickFeeStatus('Payment recorded successfully.', 'success');
    } catch (err) {
        setQuickFeeStatus(`Error: ${err.message}`, 'error');
    }
}

// Attendance
async function loadAttendance() {
    const classId = document.getElementById('attendanceClassSelect').value;
    const date = document.getElementById('attendanceDate').value;
    
    if (!classId || !date) {
        document.getElementById('attendanceTable').innerHTML = '';
        return;
    }
    
    try {
        const classes = await fetch('/api/classes').then(r => r.json());
        const classSelect = document.getElementById('attendanceClassSelect');
        classSelect.innerHTML = '<option value="">-- Select Class --</option>' + 
            classes.map(c => `<option value="${c.id}" ${c.id == classId ? 'selected' : ''}>${c.name}</option>`).join('');
        
        const attendance = await fetch(`/api/attendance?class_id=${classId}&date=${date}`).then(r => r.json());
        const tbody = document.getElementById('attendanceTable');
        tbody.innerHTML = attendance.map(a => `
            <tr>
                <td>${a.name}</td>
                <td>${a.phone}</td>
                <td>${a.present ? '<span style="color: #4ade80;">Present</span>' : '<span style="color: #f87171;">Absent</span>'}</td>
                <td>
                    <button class="btn-primary" onclick="toggleAttendance(${a.id}, ${classId}, '${date}', ${a.present ? 0 : 1})">
                        Mark ${a.present ? 'Absent' : 'Present'}
                    </button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Attendance load error:', err);
    }
}

async function toggleAttendance(studentId, classId, date, present) {
    try {
        await fetch('/api/attendance/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_id: studentId, class_id: classId, date, present: !!present })
        });
        loadAttendance();
    } catch (err) {
        alert('Error updating attendance: ' + err.message);
    }
}

// Payments
async function loadPayments() {
    const students = await fetch('/api/students').then(r => r.json());
    const classes = await fetch('/api/classes').then(r => r.json());
    
    const studentSelect = document.getElementById('paymentStudentSelect');
    studentSelect.innerHTML = '<option value="">-- Select Student --</option>' + 
        students.map(s => `<option value="${s.id}">${s.name} (${s.phone})</option>`).join('');
    
    const classSelect = document.getElementById('paymentClassSelect');
    classSelect.innerHTML = '<option value="">-- Select Class --</option>' + 
        classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

async function recordPayment() {
    const data = {
        student_id: parseInt(document.getElementById('paymentStudentSelect').value),
        class_id: parseInt(document.getElementById('paymentClassSelect').value),
        month: document.getElementById('paymentMonth').value,
        amount: parseInt(document.getElementById('paymentAmount').value),
        method: document.getElementById('paymentMethod').value
    };
    
    if (!data.student_id || !data.class_id || !data.month || !data.amount) {
        alert('Please fill all fields');
        return;
    }
    
    try {
        await fetch('/api/payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        alert('Payment recorded successfully');
        document.getElementById('paymentStudentSelect').value = '';
        document.getElementById('paymentClassSelect').value = '';
        document.getElementById('paymentMonth').value = '';
        document.getElementById('paymentAmount').value = '';
    } catch (err) {
        alert('Error recording payment: ' + err.message);
    }
}

// Unpaid
async function loadUnpaid() {
    const month = document.getElementById('unpaidMonth').value;
    if (!month) return;
    
    try {
        const unpaid = await fetch(`/api/unpaid?month=${month}`).then(r => r.json());
        const tbody = document.getElementById('unpaidTable');
        tbody.innerHTML = unpaid.map(u => `
            <tr>
                <td>${u.name}</td>
                <td>${u.phone}</td>
                <td>${u.class_name}</td>
                <td>${u.monthly_fee} LKR</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Unpaid load error:', err);
    }
}

// Finance
async function loadFinance() {
    const month = document.getElementById('financeMonth').value;
    if (!month) return;
    
    try {
        const finance = await fetch(`/api/finance?month=${month}`).then(r => r.json());
        const tbody = document.getElementById('financeTable');
        tbody.innerHTML = finance.classes.map(f => `
            <tr>
                <td>${f.class_name}</td>
                <td>${f.payment_count}</td>
                <td>${f.total_revenue} LKR</td>
            </tr>
        `).join('');
        document.getElementById('grandTotal').textContent = finance.grand_total;
    } catch (err) {
        console.error('Finance load error:', err);
    }
}

// Exam Admin
async function loadExamSlots() {
    try {
        const slots = await fetch('/api/exam/slots').then(r => r.json());
        const container = document.getElementById('examSlotsList');
        container.innerHTML = '<h3>Exam Sessions</h3>' + slots.map(slot => `
            <div style="margin: 15px 0; padding: 15px; background: #1e293b; border-radius: 8px;">
                <h4>${slot.label}</h4>
                <p>${new Date(slot.start_time).toLocaleString()} - ${new Date(slot.end_time).toLocaleString()}</p>
                <p>Max Seats: ${slot.max_seats}</p>
                <button class="btn-primary" onclick="loadExamLayout(${slot.id})">View Seat Layout</button>
            </div>
        `).join('');
    } catch (err) {
        console.error('Exam slots load error:', err);
    }
}

async function loadExamLayout(slotId) {
    try {
        const data = await fetch(`/api/exam/slots/${slotId}/layout`).then(r => r.json());
        const container = document.getElementById('examLayoutContainer');
        
        const bookings = data.bookings;
        const layout = data.layout || { 
            rows: [
                { row: 1, seats: 4, seatFlow: 'row', labelPosition: 'right', section: 'main' },
                { row: 2, seats: 4, seatFlow: 'row', labelPosition: 'right', section: 'main' },
                { row: 3, seats: 4, seatFlow: 'row', labelPosition: 'right', section: 'main' },
                { row: 4, seats: 4, seatFlow: 'row', labelPosition: 'right', section: 'main' },
                { row: 5, seats: 4, seatFlow: 'row', labelPosition: 'right', section: 'main' },
                { row: 6, seats: 4, seatFlow: 'row', labelPosition: 'right', section: 'main' }
            ],
            visualSections: [
                { id: 'main-block', layout: 'column', rows: [6, 5, 4, 3, 2, 1] }
            ]
        };
        
        let html = `<h3 style="text-align: center; margin-bottom: 20px;">Seat Layout - ${data.slot.label}</h3>`;
        html += '<div class="seat-layout-wrapper">';
        html += '<div class="front-indicator">Front</div>';
        html += '<div class="seat-layout">';

        const layoutRows = layout.rows || [];
        const rowLookup = new Map(layoutRows.map(r => [r.row, r]));
        const visualSections = (layout.visualSections && layout.visualSections.length)
            ? layout.visualSections
            : [{ id: 'default', layout: 'column', rows: layoutRows.map(r => r.row) }];
        
        visualSections.forEach(section => {
            const sectionClasses = ['seat-section'];
            if (section.id) sectionClasses.push(`section-${section.id}`);
            if (section.layout) sectionClasses.push(`section-${section.layout}`);
            
            html += `<div class="${sectionClasses.join(' ')}">`;
            
            const sectionRows = (section.rows && section.rows.length) ? section.rows : layoutRows.map(r => r.row);
            sectionRows.forEach(rowNumber => {
                const rowConfig = rowLookup.get(rowNumber);
                if (!rowConfig || !rowConfig.seats) {
                    return;
                }
                
                const seatFlow = rowConfig.seatFlow === 'column' ? 'vertical' : 'horizontal';
                const labelPosition = rowConfig.labelPosition || 'left';
                const rowClasses = [
                    'seat-row',
                    `label-${labelPosition}`,
                    seatFlow === 'vertical' ? 'row-vertical' : 'row-horizontal',
                    rowConfig.section ? `section-${rowConfig.section}-row` : ''
                ].filter(Boolean);
                
                html += `<div class="${rowClasses.join(' ')}">`;
                html += `<div class="row-label">Row ${rowConfig.row}</div>`;
                html += `<div class="seats-group ${seatFlow}">`;
                for (let col = 1; col <= rowConfig.seats; col++) {
                    const booking = bookings.find(b => b.seat_index === rowConfig.row && b.seat_pos === col);
                    let seatClass = 'empty';
                    let seatContent = `<div class="seat-number">${rowConfig.row}-${col}</div>`;
                    
                    if (booking) {
                        seatClass = booking.student_class === 'Grade 7' ? 'grade7' : 'grade8';
                        seatContent = `<div class="seat-number">${rowConfig.row}-${col}</div><div class="seat-name">${booking.student_name}</div><div class="seat-grade">${booking.student_class}</div>`;
                    }
                    
                    html += `<div class="seat ${seatClass}" title="${booking ? `Seat ${rowConfig.row}-${col}: ${booking.student_name} (${booking.student_class})` : `Seat ${rowConfig.row}-${col}: Available`}">${seatContent}</div>`;
                }
                html += '</div>';
                html += '</div>';
            });
            
            html += '</div>';
        });
        
        html += '</div>';
        html += '<div class="legend" style="margin-top: 30px; padding: 20px; background: #1e293b; border-radius: 8px;">';
        html += '<h3 style="margin-bottom: 15px; color: #60a5fa;">Legend</h3>';
        html += '<div style="display: flex; gap: 20px; flex-wrap: wrap;">';
        html += '<div style="display: flex; align-items: center; gap: 10px;"><div class="seat empty" style="width: 40px; height: 40px; cursor: default;"></div><span>Available</span></div>';
        html += '<div style="display: flex; align-items: center; gap: 10px;"><div class="seat grade7" style="width: 40px; height: 40px; cursor: default;"></div><span>Grade 7</span></div>';
        html += '<div style="display: flex; align-items: center; gap: 10px;"><div class="seat grade8" style="width: 40px; height: 40px; cursor: default;"></div><span>Grade 8</span></div>';
        html += '</div>';
        html += '</div>';
        
        // Add booking details table
        if (bookings.length > 0) {
            html += '<div style="margin-top: 30px;"><h3>Booking Details</h3>';
            html += '<div class="table-container"><table><thead><tr><th>Seat</th><th>Student Name</th><th>Grade</th><th>Actions</th></tr></thead><tbody>';
            
            bookings.forEach(booking => {
                html += `<tr>
                    <td>Row ${booking.seat_index}, Column ${booking.seat_pos}</td>
                    <td>${booking.student_name}</td>
                    <td>${booking.student_class}</td>
                    <td><button class="btn-danger" onclick="deleteBooking(${booking.id}, ${slotId})">Remove</button></td>
                </tr>`;
            });
            
            html += '</tbody></table></div></div>';
        }
        
        html += '</div>';
        container.innerHTML = html;
    } catch (err) {
        console.error('Exam layout load error:', err);
    }
}

async function deleteBooking(bookingId, slotId) {
    if (!confirm('Remove this booking and free the seat?')) {
        return;
    }
    try {
        const res = await fetch(`/api/exam/bookings/${bookingId}`, { method: 'DELETE', credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || 'Failed to remove booking');
        }
        loadExamLayout(slotId);
    } catch (err) {
        alert('Error deleting booking: ' + err.message);
    }
}

// Modal
function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
}

// Settings helpers
function resetSettingsStatus() {
    const statusEl = document.getElementById('databaseUploadStatus');
    if (statusEl) {
        statusEl.textContent = '';
        statusEl.dataset.status = '';
    }
}

async function downloadDatabase() {
    try {
        const res = await fetch('/api/settings/database/download');
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Unable to download database');
        }
        const blob = await res.blob();
        const filename = getFilenameFromDisposition(res.headers.get('content-disposition'), `class-manager-${Date.now()}.db`);
        downloadBlob(blob, filename);
    } catch (err) {
        alert('Error downloading database: ' + err.message);
    }
}

async function uploadDatabase() {
    const input = document.getElementById('databaseUploadInput');
    const statusEl = document.getElementById('databaseUploadStatus');
    if (!input || !input.files.length) {
        setStatus(statusEl, 'Please choose a .db file first.', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('dbFile', input.files[0]);
    setStatus(statusEl, 'Uploading database...', 'pending');
    
    try {
        const res = await fetch('/api/settings/database/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || 'Upload failed');
        }
        let message = 'Database restored successfully.';
        if (data.backup) {
            message += ` Backup saved as ${data.backup}.`;
        }
        setStatus(statusEl, message, 'success');
        input.value = '';
    } catch (err) {
        setStatus(statusEl, `Error: ${err.message}`, 'error');
    }
}

function setStatus(element, message, state) {
    if (!element) return;
    element.textContent = message || '';
    element.dataset.status = state || '';
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    loadStudents();
    loadClasses();
    loadPayments();
    initManualAttendanceForm();
});
