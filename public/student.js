let selectedSlotId = null;
let selectedSeatIndex = null;
let selectedSeatPos = null;
let currentBooking = null;
let studentGrade = null;

// Check if student can book
async function checkStudentAccess() {
    try {
        const res = await fetch('/api/exam/my-booking');
        const data = await res.json();
        currentBooking = data.booking;
        studentGrade = data.student ? data.student.grade : null;
        
        // Show message if not Grade 7 or 8
        if (studentGrade && studentGrade !== 'Grade 7' && studentGrade !== 'Grade 8') {
            document.getElementById('studentInfo').innerHTML = `
                <p style="color: #f87171;"><strong>Note:</strong> Only Grade 7 and Grade 8 students can book exam seats. Your grade is ${studentGrade}.</p>
            `;
            document.getElementById('sessionSelect').disabled = true;
        }
        
        loadSessions();
        if (currentBooking) {
            showCurrentBooking();
        }
    } catch (err) {
        console.error('Access check error:', err);
    }
}

// Load exam sessions
async function loadSessions() {
    try {
        const slots = await fetch('/api/exam/slots').then(r => r.json());
        const select = document.getElementById('sessionSelect');
        select.innerHTML = '<option value="">-- Select Session --</option>' + 
            slots.map(slot => `<option value="${slot.id}">${slot.label} (${new Date(slot.start_time).toLocaleString()} - ${new Date(slot.end_time).toLocaleString()})</option>`).join('');
    } catch (err) {
        console.error('Sessions load error:', err);
    }
}

// Load seat layout for selected session
async function loadSessionLayout() {
    const slotId = document.getElementById('sessionSelect').value;
    if (!slotId) {
        document.getElementById('seatLayoutContainer').innerHTML = '';
        document.getElementById('bookingControls').style.display = 'none';
        return;
    }
    
    selectedSlotId = parseInt(slotId);
    
    try {
        const data = await fetch(`/api/exam/slots/${slotId}/layout`).then(r => r.json());
        const container = document.getElementById('seatLayoutContainer');
        
        const maxSeats = data.slot.max_seats;
        const bookings = data.bookings;
        
        // Find student's own booking
        const ownBooking = currentBooking ? bookings.find(b => b.id === currentBooking.id) : null;
        
        let html = `<h2 style="margin-bottom: 20px;">Seat Layout - ${data.slot.label}</h2>`;
        html += '<div class="seat-layout">';
        
        for (let i = 1; i <= maxSeats; i++) {
            const benchBookings = bookings.filter(b => b.seat_index === i);
            html += '<div class="bench-row">';
            for (let pos = 1; pos <= 4; pos++) {
                const booking = benchBookings.find(b => b.seat_pos === pos);
                let seatClass = 'empty';
                let isOwn = false;
                
                if (booking) {
                    if (ownBooking && booking.id === ownBooking.id) {
                        seatClass = 'own-booking';
                        isOwn = true;
                    } else {
                        seatClass = booking.student_class === 'Grade 7' ? 'grade7' : 'grade8';
                    }
                }
                
                const seatId = `seat-${i}-${pos}`;
                html += `<div class="seat ${seatClass}" id="${seatId}" onclick="${!booking && !isOwn ? `selectSeat(${i}, ${pos})` : ''}" style="cursor: ${booking || isOwn ? 'not-allowed' : 'pointer'}">${i}-${pos}</div>`;
            }
            html += '</div>';
        }
        
        html += '</div>';
        container.innerHTML = html;
        
        // Reset selection
        selectedSeatIndex = null;
        selectedSeatPos = null;
        document.getElementById('bookingControls').style.display = 'none';
    } catch (err) {
        console.error('Layout load error:', err);
        alert('Error loading seat layout: ' + err.message);
    }
}

// Select a seat
function selectSeat(seatIndex, seatPos) {
    // Check if student is Grade 7 or 8
    if (studentGrade && studentGrade !== 'Grade 7' && studentGrade !== 'Grade 8') {
        alert('Only Grade 7 and Grade 8 students can book seats');
        return;
    }
    
    selectedSeatIndex = seatIndex;
    selectedSeatPos = seatPos;
    
    // Update UI
    document.querySelectorAll('.seat').forEach(seat => {
        seat.classList.remove('selected');
    });
    
    const seatEl = document.getElementById(`seat-${seatIndex}-${seatPos}`);
    if (seatEl && seatEl.classList.contains('empty')) {
        seatEl.classList.add('selected');
    }
    
    document.getElementById('selectedSeatInfo').textContent = `Selected Seat: Bench ${seatIndex}, Position ${seatPos}`;
    document.getElementById('bookingControls').style.display = 'block';
}

// Confirm booking
async function confirmBooking() {
    if (!selectedSlotId || !selectedSeatIndex || !selectedSeatPos) {
        alert('Please select a seat');
        return;
    }
    
    if (!confirm(`Confirm booking for Bench ${selectedSeatIndex}, Position ${selectedSeatPos}?`)) {
        return;
    }
    
    try {
        const res = await fetch('/api/exam/book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                slot_id: selectedSlotId,
                seat_index: selectedSeatIndex,
                seat_pos: selectedSeatPos
            })
        });
        
        const data = await res.json();
        
        if (res.ok) {
            alert('Booking confirmed successfully!');
            // Reload layout and booking info
            await checkStudentAccess();
            loadSessionLayout();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        alert('Error confirming booking: ' + err.message);
    }
}

// Show current booking
function showCurrentBooking() {
    if (currentBooking) {
        const infoDiv = document.getElementById('currentBooking');
        infoDiv.style.display = 'block';
        document.getElementById('bookingInfo').innerHTML = `
            <strong>Session:</strong> ${currentBooking.label}<br>
            <strong>Seat:</strong> Bench ${currentBooking.seat_index}, Position ${currentBooking.seat_pos}<br>
            <strong>Time:</strong> ${new Date(currentBooking.start_time).toLocaleString()} - ${new Date(currentBooking.end_time).toLocaleString()}
        `;
    }
}

// Logout
async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/';
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkStudentAccess();
});
